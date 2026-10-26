import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { hashPassword, hashSessionToken, newSessionToken } from "./auth-passwords.js";
import { ensureAuthSchema } from "./auth-schema.js";
import { SESSION_LOOKUP_SQL } from "./auth-store.js";
import { closeCatalogue } from "./catalogue-store.js";
import { loadEnvFile } from "./load-env.js";

const enabled = process.env.IOTEDU_AUTH_DB === "1";
if (enabled && !process.env.DATABASE_URL) {
  await loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env"));
}

const CATALOGUE_TABLES = ["components", "component_versions", "firmware_releases", "node_types", "source_blobs"];

const DEVELOPMENT_ENDPOINT = "ep-old-cloud-b4mux8h5";
const PRODUCTION_ENDPOINT = "ep-curly-surf-b49o7rbv";

function assertDevelopmentDatabase(): void {
  const raw = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(raw).hostname;
  } catch {
    host = "";
  }
  const development = host.startsWith(DEVELOPMENT_ENDPOINT);
  const production = host.includes(PRODUCTION_ENDPOINT) || raw.includes("steep-pine") || raw.includes(PRODUCTION_ENDPOINT);
  if (!development || production) {
    throw new Error("Refusing to run authentication database tests against a non-development database.");
  }
}

function scrub(error: unknown): Error {
  const message = error instanceof Error ? error.message : "Authentication database test failed.";
  return new Error(message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]"));
}

async function counts(pool: pg.Pool): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (const name of CATALOGUE_TABLES) {
    const result = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${name}`);
    totals[name] = result.rows[0]?.n ?? 0;
  }
  return totals;
}

describe.skipIf(!enabled)("authentication database", () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: connectionSecurity() });

  afterAll(async () => {
    await pool.end();
    await closeCatalogue();
  });

  it("migrates without changing catalogue rows and rolls authentication writes back", async () => {
    assertDevelopmentDatabase();
    const before = await counts(pool);
    await ensureAuthSchema(pool);
    expect(await counts(pool)).toEqual(before);

    const columns = await pool.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'
    `);
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toContain("password_hash");
    expect(names).not.toContain("password");
    expect(names).not.toContain("token");

    const email = `iotedu-auth-test-${randomUUID()}@example.com`;
    const password = "database test passphrase";
    const passwordHash = await hashPassword(password);
    const session = newSessionToken();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ id: string; password_hash: string }>(`
        INSERT INTO users (id, display_name, email, email_normalized, password_hash, role, status)
        VALUES ($1, 'Auth Test', $2, $2, $3, 'user', 'active')
        RETURNING id, password_hash
      `, [randomUUID(), email, passwordHash]);
      const userId = inserted.rows[0]?.id;
      expect(userId).toBeTruthy();
      expect(inserted.rows[0]?.password_hash.startsWith("$argon2id$")).toBe(true);
      expect(inserted.rows[0]?.password_hash).not.toContain(password);
      await expect(client.query(`
        INSERT INTO users (id, display_name, email, email_normalized, password_hash, role, status)
        VALUES ($1, 'Auth Test', $2, $2, $3, 'user', 'active')
      `, [randomUUID(), email, passwordHash])).rejects.toMatchObject({ code: "23505" });
      await expect(client.query("ROLLBACK")).resolves.toBeTruthy();
      await client.query("BEGIN");
      await expect(client.query(`
        INSERT INTO user_sessions (id, user_id, token_hash, expires_at, idle_seconds)
        VALUES ($1, $2, $3, now() + interval '1 hour', 60)
      `, [randomUUID(), randomUUID(), session.hash])).rejects.toMatchObject({ code: "23503" });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* the failed statement already aborted the transaction */ }
      throw scrub(error);
    } finally {
      try { await client.query("ROLLBACK"); } catch { /* already closed */ }
      client.release();
      await pool.query("DELETE FROM users WHERE email_normalized = $1", [email]);
    }

    const lookup = await pool.connect();
    try {
      await lookup.query("BEGIN");
      const user = await lookup.query<{ id: string }>(`
        INSERT INTO users (id, display_name, email, email_normalized, password_hash, role, status)
        VALUES ($1, 'Auth Test', $2, $2, $3, 'user', 'active')
        RETURNING id
      `, [randomUUID(), email, passwordHash]);
      const userId = user.rows[0]?.id;
      await lookup.query(`
        INSERT INTO user_sessions (id, user_id, token_hash, expires_at, last_used_at, idle_seconds)
        VALUES ($1, $2, $3, now() - interval '1 minute', now() - interval '1 minute', 60)
      `, [randomUUID(), userId, session.hash]);
      const expired = await lookup.query(SESSION_LOOKUP_SQL, [session.hash]);
      expect(expired.rows).toHaveLength(0);
      await lookup.query(`
        UPDATE user_sessions
        SET expires_at = now() + interval '1 hour', last_used_at = now(), revoked_at = NULL
        WHERE token_hash = $1
      `, [session.hash]);
      const current = await lookup.query(SESSION_LOOKUP_SQL, [session.hash]);
      expect(current.rows).toHaveLength(1);
      await lookup.query("UPDATE user_sessions SET revoked_at = now() WHERE token_hash = $1", [session.hash]);
      const revoked = await lookup.query(SESSION_LOOKUP_SQL, [session.hash]);
      expect(revoked.rows).toHaveLength(0);
      const stored = await lookup.query<{ token_hash: string }>("SELECT token_hash FROM user_sessions WHERE token_hash = $1", [session.hash]);
      expect(stored.rows[0]?.token_hash).toBe(hashSessionToken(session.token));
      expect(stored.rows[0]?.token_hash).not.toBe(session.token);
    } catch (error) {
      throw scrub(error);
    } finally {
      try { await lookup.query("ROLLBACK"); } catch { /* already closed */ }
      lookup.release();
      await pool.query("DELETE FROM users WHERE email_normalized = $1", [email]);
    }
  }, 90_000);
});

function connectionSecurity(): { rejectUnauthorized: boolean } | undefined {
  const raw = process.env.DATABASE_URL ?? "";
  return raw.includes("localhost") || raw.includes("127.0.0.1") ? undefined : { rejectUnauthorized: true };
}
