import { defineConfig } from "drizzle-kit";

// DATABASE_URL is only needed for `migrate` and `push` commands, not `generate`.
const url = process.env["DATABASE_URL"] ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  migrations: {
    table: "__drizzle_migrations",
    schema: "public",
  },
});
