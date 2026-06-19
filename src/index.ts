import { createBot } from "./bot";
import { db } from "./db/db";
import { admins } from "./db/schema";
import { env } from "./config";

// Ensure admins from env are in the DB
for (const id of env.ADMIN_IDS) {
  db.insert(admins)
    .values({ telegramId: id })
    .onConflictDoNothing()
    .run();
}

const bot = await createBot();

// Start polling
bot.start();

console.log("🤖 NamFootball Bot is running...");

// Graceful shutdown
process.on("SIGINT", () => {
  bot.stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  bot.stop();
  process.exit(0);
});
