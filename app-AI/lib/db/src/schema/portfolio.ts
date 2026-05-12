import { pgTable, serial, integer, real, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { users } from "./users";

export const portfolioHoldings = pgTable("portfolio_holdings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(), // stock | crypto | etf
  quantity: real("quantity").notNull(),
  buyPrice: real("buy_price").notNull(),
  currentPrice: real("current_price").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPortfolioHoldingSchema = createInsertSchema(portfolioHoldings);
export const selectPortfolioHoldingSchema = createSelectSchema(portfolioHoldings);
export type PortfolioHolding = typeof portfolioHoldings.$inferSelect;
export type InsertPortfolioHolding = typeof portfolioHoldings.$inferInsert;
