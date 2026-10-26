import { readFile } from "node:fs/promises";

export async function authSchemaSql(): Promise<string> {
  return readFile(new URL("../migrations/001_auth.sql", import.meta.url), "utf8");
}

export async function ensureAuthSchema(pool: { query: (sql: string) => Promise<unknown> }): Promise<void> {
  const sql = await authSchemaSql();
  const statements = sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) await pool.query(statement);
}
