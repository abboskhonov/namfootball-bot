import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import type { Context, MyConversation } from "../types";
import { db, schema } from "../db/db";
import { eq } from "drizzle-orm";
import { env } from "../config";

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ── Conversation: Create a team ──────────────────────────────

export async function createTeamConversation(
  conversation: MyConversation,
  ctx: Context
) {
  // ── Step 1: Pick a league ────────────────────────────────
  const activeLeagues = await conversation.external(() =>
    db.select().from(schema.leagues).where(eq(schema.leagues.status, "active")).all()
  );

  if (activeLeagues.length === 0) {
    await ctx.reply("📭 No active leagues to join.");
    return;
  }

  const leagueKeyboard = new InlineKeyboard();
  for (const league of activeLeagues) {
    leagueKeyboard.text(league.name, `convo_league_${league.id}`).row();
  }

  await ctx.reply("*Create a Team*\n\nWhich league?", {
    parse_mode: "Markdown",
    reply_markup: leagueKeyboard,
  });

  const leagueChoice = await conversation.waitFor("callback_query:data");
  const leagueId = Number(leagueChoice.callbackQuery!.data.replace("convo_league_", ""));
  const chosenLeague = activeLeagues.find((l) => l.id === leagueId);

  if (!chosenLeague) {
    await ctx.reply("❌ Invalid league.");
    return;
  }

  await leagueChoice.answerCallbackQuery("✅ League selected");

  // ── Step 2: Team name ────────────────────────────────────
  await ctx.reply(
    `League: *${chosenLeague.name}*\n\nNow send your team name:`,
    { parse_mode: "Markdown" }
  );

  const nameCtx = await conversation.waitFor(":text");
  const teamName = nameCtx.msg?.text?.trim();

  if (!teamName || teamName.length < 2) {
    await ctx.reply("❌ Name too short. Cancelled.");
    return;
  }

  // ── Create the team ──────────────────────────────────────
  try {
    const inviteCode = generateCode();

    await conversation.external(() => {
      db.insert(schema.teams).values({
        leagueId,
        name: teamName,
        captainId: ctx.from!.id,
        inviteCode,
        status: "pending",
      }).run();
    });

    await ctx.reply(
      `⏳ Team *"${teamName}"* created in *${chosenLeague.name}*!\n\n` +
      "Waiting for admin approval. You'll be notified once approved.",
      { parse_mode: "Markdown" }
    );

    // Get the new team's ID for the buttons
    const newTeam = db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.inviteCode, inviteCode))
      .get();

    const pendingKeyboard = new InlineKeyboard()
      .text("✅ Accept", `approve_team_${newTeam?.id}`)
      .text("❌ Reject", `reject_team_${newTeam?.id}`);

    for (const adminId of env.ADMIN_IDS) {
      try {
        await ctx.api.sendMessage(
          adminId,
          `📋 *New Team Pending*\n\n` +
          `Team: *${teamName}*\n` +
          `League: ${chosenLeague.name}\n` +
          `Captain: ${ctx.from?.first_name} (\`${ctx.from!.id}\`)`,
          {
            parse_mode: "Markdown",
            reply_markup: pendingKeyboard,
          }
        );
      } catch {
        // admin might have blocked the bot
      }
    }
  } catch (err) {
    console.error("Failed to create team:", err);
    await ctx.reply("❌ Failed to create team.");
  }
}

export function setupTeamCommands(bot: Bot<Context>) {
  // ── Create a team (enters conversation) ───────────────────
  bot.command("create_team", async (ctx) => {
    // If args provided, use text command (backward compat)
    const args = ctx.match?.trim();
    if (args && args.includes(" ")) {
      await handleCreateTeamText(ctx, args);
      return;
    }
    // Otherwise start conversation
    await ctx.conversation.enter("createTeamConversation");
  });

  // ── Browse teams in a league ─────────────────────────────
  bot.command("teams", async (ctx) => {
    const arg = ctx.match?.trim();

    if (!arg) {
      const activeLeagues = db
        .select()
        .from(schema.leagues)
        .where(eq(schema.leagues.status, "active"))
        .all();

      if (activeLeagues.length === 0) {
        return ctx.reply("📭 No active leagues.");
      }

      const keyboard = InlineKeyboard.from(
        activeLeagues.map((l) => [
          { text: `🏆 ${l.name}`, callback_data: `teams_league_${l.id}` },
        ])
      );

      return ctx.reply("Select a league to see its teams:", {
        reply_markup: keyboard,
      });
    }

    const leagueId = Number(arg);
    if (isNaN(leagueId)) {
      return ctx.reply("Usage: /teams <league_id>");
    }

    await showTeamsForLeague(ctx, leagueId);
  });

  bot.callbackQuery(/^teams_league_(\d+)$/, async (ctx) => {
    const leagueId = Number(ctx.match![1]);
    await showTeamsForLeague(ctx, leagueId);
    await ctx.answerCallbackQuery();
  });

  // ── Join a team via invite code ──────────────────────────
  bot.command("join", async (ctx) => {
    const code = ctx.match?.trim().toUpperCase();
    if (!code) {
      return ctx.reply("Usage: /join <invite_code>\nAsk your team captain for the code.");
    }

    const team = db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.inviteCode, code))
      .get();

    if (!team) {
      return ctx.reply("❌ Invalid invite code. Check with your team captain.");
    }

    if (team.status !== "approved") {
      return ctx.reply("⏳ This team hasn't been approved yet.");
    }

    const existingPlayer = db
      .select()
      .from(schema.players)
      .where(eq(schema.players.telegramId, ctx.from!.id))
      .get();

    if (existingPlayer) {
      const existingTeam = db
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.id, existingPlayer.teamId))
        .get();

      if (existingTeam && existingTeam.leagueId === team.leagueId) {
        return ctx.reply(
          `ℹ️ You're already registered with *${existingTeam.name}* in this league.`,
          { parse_mode: "Markdown" }
        );
      }
    }

    try {
      db.insert(schema.players).values({
        teamId: team.id,
        telegramId: ctx.from!.id,
        username: ctx.from?.username ?? null,
        fullName: ctx.from?.first_name ?? "Unknown",
        passportFileId: "",
        phone: null,
        status: "pending",
      }).run();

      const league = db
        .select()
        .from(schema.leagues)
        .where(eq(schema.leagues.id, team.leagueId))
        .get();

      await ctx.reply(
        `✅ You've joined *${team.name}* in *${league?.name ?? "the league"}*!\n\n` +
        "Now complete your registration by sending:\n" +
        "• Your full name\n" +
        "• A photo of your ID/passport\n" +
        "• Your phone number (optional)\n\n" +
        "Use /register to fill in your details.",
        { parse_mode: "Markdown" }
      );

      await ctx.api.sendMessage(
        team.captainId,
        `📋 New player joined *${team.name}*:\n` +
        `${ctx.from?.first_name} (@${ctx.from?.username ?? "no username"})\n\n` +
        `They need to complete /register.`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.error("Failed to join team:", err);
      await ctx.reply("❌ Failed to join team. Are you already registered?");
    }
  });

  // ── Status check ─────────────────────────────────────────
  bot.command("status", async (ctx) => {
    const player = db
      .select()
      .from(schema.players)
      .where(eq(schema.players.telegramId, ctx.from!.id))
      .get();

    if (!player) {
      return ctx.reply(
        "📭 You haven't joined any team yet.\n" +
        "Use /teams to browse teams and /join <code> to join one."
      );
    }

    const team = db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.id, player.teamId))
      .get();

    const league = team
      ? db.select().from(schema.leagues).where(eq(schema.leagues.id, team.leagueId)).get()
      : null;

    await ctx.reply(
      `📋 *Your Status*\n\n` +
      `Team: ${team?.name ?? "N/A"}\n` +
      `League: ${league?.name ?? "N/A"}\n` +
      `Name: ${player.fullName}\n` +
      `Passport: ${player.passportFileId ? "✅ Uploaded" : "❌ Not uploaded"}\n` +
      `Phone: ${player.phone ?? "❌ Not provided"}\n` +
      `Status: *${player.status}*\n\n` +
      (player.passportFileId ? "" : "Use /register to upload your passport."),
      { parse_mode: "Markdown" }
    );
  });
}

// ── Text-based create team (backward compat) ────────────────

async function handleCreateTeamText(ctx: Context, args: string) {
  const spaceIdx = args.indexOf(" ");
  const leagueId = Number(args.slice(0, spaceIdx));
  const teamName = args.slice(spaceIdx + 1).trim();

  if (isNaN(leagueId)) {
    return ctx.reply("Invalid league ID. Use /leagues to see available leagues.");
  }

  const league = db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();

  if (!league) return ctx.reply("❌ League not found.");
  if (league.status !== "active") return ctx.reply("❌ That league is not active.");

  try {
    const inviteCode = generateCode();
    db.insert(schema.teams).values({
      leagueId, name: teamName, captainId: ctx.from!.id, inviteCode, status: "pending",
    }).run();

    await ctx.reply(
      `⏳ Team *"${teamName}"* created in *${league.name}*!\n\n` +
      "Waiting for admin approval.",
      { parse_mode: "Markdown" }
    );

    const newTeam = db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.inviteCode, inviteCode))
      .get();

    const pendingKeyboard = new InlineKeyboard()
      .text("✅ Accept", `approve_team_${newTeam?.id}`)
      .text("❌ Reject", `reject_team_${newTeam?.id}`);

    for (const adminId of env.ADMIN_IDS) {
      try {
        await ctx.api.sendMessage(adminId,
          `📋 *New Team Pending*\n\n` +
          `Team: *${teamName}*\nLeague: ${league.name}\n` +
          `Captain: ${ctx.from?.first_name} (\`${ctx.from!.id}\`)`,
          {
            parse_mode: "Markdown",
            reply_markup: pendingKeyboard,
          }
        );
      } catch {}
    }
  } catch (err) {
    console.error("Failed to create team:", err);
    await ctx.reply("❌ Failed to create team.");
  }
}

// ── Helpers ──────────────────────────────────────────────────

async function showTeamsForLeague(ctx: Context, leagueId: number) {
  const league = db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();

  if (!league) return ctx.reply("❌ League not found.");

  const approvedTeams = db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.leagueId, leagueId))
    .all()
    .filter((t) => t.status === "approved");

  if (approvedTeams.length === 0) {
    return ctx.reply(
      `📭 No approved teams in *${league.name}* yet.\n` +
      "Be the first! Use /create\\_team to create one.",
      { parse_mode: "Markdown" }
    );
  }

  let msg = `🏆 *${league.name}* — Teams\n\n`;
  for (const t of approvedTeams) {
    const playerCount = db
      .select()
      .from(schema.players)
      .where(eq(schema.players.teamId, t.id))
      .all().length;
    msg += `*${t.name}* — ${playerCount} players\n`;
  }

  msg += "\nTo join, ask a captain for their invite code and use:\n`/join <code>`";
  await ctx.reply(msg, { parse_mode: "Markdown" });
}
