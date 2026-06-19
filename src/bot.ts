import { Bot, InlineKeyboard, GrammyError, HttpError } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import type { Context } from "./types";
import { env } from "./config";
import { db, schema } from "./db/db";
import { eq } from "drizzle-orm";
import { gate } from "./features/gate";
import { setupLeagueCommands } from "./features/league";
import { setupTeamCommands, createTeamConversation } from "./features/team";
import { setupAdminCommands, isAdmin, showAdminMenu, createLeagueConversation } from "./features/admin";
import {
  setupTeamManagement,
  addPlayerConversation,
  editTeamNameConversation,
} from "./features/team_management";

// ── User main menu ──────────────────────────────────────────

function userMainKeyboard() {
  return new InlineKeyboard()
    .text("🏆 Leagues", "user_leagues")
    .text("➕ Create Team", "user_create_team")
    .row()
    .text("👥 My Team", "my_team");
}

async function showUserMenu(ctx: Context) {
  await ctx.reply(
    `👋 *Hey ${ctx.from?.first_name ?? "there"}!*\n\n` +
    "Welcome to the *NamFootball Tournament Bot*.\n" +
    "Pick an option below to get started:\n",
    {
      parse_mode: "Markdown",
      reply_markup: userMainKeyboard(),
    }
  );
}

async function showLeagues(ctx: Context) {
  const allLeagues = db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.status, "active"))
    .all();

  if (allLeagues.length === 0) {
    const msg = "📭 *No active leagues yet.*\n\nCheck back later or ask an admin to create one.";
    if (ctx.callbackQuery) {
      await ctx.editMessageText(msg, {
        reply_markup: new InlineKeyboard().text("🏠 Home", "user_menu"),
      });
    } else {
      await ctx.reply(msg, {
        reply_markup: new InlineKeyboard().text("🏠 Home", "user_menu"),
      });
    }
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const l of allLeagues) {
    keyboard.text(`🏆 ${l.name}`, `user_league_${l.id}`).row();
  }
  keyboard.text("🏠 Home", "user_menu");

  const msg = "*🏆 Active Leagues*\n\nTap a league to see its teams:";
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
          .text("🔙 Back", "user_leagues"),
      }
    );
    return;
  }

  let msg = `🏆 *${league.name}*\n\n`;
  for (const t of teams) {
    const count = db.select().from(schema.players).where(eq(schema.players.teamId, t.id)).all().length;
    msg += `• *${t.name}* — ${count} players\n`;
  }
  msg += "\n\n_To join a team, contact its captain._";

  await ctx.editMessageText(msg, {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard()
      .text("➕ Create Team", "user_create_team")
      .row()
      .text("🔙 Leagues", "user_leagues"),
  });
}

// ── Bot setup ────────────────────────────────────────────────

async function setupCommandMenu(bot: Bot<Context>) {
  await bot.api.setMyCommands([
    { command: "start", description: "🏠 Open main menu" },
    { command: "help", description: "How this bot works" },
    { command: "leagues", description: "View active leagues and teams" },
    { command: "create_team", description: "Create a team for a league" },
  ], { scope: { type: "default" } });

  for (const adminId of env.ADMIN_IDS) {
    await bot.api.setMyCommands([
      { command: "pending_teams", description: "Approve or reject teams" },
      { command: "players", description: "View all players" },
      { command: "admin", description: "⚙️ Open admin panel" },
    ], { scope: { type: "chat", chat_id: adminId } });
  }
}

export async function createBot() {
  const bot = new Bot<Context>(env.BOT_TOKEN);

  await setupCommandMenu(bot);

  // ── plugins ──────────────────────────────────────────────
  bot.use(conversations());
  bot.use(createConversation(addPlayerConversation));
  bot.use(createConversation(editTeamNameConversation));
  bot.use(createConversation(createLeagueConversation));
  bot.use(createConversation(createTeamConversation));

  // ── gate ─────────────────────────────────────────────────
  bot.use(gate);

  // ── feature modules ──────────────────────────────────────
  setupLeagueCommands(bot);
  setupTeamCommands(bot);
  setupAdminCommands(bot);
  setupTeamManagement(bot);

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
      `👋 *Hey ${ctx.from?.first_name ?? "there"}!*\n\n` +
      "Pick an option below:\n",
      {
        parse_mode: "Markdown",
        reply_markup: userMainKeyboard(),
      }
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

  // ── help ──────────────────────────────────────────────────
  bot.command("help", async (ctx) => {
    if (isAdmin(ctx)) {
      await ctx.reply(
        "⚙️ *NamFootball Bot*\n\n" +
        "Tap /start to open the admin panel where you can:\n" +
        "• Create and manage leagues\n" +
        "• Approve or reject teams\n" +
        "• View all registered players and their ID photos",
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.reply(
        "👋 *NamFootball Bot*\n\n" +
        "Tap /start to open the main menu. From there you can:\n" +
        "• 👀 Browse active leagues and teams\n" +
        "• 🏆 Create your own team\n" +
        "• 👥 Add players to your team (name, last name, ID photo)\n" +
        "• ✏️ Edit or delete your team",
        { parse_mode: "Markdown" }
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
