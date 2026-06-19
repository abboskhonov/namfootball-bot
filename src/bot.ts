import { Bot, InlineKeyboard, GrammyError, HttpError } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import type { Context } from "./types";
import { env } from "./config";
import { db, schema } from "./db/db";
import { eq } from "drizzle-orm";
import { gate } from "./features/gate";
import { setupLeagueCommands } from "./features/league";
import { setupTeamCommands, createTeamConversation } from "./features/team";
import { registrationConversation, setupRegistrationCommands } from "./features/registration";
import { setupAdminCommands, isAdmin, showAdminMenu, createLeagueConversation } from "./features/admin";

// ── User main menu ──────────────────────────────────────────

function userMainKeyboard() {
  return new InlineKeyboard()
    .text("🏆 Leagues", "user_leagues")
    .text("➕ Create Team", "user_create_team")
    .row()
    .text("📝 Register", "user_register")
    .text("📋 My Status", "user_status");
}

async function showUserMenu(ctx: Context) {
  await ctx.reply(
    `👋 Welcome, ${ctx.from?.first_name ?? "there"}!\n\n` +
    "Tap a button below:",
    { reply_markup: userMainKeyboard() }
  );
}

async function showLeagues(ctx: Context) {
  const allLeagues = db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.status, "active"))
    .all();

  if (allLeagues.length === 0) {
    const msg = "📭 No active leagues right now.";
    if (ctx.callbackQuery) {
      await ctx.editMessageText(msg, {
        reply_markup: new InlineKeyboard().text("🔙 Back", "user_menu"),
      });
    } else {
      await ctx.reply(msg, {
        reply_markup: new InlineKeyboard().text("🔙 Back", "user_menu"),
      });
    }
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const l of allLeagues) {
    keyboard.text(`🏆 ${l.name}`, `user_league_${l.id}`).row();
  }
  keyboard.text("🔙 Back", "user_menu");

  const msg = "*Active Leagues*\n\nTap a league to see its teams.";
  if (ctx.callbackQuery) {
    await ctx.editMessageText(msg, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(msg, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  }
}

async function showTeamList(ctx: Context, leagueId: number) {
  const league = db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();

  if (!league) {
    await ctx.editMessageText("❌ League not found.", {
      reply_markup: new InlineKeyboard().text("🔙 Leagues", "user_leagues"),
    });
    return;
  }

  const teams = db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.leagueId, leagueId))
    .all()
    .filter((t) => t.status === "approved");

  if (teams.length === 0) {
    await ctx.editMessageText(
      `📭 No teams in *${league.name}* yet.\n` +
      "Be the first — tap Create Team!",
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("➕ Create Team", "user_create_team")
          .row()
          .text("🔙 Leagues", "user_leagues"),
      }
    );
    return;
  }

  let msg = `🏆 *${league.name}* — Teams\n\n`;
  for (const t of teams) {
    const count = db.select().from(schema.players).where(eq(schema.players.teamId, t.id)).all().length;
    msg += `• *${t.name}* — ${count} players\n`;
  }
  msg += "\nJoin a team: ask the captain for the invite code and use /join <code>";

  await ctx.editMessageText(msg, {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard()
      .text("➕ Create Team", "user_create_team")
      .row()
      .text("🔙 Leagues", "user_leagues"),
  });
}

async function showStatus(ctx: Context) {
  const player = db
    .select()
    .from(schema.players)
    .where(eq(schema.players.telegramId, ctx.from!.id))
    .get();

  if (!player) {
    const msg = "📭 You haven't joined any team yet.\n\nJoin a team to get started!";
    if (ctx.callbackQuery) {
      await ctx.editMessageText(msg, {
        reply_markup: new InlineKeyboard().text("🔙 Back", "user_menu"),
      });
    } else {
      await ctx.reply(msg, {
        reply_markup: new InlineKeyboard().text("🔙 Back", "user_menu"),
      });
    }
    return;
  }

  const team = db.select().from(schema.teams).where(eq(schema.teams.id, player.teamId)).get();
  const league = team ? db.select().from(schema.leagues).where(eq(schema.leagues.id, team.leagueId)).get() : null;

  await ctx.reply(
    `📋 *Your Status*\n\n` +
    `Team: ${team?.name ?? "N/A"}\n` +
    `League: ${league?.name ?? "N/A"}\n` +
    `Name: ${player.fullName}\n` +
    `Passport: ${player.passportFileId ? "✅ Uploaded" : "❌ Not uploaded"}\n` +
    `Phone: ${player.phone ?? "❌ Not provided"}\n` +
    `Status: *${player.status}*`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("🔙 Back", "user_menu"),
    }
  );
}

// ── Bot setup ────────────────────────────────────────────────

async function setupCommandMenu(bot: Bot<Context>) {
  await bot.api.setMyCommands([
    { command: "start", description: "Start the bot" },
    { command: "help", description: "Show available commands" },
    { command: "leagues", description: "View active leagues" },
    { command: "create_team", description: "Create a team for a league" },
    { command: "join", description: "Join a team with invite code" },
    { command: "register", description: "Register your player details" },
    { command: "status", description: "Check your registration status" },
  ], { scope: { type: "default" } });

  for (const adminId of env.ADMIN_IDS) {
    await bot.api.setMyCommands([
      { command: "pending_teams", description: "Approve or reject teams" },
      { command: "players", description: "View registered players" },
      { command: "admin", description: "Admin panel" },
    ], { scope: { type: "chat", chat_id: adminId } });
  }
}

export async function createBot() {
  const bot = new Bot<Context>(env.BOT_TOKEN);

  await setupCommandMenu(bot);

  // ── plugins ──────────────────────────────────────────────
  bot.use(conversations());
  bot.use(createConversation(registrationConversation));
  bot.use(createConversation(createLeagueConversation));
  bot.use(createConversation(createTeamConversation));

  // ── gate ─────────────────────────────────────────────────
  bot.use(gate);

  // ── feature modules ──────────────────────────────────────
  setupLeagueCommands(bot);
  setupTeamCommands(bot);
  setupRegistrationCommands(bot);
  setupAdminCommands(bot);

  // ── User menu navigation ─────────────────────────────────
  bot.command("start", async (ctx) => {
    if (isAdmin(ctx)) {
      await showAdminMenu(ctx);
    } else {
      await showUserMenu(ctx);
    }
  });

  bot.callbackQuery("user_menu", async (ctx) => {
    await ctx.editMessageText(
      `👋 Welcome, ${ctx.from?.first_name ?? "there"}!\n\nTap a button below:`,
      { reply_markup: userMainKeyboard() }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("user_leagues", async (ctx) => {
    await showLeagues(ctx);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^user_league_(\d+)$/, async (ctx) => {
    await showTeamList(ctx, Number(ctx.match![1]));
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("user_create_team", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("createTeamConversation");
  });

  bot.callbackQuery("user_register", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("registration");
  });

  bot.callbackQuery("user_status", async (ctx) => {
    await showStatus(ctx);
    await ctx.answerCallbackQuery();
  });

  // ── help ──────────────────────────────────────────────────
  bot.command("help", async (ctx) => {
    if (isAdmin(ctx)) {
      await ctx.reply("Tap /start to open the admin panel.");
    } else {
      await ctx.reply(
        "Tap /start to open the main menu.\n\n" +
        "You can also type commands directly:\n" +
        "/leagues — Browse leagues\n" +
        "/join <code> — Join a team\n" +
        "/status — Your registration status"
      );
    }
  });

  // ── error handling ────────────────────────────────────────
  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error handling update ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) {
      console.error("Grammy error:", e.description);
    } else if (e instanceof HttpError) {
      console.error("HTTP error:", e);
    } else {
      console.error("Unknown error:", e);
    }
  });

  return bot;
}
