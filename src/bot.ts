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
    .text("🏆 Ligi", "user_leagues")
    .text("➕ Jamoa yaratish", "user_create_team")
    .row()
    .text("👥 Mening jamoam", "my_team");
}

async function showUserMenu(ctx: Context) {
  await ctx.reply(
    `👋 *Salom ${ctx.from?.first_name ?? "dost"}!*\n\n` +
    "*NamFootball Tournament Bot* ga xush kelibsiz.\n" +
    "Pastdagi tugmalardan birini tanlang:\n",
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
    const msg = "📭 *Hozircha faol ligalar yo'q.*\n\nKeyinroq tekshiring yoki admindan yangi liga yaratishni so'rang.";
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
  keyboard.text("🏠 Bosh sahifa", "user_menu");

  const msg = "*🏆 Faol Ligalar*\n\nLigani tanlang va jamoalarni ko'ring:";
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
    await ctx.editMessageText("❌ Liga topilmadi.", {
      reply_markup: new InlineKeyboard().text("🔙 Ligalar", "user_leagues"),
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
      `📭 *${league.name}* ligasida hali jamoalar yo'q.\n` +
      "Birinchi bo'lib jamoa yarating!",
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("➕ Jamoa yaratish", "user_create_team")
          .row()
          .text("🔙 Orqaga", "user_leagues"),
      }
    );
    return;
  }

  let msg = `🏆 *${league.name}*\n\n`;
  for (const t of teams) {
    const count = db.select().from(schema.players).where(eq(schema.players.teamId, t.id)).all().length;
    msg += `• *${t.name}* — ${count} ta o'yinchi\n`;
  }
  msg += "\n\n_Jamoaga qo'shilish uchun kapitan bilan bog'lanining._";

  await ctx.editMessageText(msg, {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard()
      .text("➕ Jamoa yaratish", "user_create_team")
      .row()
      .text("🔙 Ligalar", "user_leagues"),
  });
}

// ── Bot setup ────────────────────────────────────────────────

async function setupCommandMenu(bot: Bot<Context>) {
  await bot.api.setMyCommands([
    { command: "start", description: "🏠 Bosh menyu" },
    { command: "help", description: "Bot haqida ma'lumot" },
    { command: "leagues", description: "Faol ligalar va jamoalar" },
    { command: "create_team", description: "Yangi jamoa yaratish" },
  ], { scope: { type: "default" } });

  for (const adminId of env.ADMIN_IDS) {
    await bot.api.setMyCommands([
      { command: "pending_teams", description: "Jamoalarni tasdiqlash" },
      { command: "players", description: "Barcha o'yinchilar" },
      { command: "admin", description: "⚙️ Admin paneli" },
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
      `👋 *Salom ${ctx.from?.first_name ?? "dost"}!*\n\n` +
      "Quyidagi tugmalardan birini tanlang:\n",
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
        "/start tugmasini bosing va admin panelidan foydalaning:\n" +
        "• 🏆 Liga yaratish va boshqarish\n" +
        "• ✅ Jamoalarni tasdiqlash yoki rad etish\n" +
        "• 👤 Barcha o'yinchilar va ularning ID rasmlarini ko'rish",
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.reply(
        "👋 *NamFootball Bot*\n\n" +
        "/start tugmasini bosing va asosiy menyuni oching:\n" +
        "• 👀 Faol ligalar va jamoalarni ko'rish\n" +
        "• 🏆 O'z jamoangizni yaratish\n" +
        "• 👥 O'yinchilarni qo'shish (ism, familiya, ID rasm)\n" +
        "• ✏️ Jamoani tahrirlash yoki o'chirish",
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
