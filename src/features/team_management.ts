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
    await ctx.reply("❌ Sizning jamoangiz yo'q.");
    return;
  }
  if (team.status !== "approved") {
    await ctx.reply("⏳ Jamoangiz hali tasdiqlanmadi.");
    return;
  }

  // Step 1: Ism
  await ctx.reply("📝 *1/4-qadam: Ism*\n\nO'yinchining ismini kiriting:", {
    parse_mode: "Markdown",
  });
  const fnCtx = await conversation.waitFor(":text");
  const firstName = fnCtx.msg?.text?.trim();
  if (!firstName || firstName.length < 1) {
    await ctx.reply("❌ Iltimos, to'g'ri ism kiriting (kamida 1 belgi).");
    return;
  }

  // Step 2: Familiya
  await ctx.reply("📝 *2/4-qadam: Familiya*\n\nO'yinchining familiyasini kiriting:", {
    parse_mode: "Markdown",
  });
  const lnCtx = await conversation.waitFor(":text");
  const lastName = lnCtx.msg?.text?.trim();
  if (!lastName || lastName.length < 1) {
    await ctx.reply("❌ Iltimos, to'g'ri familiya kiriting (kamida 1 belgi).");
    return;
  }

  // Step 3: ID rasm
  await ctx.reply(
    "📸 *3/4-qadam: ID / Pasport rasmi*\n\n" +
    "O'yinchining ID yoki pasportining aniq rasmini yuboring.",
    { parse_mode: "Markdown" }
  );
  const photoCtx = await conversation.waitFor(":photo");
  const photos = photoCtx.msg?.photo;
  if (!photos || photos.length === 0) {
    await ctx.reply("❌ Rasm qabul qilinmadi. Iltimos, ID rasmini yuboring.");
    return;
  }
  const fileId = photos[photos.length - 1].file_id;

  // Step 4: Phone (optional)
  const skipKeyboard = new InlineKeyboard().text("⏭ O'tkazib yuborish", "addplayer_skip_phone");
  await ctx.reply("📞 *4/4-qadam: Telefon raqam (ixtiyoriy)*\n\nO'yinchining telefon raqamini kiriting yoki O'tkazib yuborish-ni bosing:", {
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
    `📋 *Tekshirish*\n\n` +
    `Ism: ${firstName} ${lastName}\n` +
    `Telefon: ${phone ?? "Kiritilmadi"}\n` +
    `ID Rasm: ✅ Yuklandi\n\n` +
    `Bu o'yinchini *${team.name}* jamoasiga qo'shamizmi?`,
    { parse_mode: "Markdown", reply_markup: confirmKb }
  );

  const confirmRes = await conversation.waitFor("callback_query:data");
  if (confirmRes.callbackQuery?.data === "addplayer_cancel") {
    await confirmRes.answerCallbackQuery();
    await ctx.reply("❌ Bekor qilindi.");
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
      `✅ *${firstName} ${lastName}* ${team.name} jamoasiga qo'shildi!`,
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
      "📭 Sizning jamoangiz yo'q.\n\n*Jamoa yaratish* tugmasini bosing!",
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
    await ctx.answerCallbackQuery("❌ Topilmadi");
    return;
  }

  db.delete(schema.players).where(eq(schema.players.id, playerId)).run();
  await ctx.editMessageText(
    `❌ *${player.firstName} ${player.lastName}* o'chirildi.`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("🔙 O'yinchilar", "my_team_players"),
    }
  );
  await ctx.answerCallbackQuery("O'yinchi o'chirildi.");
}

// ── Delete team ─────────────────────────────────────────────

async function deleteTeam(ctx: Context) {
  const team = db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.captainId, ctx.from!.id))
    .get();

  if (!team) {
    await ctx.answerCallbackQuery("❌ Jamoa topilmadi");
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
