import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { env } from "../config";
import * as schema from "./schema";

const sqlite = new Database(env.DB_PATH);
sqlite.run("PRAGMA journal_mode = WAL;");
sqlite.run("PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite, { schema });
export { schema };
