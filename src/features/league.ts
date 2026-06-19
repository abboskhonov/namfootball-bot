import type { Bot } from "grammy";
import type { Context } from "../types";
import { db, schema } from "../db/db";
import { eq } from "drizzle-orm";

export function setupLeagueCommands(bot: Bot<Context>) {
  // ── List active leagues (for players) ────────────────────
  bot.command("leagues", async (ctx) => {
    const allLeagues = db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.status, "active"))
      .all();

    if (allLeagues.length === 0) {
      return ctx.reply("📭 No active leagues right now.");
    }

    const lines = allLeagues.map(
      (l) => `🏆 *${l.id}.* ${l.name}`
    );

    await ctx.reply(
      "*Active Leagues*\n\n" + lines.join("\n") +
      "\n\nUse /create\\_team <league\\_id> <name> to create a team.",
      { parse_mode: "Markdown" }
    );
  });
}
