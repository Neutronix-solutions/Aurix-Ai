import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { fileURLToPath } from "url";
import path from "path";

const { Pool } = pg;

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "../drizzle");

const pool = new Pool({ connectionString: url });
const db = drizzle(pool);

console.log("[migrate] Running migrations from", migrationsFolder);
await migrate(db, { migrationsFolder });
console.log("[migrate] All migrations applied successfully");
await pool.end();
