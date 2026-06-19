import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const leagues = sqliteTable("leagues", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").default(""),
  status: text("status").notNull().default("active"), // active | ended
  createdBy: integer("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leagueId: integer("league_id").notNull().references(() => leagues.id),
  name: text("name").notNull(),
  captainId: integer("captain_id").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const players = sqliteTable("players", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id").notNull().references(() => teams.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  passportFileId: text("passport_file_id").notNull(),
  phone: text("phone"),
  addedBy: integer("added_by").notNull(), // captain's telegram_id
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const admins = sqliteTable("admins", {
  telegramId: integer("telegram_id").primaryKey(),
});
