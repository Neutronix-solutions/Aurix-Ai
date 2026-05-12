import { pgTable, serial, integer, real, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const goldAssets = pgTable("gold_assets", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  goldType:     text("gold_type").notNull(),       // 24K | 21K | 18K | coin | bar
  quantityGrams: real("quantity_grams").notNull().default(0),
  avgBuyPrice:  real("avg_buy_price").notNull(),   // QAR per gram (pure equiv)
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
});

export const goldTransactions = pgTable("gold_transactions", {
  id:            serial("id").primaryKey(),
  userId:        integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type:          text("type").notNull(),           // buy | sell
  goldType:      text("gold_type").notNull(),
  quantityGrams: real("quantity_grams").notNull(),
  pricePerGram:  real("price_per_gram").notNull(), // QAR per gram at time of purchase
  totalAmount:   real("total_amount").notNull(),   // QAR
  storeName:     text("store_name"),
  storeId:       text("store_id"),
  note:          text("note"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});

export type GoldAsset       = typeof goldAssets.$inferSelect;
export type GoldTransaction = typeof goldTransactions.$inferSelect;
