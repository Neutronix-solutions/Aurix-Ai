import { pgTable, serial, text, real, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const users = pgTable("users", {
  id:              serial("id").primaryKey(),
  email:           text("email").notNull().unique(),
  passwordHash:    text("password_hash").notNull(),
  name:            text("name").notNull(),
  monthlyIncome:   real("monthly_income").default(0),
  language:        text("language").default("en").notNull(),
  phoneNumber:     text("phone_number"),
  isPhoneVerified: boolean("is_phone_verified").default(false).notNull(),
  isEmailVerified: boolean("is_email_verified").default(false).notNull(),
  pendingEmail:    text("pending_email"),
  avatarUrl:       text("avatar_url"),
  currency:        text("currency").default("QAR").notNull(),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
