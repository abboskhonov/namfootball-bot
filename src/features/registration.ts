import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import type { Context, MyConversation } from "../types";
import { db, schema } from "../db/db";
import { eq } from "drizzle-orm";

export async function registrationConversation(
  conversation: MyConversation,
  ctx: Context
) {
  const userId = ctx.from!.id;

  // Check player exists
  const player = await conversation.external(async () => {
    return db
      .select()
      .from(schema.players)
      .where(eq(schema.players.telegramId, userId))
      .get();
  });

  if (!player) {
    await ctx.reply(
      "You need to join a team first.\n" +
      "Use /teams to browse teams or /join <code> if you have an invite code."
    );
    return;
  }

  // ── Step 1: Full name ──────────────────────────────────
  await ctx.reply(
    "📝 *Step 1/3: Your Full Name*\n\n" +
    "Please enter your full name as it appears on your ID.",
    { parse_mode: "Markdown" }
  );

  const nameCtx = await conversation.waitFor(":text");
  const fullName = nameCtx.msg?.text?.trim();

  if (!fullName || fullName.length < 2) {
    await ctx.reply("❌ Please enter a valid name (at least 2 characters).");
    return;
  }

  // ── Step 2: Passport photo ─────────────────────────────
  await ctx.reply(
    "📸 *Step 2/3: Upload Your ID / Passport*\n\n" +
    "Send a clear photo of your ID or passport.",
    { parse_mode: "Markdown" }
  );

  const photoCtx = await conversation.waitFor(":photo");
  const photos = photoCtx.msg?.photo;

  if (!photos || photos.length === 0) {
    await ctx.reply("❌ Please send a photo.");
    return;
  }

  // Get the largest photo (best quality)
  const fileId = photos[photos.length - 1].file_id;

  // ── Step 3: Phone number ───────────────────────────────
  const skipKeyboard = new InlineKeyboard()
    .text("⏭ Skip", "skip_phone");

  await ctx.reply(
    "📞 *Step 3/3: Phone Number (optional)*\n\n" +
    "Send your phone number or tap Skip.",
    {
      parse_mode: "Markdown",
      reply_markup: skipKeyboard,
    }
  );

  let phone: string | null = null;
  const phoneResponse = await conversation.waitFor([":text", ":contact", "callback_query:data"]);

  if (phoneResponse.callbackQuery?.data === "skip_phone") {
    await phoneResponse.answerCallbackQuery();
    phone = null;
  } else if (phoneResponse.msg?.contact) {
    phone = phoneResponse.msg.contact.phone_number;
  } else if (phoneResponse.msg?.text) {
    phone = phoneResponse.msg.text.trim();
  }

  // ── Step 4: Review & confirm ───────────────────────────
  const confirmKeyboard = new InlineKeyboard()
    .text("✅ Confirm", "confirm_registration")
    .text("❌ Cancel", "cancel_registration");

  await ctx.reply(
    "📋 *Review Your Registration*\n\n" +
    `Name: ${fullName}\n` +
    `Phone: ${phone ?? "Not provided"}\n` +
    `Passport: ✅ Uploaded\n\n` +
    "Is everything correct?",
    {
      parse_mode: "Markdown",
      reply_markup: confirmKeyboard,
    }
  );

  const confirmCtx = await conversation.waitFor("callback_query:data");

  if (confirmCtx.callbackQuery?.data === "cancel_registration") {
    await confirmCtx.answerCallbackQuery();
    await ctx.reply("❌ Registration cancelled.");
    return;
  }

  if (confirmCtx.callbackQuery?.data === "confirm_registration") {
    await confirmCtx.answerCallbackQuery();

    // Save to DB
    await conversation.external(async () => {
      db.update(schema.players)
        .set({
          fullName,
          passportFileId: fileId,
          phone,
          status: "pending",
        })
        .where(eq(schema.players.telegramId, userId))
        .run();
    });

    const team = await conversation.external(() => {
      return db
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.id, player.teamId))
        .get();
    });

    await ctx.reply(
      "✅ *Registration submitted!*\n\n" +
      `Your details for *${team?.name ?? "your team"}* have been saved.\n` +
      "An admin will review and approve your registration.",
      { parse_mode: "Markdown" }
    );

    // Notify admins
    const admins = await conversation.external(() => {
      return db.select().from(schema.admins).all();
    });

    for (const admin of admins) {
      try {
        await ctx.api.sendMessage(
          admin.telegramId,
          `📋 New registration from *${fullName}*\n` +
          `Team: ${team?.name ?? "Unknown"}\n` +
          `Phone: ${phone ?? "N/A"}\n\n` +
          `Use /players to review.`,
          { parse_mode: "Markdown" }
        );
      } catch {
        // Admin might have blocked the bot
      }
    }
  }
}

export function setupRegistrationCommands(bot: Bot<Context>) {
  // ── Start registration conversation ─────────────────────
  bot.command("register", async (ctx) => {
    const player = db
      .select()
      .from(schema.players)
      .where(eq(schema.players.telegramId, ctx.from!.id))
      .get();

    if (!player) {
      return ctx.reply(
        "You need to join a team first.\n" +
        "Use /teams to browse teams or /join <code> if you have an invite code."
      );
    }

    if (player.status === "approved") {
      return ctx.reply("✅ You're already registered and approved!");
    }

    await ctx.conversation.enter("registration");
  });
}
