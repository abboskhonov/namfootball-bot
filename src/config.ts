import { z } from "zod";

// Bun auto-loads .env — no dotenv needed

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN is required"),
  // Group ID can be positive (basic group) or negative (supergroup -100...)
  GROUP_ID: z.coerce.number().int(),
  ADMIN_IDS: z.string().transform((s) => s.split(",").map(Number)),
  DB_PATH: z.string().default("./data/namfootball.db"),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
