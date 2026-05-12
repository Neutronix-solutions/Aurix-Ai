import { integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { users } from "./users";

export const income = pgTable("income", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().$type<number>(),
  source: text("source").notNull().default("Salary"),
  description: text("description"),
  date: timestamp("date", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  originalAmount: numeric("original_amount", { precision: 12, scale: 2 }).$type<number>(),
  originalCurrency: text("original_currency").default("QAR").notNull(),
  exchangeRateUsed: numeric("exchange_rate_used", { precision: 12, scale: 6 }).default("1").$type<number>(),
});

export const insertIncomeSchema = createInsertSchema(income).omit({
  id: true,
  createdAt: true,
});

export type Income = typeof income.$inferSelect;
export type InsertIncome = z.infer<typeof insertIncomeSchema>;
