import { type MiddlewareFn } from "grammy";
import type { Context } from "../types";
import { env } from "../config";

/**
 * Middleware that checks if the user is a member of the private group.
 * If check fails (bot not in group yet, etc.), silently lets them through.
 */
export const gate: MiddlewareFn<Context> = async (ctx, next) => {
  if (ctx.callbackQuery) return next();

  const userId = ctx.from?.id;
  if (!userId) return next();

  if (env.ADMIN_IDS.includes(userId)) return next();

  try {
    const member = await ctx.api.getChatMember(env.GROUP_ID, userId);
    if (member.status === "left" || member.status === "kicked") {
      await ctx.reply(
        "⛔ You need to join the private group first to use this bot.\n" +
        "Join the group and try again."
      );
      return;
    }
    return next();
  } catch {
    // Bot might not be in the group yet — let them through
    return next();
  }
};
