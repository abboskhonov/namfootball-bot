import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import type { Context, MyConversation } from "../types";
import { db, schema } from "../db/db";
import { eq } from "drizzle-orm";

// ── Conversation: Add a player ──────────────────────────────

export async function addPlayerConversation(
  conversation: MyConversation,
  ctx: Context
) {
  const team = await conversation.external(() =>
    db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.captainId, ctx.from!.id))
      .get()
  );

  if (!team) {
    await ctx.reply("❌ You don't have a team.");
    return;
  }
  if (team.status !== "approved") {
    await ctx.reply("⏳ Your team hasn't been approved yet.");
    return;
  }

  // Step 1: First name
  await ctx.reply("📝 *Step 1/4: First Name*\n\nWhat's the player's first name?", {
    parse_mode: "Markdown",
  });
  const fnCtx = await conversation.waitFor(":text");
  const firstName = fnCtx.msg?.text?.trim();
  if (!firstName || firstName.length < 1) {
    await ctx.reply("❌ Please enter a valid first name (at least 1 character).");
    return;
  }

  // Step 2: Last name
  await ctx.reply("📝 *Step 2/4: Last Name*\n\nWhat's the player's last name?", {
    parse_mode: "Markdown",
  });
  const lnCtx = await conversation.waitFor(":text");
  const lastName = lnCtx.msg?.text?.trim();
  if (!lastName || lastName.length < 1) {
    await ctx.reply("❌ Please enter a valid last name (at least 1 character).");
    return;
  }

  // Step 3: ID photo
  await ctx.reply(
    "📸 *Step 3/4: ID / Passport Photo*\n\n" +
    "Send a clear photo of the player's ID or passport.",
    { parse_mode: "Markdown" }
  );
  const photoCtx = await conversation.waitFor(":photo");
  const photos = photoCtx.msg?.photo;
  if (!photos || photos.length === 0) {
    await ctx.reply("❌ No photo received. Please send a photo of the ID.");
    return;
  }
  const fileId = photos[photos.length - 1].file_id;

  // Step 4: Phone (optional)
  const skipKeyboard = new InlineKeyboard().text("⏭ Skip", "addplayer_skip_phone");
  await ctx.reply("📞 *Step 4/4: Phone Number (optional)*\n\nEnter the player's phone number or tap Skip:", {
    parse_mode: "Markdown",
    reply_markup: skipKeyboard,
  });

  let phone: string | null = null;
  const phoneRes = await conversation.waitFor([":text", "callback_query:data"]);
  if (phoneRes.callbackQuery?.data === "addplayer_skip_phone") {
    await phoneRes.answerCallbackQuery();
  } else if (phoneRes.msg?.text) {
    phone = phoneRes.msg.text.trim();
  }

  // Confirm
  const confirmKb = new InlineKeyboard()
    .text("✅ Confirm", "addplayer_confirm")
    .text("❌ Cancel", "addplayer_cancel");
  await ctx.reply(
    `📋 *Review*\n\n` +
    `Name: ${firstName} ${lastName}\n` +
    `Phone: ${phone ?? "Not provided"}\n` +
    `ID Photo: ✅ Uploaded\n\n` +
    `Add this player to *${team.name}*?`,
    { parse_mode: "Markdown", reply_markup: confirmKb }
  );

  const confirmRes = await conversation.waitFor("callback_query:data");
  if (confirmRes.callbackQuery?.data === "addplayer_cancel") {
    await confirmRes.answerCallbackQuery();
    await ctx.reply("❌ Cancelled.");
    return;
  }
  if (confirmRes.callbackQuery?.data === "addplayer_confirm") {
    await confirmRes.answerCallbackQuery();
    const league = await conversation.external(() => {
      db.insert(schema.players).values({
        teamId: team.id,
        firstName,
        lastName,
        passportFileId: fileId,
        phone,
        addedBy: ctx.from!.id,
      }).run();

      return db
        .select()
        .from(schema.leagues)
        .where(eq(schema.leagues.id, team.leagueId))
        .get();
    });

    await ctx.reply(
      `✅ *${firstName} ${lastName}* added to ${team.name}!`,
      { parse_mode: "Markdown" }
    );

    // Notify all admins
    const admins = await conversation.external(() =>
      db.select().from(schema.admins).all()
    );

    for (const admin of admins) {
      try {
        await ctx.api.sendPhoto(admin.telegramId, fileId, {
          caption:
            `📋 *New Player Added*\n\n` +
            `Name: ${firstName} ${lastName}\n` +
            `Team: ${team.name}\n` +
            `League: ${league?.name ?? "Unknown"}\n` +
            `Phone: ${phone ?? "N/A"}\n` +
            `Added by: ${ctx.from?.first_name ?? "Captain"}`,
          parse_mode: "Markdown",
        });
      } catch {}
    }
  }
}

// ── Conversation: Edit team name ────────────────────────────

export async function editTeamNameConversation(
  conversation: MyConversation,
  ctx: Context
) {
  const team = await conversation.external(() =>
    db.select().from(schema.teams).where(eq(schema.teams.captainId, ctx.from!.id)).get()
  );
  if (!team) {
    await ctx.reply("❌ You don't have a team.");
    return;
  }

  await ctx.reply(
    `✏️ *Edit Team Name*\n\nCurrent name: *${team.name}*\n\nSend the new name:`,
    { parse_mode: "Markdown" }
  );
  const nameCtx = await conversation.waitFor(":text");
  const newName = nameCtx.msg?.text?.trim();
  if (!newName || newName.length < 2) {
    await ctx.reply("❌ Name must be at least 2 characters.");
    return;
  }

  await conversation.external(() => {
    db.update(schema.teams).set({ name: newName }).where(eq(schema.teams.id, team.id)).run();
  });
  await ctx.reply(`✅ Team name changed to *${newName}*!`, { parse_mode: "Markdown" });
}

// ── Setup ────────────────────────────────────────────────────

export function setupTeamManagement(bot: Bot<Context>) {
  // ── My Team menu ─────────────────────────────────────────
  bot.callbackQuery("my_team", async (ctx) => {
    await showMyTeam(ctx);
    await ctx.answerCallbackQuery();
  });

  // ── View players list ────────────────────────────────────
  bot.callbackQuery("my_team_players", async (ctx) => {
    await showPlayersList(ctx);
    await ctx.answerCallbackQuery();
  });

  // ── View single player ──────────────────────────────────
  bot.callbackQuery(/^player_detail_(\d+)$/, async (ctx) => {
    await showPlayerDetail(ctx, Number(ctx.match![1]));
    await ctx.answerCallbackQuery();
  });

  // ── Delete player ───────────────────────────────────────
  bot.callbackQuery(/^delete_player_(\d+)$/, async (ctx) => {
    await deletePlayer(ctx, Number(ctx.match![1]));
  });

  // ── Delete team (with confirmation) ────────────────────
  bot.callbackQuery("delete_team_confirm", async (ctx) => {
    const team = db.select().from(schema.teams).where(eq(schema.teams.captainId, ctx.from!.id)).get();
    if (!team) {
      await ctx.answerCallbackQuery("❌ No team");
      return;
    }

    await ctx.editMessageText(
      `⚠️ *Delete "${team.name}"?*\n\n` +
      `This will permanently delete the team and all ${db.select().from(schema.players).where(eq(schema.players.teamId, team.id)).all().length} players.\n\n` +
      `Are you sure?`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("✅ Yes, delete", "delete_team_yes")
          .row()
          .text("❌ Cancel", "my_team"),
      }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("delete_team_yes", async (ctx) => {
    await deleteTeam(ctx);
  });

  // ── Edit name (enters conversation) ─────────────────────
  bot.callbackQuery("edit_team_name", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("editTeamNameConversation");
  });

  // ── Add player (enters conversation) ────────────────────
  bot.callbackQuery("add_player", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("addPlayerConversation");
  });
}

// ── Show My Team ────────────────────────────────────────────

async function showMyTeam(ctx: Context) {
  const team = db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.captainId, ctx.from!.id))
    .get();

  if (!team) {
    await ctx.editMessageText(
      "📭 You don't have a team yet.\n\nTap *Create Team* to make one!",
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("➕ Create Team", "user_create_team")
          .row()
          .text("🔙 Back", "user_menu"),
      }
    );
    return;
  }

  const league = db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.id, team.leagueId))
    .get();

  const playerCount = db
    .select()
    .from(schema.players)
    .where(eq(schema.players.teamId, team.id))
    .all().length;

  const statusEmoji =
    team.status === "approved" ? "✅" : team.status === "pending" ? "⏳" : "❌";

  const keyboard = new InlineKeyboard()
    .text("➕ Add Player", "add_player")
    .text("✏️ Edit Name", "edit_team_name")
    .row()
    .text("📋 Players", "my_team_players")
    .row()
    .text("❌ Delete Team", "delete_team_confirm")
    .row()
    .text("🏠 Home", "user_menu");

  await ctx.editMessageText(
    `👥 *${team.name}* ${statusEmoji}\n\n` +
    `📌 League: ${league?.name ?? "Unknown"}\n` +
    `👤 Players: ${playerCount}\n`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
}

// ── Players list ────────────────────────────────────────────

async function showPlayersList(ctx: Context) {
  const team = db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.captainId, ctx.from!.id))
    .get();

  if (!team) {
    await ctx.editMessageText("❌ Team not found.", {
      reply_markup: new InlineKeyboard().text("🔙 Back", "my_team"),
    });
    return;
  }

  const allPlayers = db
    .select()
    .from(schema.players)
    .where(eq(schema.players.teamId, team.id))
    .all();

  if (allPlayers.length === 0) {
    await ctx.editMessageText(
      "📭 No players yet.\n\nTap *Add Player* to add one.",
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("➕ Add Player", "add_player")
          .row()
          .text("🔙 Back", "my_team"),
      }
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const p of allPlayers) {
    keyboard.text(
      `👤 ${p.firstName} ${p.lastName}`,
      `player_detail_${p.id}`
    );
    keyboard.row();
  }
  keyboard.text("➕ Add Player", "add_player").row();
  keyboard.text("🔙 Back", "my_team");

  await ctx.editMessageText(
    `📋 *Players* (${allPlayers.length})`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
}

// ── Player detail ───────────────────────────────────────────

async function showPlayerDetail(ctx: Context, playerId: number) {
  const team = db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.captainId, ctx.from!.id))
    .get();

  if (!team) {
    await ctx.answerCallbackQuery("❌ Not your team");
    return;
  }

  const player = db
    .select()
    .from(schema.players)
    .where(eq(schema.players.id, playerId))
    .get();

  if (!player || player.teamId !== team.id) {
    await ctx.editMessageText("❌ Player not found.", {
      reply_markup: new InlineKeyboard().text("🔙 Players", "my_team_players"),
    });
    return;
  }

  const keyboard = new InlineKeyboard()
    .text("❌ Delete Player", `delete_player_${player.id}`)
    .row()
    .text("🔙 Players", "my_team_players");

  await ctx.editMessageText(
    `👤 *${player.firstName} ${player.lastName}*\n\n` +
    `Phone: ${player.phone ?? "Not provided"}\n` +
    `ID Photo: ✅ Uploaded`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
}

// ── Delete player ───────────────────────────────────────────

async function deletePlayer(ctx: Context, playerId: number) {
  const team = db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.captainId, ctx.from!.id))
    .get();

  if (!team) {
    await ctx.answerCallbackQuery("❌ Not your team");
    return;
  }

  const player = db
    .select()
    .from(schema.players)
    .where(eq(schema.players.id, playerId))
    .get();

  if (!player || player.teamId !== team.id) {
    await ctx.answerCallbackQuery("❌ Not found");
    return;
  }

  db.delete(schema.players).where(eq(schema.players.id, playerId)).run();
  await ctx.editMessageText(
    `❌ *${player.firstName} ${player.lastName}* removed.`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("🔙 Players", "my_team_players"),
    }
  );
  await ctx.answerCallbackQuery("Player deleted.");
}

// ── Delete team ─────────────────────────────────────────────

async function deleteTeam(ctx: Context) {
  const team = db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.captainId, ctx.from!.id))
    .get();

  if (!team) {
    await ctx.answerCallbackQuery("❌ Team not found");
    return;
  }

  const playerCount = db
    .select()
    .from(schema.players)
    .where(eq(schema.players.teamId, team.id))
    .all().length;

  db.delete(schema.players).where(eq(schema.players.teamId, team.id)).run();
  db.delete(schema.teams).where(eq(schema.teams.id, team.id)).run();

  await ctx.editMessageText(
    `🗑 *${team.name}* deleted.\n${playerCount} player${playerCount !== 1 ? "s" : ""} removed.`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("🏠 Home", "user_menu"),
    }
  );
  await ctx.answerCallbackQuery("Team deleted.");
}
