import { pgTable, serial, integer, real, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { users } from "./users";

export const bills = pgTable("bills", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  merchantName: text("merchant_name"),
  amount: real("amount").notNull(),
  currency: text("currency").default("QAR").notNull(),
  frequency: text("frequency").default("monthly").notNull(),
  category: text("category").notNull(),
  icon: text("icon").default("💳").notNull(),
  color: text("color").default("#6C63FF").notNull(),
  lastPaid: timestamp("last_paid"),
  nextDue: timestamp("next_due"),
  isActive: boolean("is_active").default(true).notNull(),
  isAutoDetected: boolean("is_auto_detected").default(false).notNull(),
  isConfirmed: boolean("is_confirmed").default(false).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertBillSchema = createInsertSchema(bills);
export const selectBillSchema = createSelectSchema(bills);
export type Bill = typeof bills.$inferSelect;
export type InsertBill = typeof bills.$inferInsert;
