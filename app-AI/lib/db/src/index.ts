import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const sslRequired =
  process.env.PGSSLMODE === "require" ||
  databaseUrl.includes("render.com") ||
  databaseUrl.includes("oregon-postgres.render.com");

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl: sslRequired ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
