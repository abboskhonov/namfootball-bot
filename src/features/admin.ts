import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import type { Context, MyConversation } from "../types";
import { db, schema } from "../db/db";
import { env } from "../config";
import { eq } from "drizzle-orm";

export function isAdmin(ctx: Context): boolean {
  return env.ADMIN_IDS.includes(ctx.from?.id ?? 0);
}

// ── Conversation: Create a league ────────────────────────────

export async function createLeagueConversation(
  conversation: MyConversation,
  ctx: Context
) {
  if (!isAdmin(ctx)) {
    await ctx.reply("⛔ Admins only.");
    return;
  }

  await ctx.reply(
    "📝 *Create a New League*\n\nType the league name:",
    { parse_mode: "Markdown" }
  );

  const nameCtx = await conversation.waitFor(":text");
  const name = nameCtx.msg?.text?.trim();

  if (!name || name.length < 2) {
    await ctx.reply("❌ Name too short. Cancelled.");
    return;
  }

  try {
    await conversation.external(() => {
      db.insert(schema.leagues).values({
        name,
        description: "",
        status: "active",
        createdBy: ctx.from!.id,
      }).run();
    });

    await ctx.reply(
      `✅ League *"${name}"* created!`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("Failed to create league:", err);
    await ctx.reply("❌ Failed to create league.");
  }
}

export function setupAdminCommands(bot: Bot<Context>) {
  // ── Admin panel ──────────────────────────────────────────
  bot.command("admin", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("⛔ Admins only.");
    await showAdminMenu(ctx);
  });

  bot.callbackQuery("admin_menu", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery("⛔");
    await ctx.editMessageText("*⚙️ Admin Panel*\n\nSelect a section:", {
      parse_mode: "Markdown",
      reply_markup: adminMainKeyboard(),
    });
    await ctx.answerCallbackQuery();
  });

  // ── Leagues list ────────────────────────────────────────
  bot.callbackQuery("admin_leagues", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery("⛔");
    await showLeaguesList(ctx);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin_league_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery("⛔");
    await showLeagueDetail(ctx, Number(ctx.match![1]));
    await ctx.answerCallbackQuery();
  });

  // ── Create league (enters conversation) ──────────────────
  bot.callbackQuery("admin_create_league", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery("⛔");
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("createLeagueConversation");
  });

  // ── Pending teams ────────────────────────────────────────
  bot.callbackQuery("admin_teams_pending", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery("⛔");
    await showPendingTeams(ctx);
    await ctx.answerCallbackQuery();
  });

  // ── View single pending team ────────────────────────────
  bot.callbackQuery(/^admin_pending_team_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery("⛔");
    await showPendingTeamDetail(ctx, Number(ctx.match![1]));
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^approve_team_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery("⛔");
    await approveTeam(ctx, Number(ctx.match![1]));
  });

  bot.callbackQuery(/^reject_team_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery("⛔");
    await rejectTeam(ctx, Number(ctx.match![1]));
  });

  // ── Players list ─────────────────────────────────────────
  bot.callbackQuery("admin_players", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery("⛔");
    await showPlayers(ctx);
    await ctx.answerCallbackQuery();
  });

  // ── View single player ──────────────────────────────────
  bot.callbackQuery(/^admin_player_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery("⛔");
    await showPlayerDetail(ctx, Number(ctx.match![1]));
    await ctx.answerCallbackQuery();
  });

  // ── View player ID photo ────────────────────────────────
  bot.callbackQuery(/^admin_show_photo_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery("⛔");
    await showPhoto(ctx, Number(ctx.match![1]));
  });

  // ── Keep text commands working too ───────────────────────
  bot.command("addleague", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("⛔ Admins only.");

    const args = ctx.match?.trim();
    if (!args) {
      return ctx.reply(
        "Usage: /addleague <name>\nExample: /addleague Summer Tournament 2026"
      );
    }

    try {
      db.insert(schema.leagues).values({
        name: args,
        description: "",
        status: "active",
        createdBy: ctx.from!.id,
      }).run();

      await ctx.reply(`✅ League *"${args}"* created!`, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      console.error("Failed to create league:", err);
      await ctx.reply("❌ Failed to create league.");
    }
  });

  bot.command("pending_teams", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("⛔ Admins only.");
    await showPendingTeams(ctx);
  });

  bot.command("players", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("⛔ Admins only.");
    await showPlayers(ctx);
  });
}

// ── Admin main menu keyboard ─────────────────────────────────

function adminMainKeyboard() {
  return new InlineKeyboard()
    .text("🏆 Leagues", "admin_leagues")
    .text("👥 Pending Teams", "admin_teams_pending")
    .row()
    .text("🎮 Players", "admin_players")
    .text("➕ Create League", "admin_create_league");
}

// ── Show admin menu ─────────────────────────────────────────

export async function showAdminMenu(ctx: Context) {
  const leagueCount = db.select().from(schema.leagues).all().length;
  const pendingCount = db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.status, "pending"))
    .all().length;
  const playerCount = db.select().from(schema.players).all().length;

  await ctx.reply(
    `*⚙️ Admin Panel*\n\n` +
    `🏆 Leagues: ${leagueCount}\n` +
    `👥 Pending teams: ${pendingCount}\n` +
    `🎮 Players: ${playerCount}`,
    {
      parse_mode: "Markdown",
      reply_markup: adminMainKeyboard(),
    }
  );
}

// ── Leagues list ────────────────────────────────────────────

async function showLeaguesList(ctx: Context) {
  const allLeagues = db.select().from(schema.leagues).all();

  if (allLeagues.length === 0) {
    await ctx.editMessageText(
      "📭 No leagues yet.\n\nTap *➕ Create League* to make one.",
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("➕ Create League", "admin_create_league")
          .row()
          .text("🔙 Back", "admin_menu"),
      }
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const league of allLeagues) {
    keyboard.text(
      `${league.status === "active" ? "🟢" : "🔴"} ${league.name}`,
      `admin_league_${league.id}`
    );
    keyboard.row();
  }
  keyboard.text("➕ Create League", "admin_create_league").row();
  keyboard.text("🏠 Admin Panel", "admin_menu");

  await ctx.editMessageText("*🏆 Leagues*\n\nTap a league to manage:", {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

// ── Single league detail ────────────────────────────────────

async function showLeagueDetail(ctx: Context, leagueId: number) {
  const league = db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();

  if (!league) {
    await ctx.editMessageText("❌ League not found.", {
      reply_markup: new InlineKeyboard().text("🔙 Back", "admin_leagues"),
    });
    return;
  }

  const teams = db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.leagueId, leagueId))
    .all();

  const approvedTeams = teams.filter((t) => t.status === "approved");
  const pendingTeams = teams.filter((t) => t.status === "pending");

  let msg =
    `*🏆 ${league.name}*\n\n` +
    `Status: ${league.status === "active" ? "🟢 Active" : "🔴 Ended"}\n` +
    `Teams: ${approvedTeams.length} approved, ${pendingTeams.length} pending\n` +
    `Created: ${league.createdAt}\n`;

  if (approvedTeams.length > 0) {
    msg += "\n*Approved teams:*\n";
    for (const t of approvedTeams) {
      const playerCount = db
        .select()
        .from(schema.players)
        .where(eq(schema.players.teamId, t.id))
        .all().length;
      msg += `• ${t.name} — ${playerCount} players\n`;
    }
  }

  const keyboard = new InlineKeyboard()
    .text("🔙 Back to Leagues", "admin_leagues")
    .row()
    .text("🔙 Admin Panel", "admin_menu");

  await ctx.editMessageText(msg, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

// ── Pending teams list ──────────────────────────────────────

async function showPendingTeams(ctx: Context) {
  const pending = db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.status, "pending"))
    .all();

  if (pending.length === 0) {
    const text = "✅ No pending teams.";
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, {
        reply_markup: new InlineKeyboard().text("🔙 Back", "admin_menu"),
      });
    } else {
      await ctx.reply(text);
    }
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const team of pending) {
    const league = db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.id, team.leagueId))
      .get();

    keyboard.text(
      `⏳ ${team.name} (${league?.name ?? "?"})`,
      `admin_pending_team_${team.id}`
    );
    keyboard.row();
  }
  keyboard.text("🏠 Admin Panel", "admin_menu");

  const text = `*⏳ Pending Teams*
\n${pending.length} team${pending.length > 1 ? "s" : ""} waiting for your decision. Tap a team.`;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(text, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  }
}

// ── Single pending team detail ──────────────────────────────

async function showPendingTeamDetail(ctx: Context, teamId: number) {
  const team = db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.id, teamId))
    .get();

  if (!team || team.status !== "pending") {
    await ctx.editMessageText("❌ Team not found or already reviewed.", {
      reply_markup: new InlineKeyboard().text("🔙 Pending Teams", "admin_teams_pending"),
    });
    return;
  }

  const league = db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.id, team.leagueId))
    .get();

  const keyboard = new InlineKeyboard()
    .text("✅ Accept", `approve_team_${team.id}`)
    .text("❌ Reject", `reject_team_${team.id}`)
    .row()
    .text("🔙 Pending Teams", "admin_teams_pending");

  await ctx.editMessageText(
    `⏳ *Pending Team*\n\n` +
    `Name: *${team.name}*\n` +
    `League: ${league?.name ?? "Unknown"}\n` +
    `Captain ID: \`${team.captainId}\``,
    {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    }
  );
}

// ── Approve / Reject ────────────────────────────────────────

async function approveTeam(ctx: Context, teamId: number) {
  try {
    db.update(schema.teams)
      .set({ status: "approved" })
      .where(eq(schema.teams.id, teamId))
      .run();

    const team = db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.id, teamId))
      .get();

    await ctx.editMessageText(
      `✅ *${team?.name ?? "Team"}* has been approved!`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("🔙 Pending Teams", "admin_teams_pending")
          .text("🔙 Admin Panel", "admin_menu"),
      }
    );

    if (team) {
      await ctx.api.sendMessage(
        team.captainId,
        `✅ Your team *"${team.name}"* has been approved!\n\n` +
        `Share this invite code with your players:\n` +
        `\`/join ${team.inviteCode}\``,
        { parse_mode: "Markdown" }
      );
    }

    await ctx.answerCallbackQuery("Team approved! ✅");
  } catch (err) {
    console.error("Failed to approve team:", err);
    await ctx.answerCallbackQuery("❌ Failed to approve.");
  }
}

async function rejectTeam(ctx: Context, teamId: number) {
  try {
    db.update(schema.teams)
      .set({ status: "rejected" })
      .where(eq(schema.teams.id, teamId))
      .run();

    const team = db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.id, teamId))
      .get();

    await ctx.editMessageText(
      `❌ *${team?.name ?? "Team"}* has been rejected.`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("🔙 Pending Teams", "admin_teams_pending")
          .text("🔙 Admin Panel", "admin_menu"),
      }
    );

    if (team) {
      await ctx.api.sendMessage(
        team.captainId,
        `❌ Your team *"${team.name}"* was not approved. Contact an admin.`,
        { parse_mode: "Markdown" }
      );
    }

    await ctx.answerCallbackQuery("Team rejected.");
  } catch (err) {
    console.error("Failed to reject team:", err);
    await ctx.answerCallbackQuery("❌ Failed to reject.");
  }
}

// ── Players list ────────────────────────────────────────────

// ── Players list (button list) ──────────────────────────────

async function showPlayers(ctx: Context) {
  const allPlayers = db.select().from(schema.players).all();

  if (allPlayers.length === 0) {
    const text = "📭 No registered players yet.";
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, {
        reply_markup: new InlineKeyboard().text("🔙 Back", "admin_menu"),
      });
    } else {
      await ctx.reply(text);
    }
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const p of allPlayers) {
    const team = db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.id, p.teamId))
      .get();

    keyboard.text(`👤 ${p.firstName} ${p.lastName} (${team?.name ?? "?"})`, `admin_player_${p.id}`);
    keyboard.row();
  }
  keyboard.text("🏠 Admin Panel", "admin_menu");

  const msg = `*🎮 Players* (${allPlayers.length})\n\nTap a player to view their details and ID photo.`;

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

// ── Player detail with photo ────────────────────────────────

async function showPlayerDetail(ctx: Context, playerId: number) {
  const player = db
    .select()
    .from(schema.players)
    .where(eq(schema.players.id, playerId))
    .get();

  if (!player) {
    await ctx.editMessageText("❌ Player not found.", {
      reply_markup: new InlineKeyboard().text("🔙 Players", "admin_players"),
    });
    return;
  }

  const team = db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.id, player.teamId))
    .get();

  const league = team
    ? db.select().from(schema.leagues).where(eq(schema.leagues.id, team.leagueId)).get()
    : null;

  const caption =
    `👤 *${player.firstName} ${player.lastName}*\n\n` +
    `Team: ${team?.name ?? "Unknown"}\n` +
    `League: ${league?.name ?? "Unknown"}\n` +
    `Phone: ${player.phone ?? "Not provided"}\n` +
    `Added by: \`${player.addedBy}\``;

  const keyboard = new InlineKeyboard()
    .text("🔙 All Players", "admin_players")
    .row()
    .text("🔙 Admin Panel", "admin_menu");

  // Send the ID photo with caption
  await ctx.editMessageText(
    `👤 Tap below to see ${player.firstName}'s ID photo →`,
    {
      reply_markup: new InlineKeyboard()
        .text("📸 View ID Photo", `admin_show_photo_${player.id}`)
        .row()
        .text("🔙 All Players", "admin_players"),
    }
  );
}

async function showPhoto(ctx: Context, playerId: number) {
  const player = db
    .select()
    .from(schema.players)
    .where(eq(schema.players.id, playerId))
    .get();

  if (!player) {
    await ctx.answerCallbackQuery("❌ Not found");
    return;
  }

  const team = db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.id, player.teamId))
    .get();

  const league = team
    ? db.select().from(schema.leagues).where(eq(schema.leagues.id, team.leagueId)).get()
    : null;

  await ctx.answerCallbackQuery();

  await ctx.replyWithPhoto(player.passportFileId, {
    caption:
      `👤 *${player.firstName} ${player.lastName}*\n\n` +
      `Team: ${team?.name ?? "Unknown"}\n` +
      `League: ${league?.name ?? "Unknown"}\n` +
      `Phone: ${player.phone ?? "Not provided"}`,
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard()
      .text("🔙 All Players", "admin_players")
      .row()
      .text("🔙 Admin Panel", "admin_menu"),
  });
}
