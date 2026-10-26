import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  AuthError,
  publicAccount,
  type AccountRole,
  type AccountStatus,
  type ListedAccount,
  type LoginRecord,
  type NewAccount,
  type PublicAccount,
  type RegistrationPolicy,
  type SessionAccount,
} from "./auth-types.js";

export const AUTH_LOCK_KEY = "841207331002";

export const SESSION_LOOKUP_SQL = `
SELECT
  u.id,
  u.display_name,
  u.email,
  u.role,
  u.status,
  u.created_at,
  u.last_login_at
FROM user_sessions s
JOIN users u ON u.id = s.user_id
WHERE s.token_hash = $1
  AND s.revoked_at IS NULL
  AND s.expires_at > now()
  AND (s.last_used_at + (s.idle_seconds * interval '1 second')) > now()
  AND u.status = 'active'
`;

interface UserRow {
  id: string;
  display_name: string;
  email: string;
  role: AccountRole;
  status: AccountStatus;
  created_at: Date | string;
  last_login_at: Date | string | null;
  password_hash?: string;
}

export interface AuthStore {
  registration(): Promise<RegistrationPolicy>;
  register(input: NewAccount): Promise<SessionAccount>;
  findLogin(emailNormalized: string): Promise<LoginRecord | null>;
  startSession(userId: string, tokenHash: string, absoluteSeconds: number, idleSeconds: number): Promise<PublicAccount>;
  readSession(tokenHash: string): Promise<SessionAccount | null>;
  revokeSession(tokenHash: string): Promise<void>;
  rotatePassword(userId: string, passwordHash: string, tokenHash: string, absoluteSeconds: number, idleSeconds: number): Promise<PublicAccount>;
  updateDisplayName(userId: string, displayName: string): Promise<PublicAccount>;
  listUsers(): Promise<ListedAccount[]>;
  createUser(input: NewAccount & { role: AccountRole }): Promise<ListedAccount>;
  updateUser(emailNormalized: string, patch: { role?: AccountRole; status?: AccountStatus }): Promise<ListedAccount>;
  revokeUserSessions(emailNormalized: string): Promise<void>;
  setSelfRegistration(enabled: boolean): Promise<{ selfRegistration: boolean }>;
}

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function asAccount(row: UserRow): PublicAccount {
  return {
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    lastLoginAt: iso(row.last_login_at),
  };
}

function asListed(row: UserRow): ListedAccount {
  return { ...asAccount(row), status: row.status };
}

function pgCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

function mapWriteError(error: unknown): never {
  if (error instanceof AuthError) throw error;
  if (pgCode(error) === "23505") throw new AuthError("An account with that email already exists.", 409, "email_taken");
  if (pgCode(error) === "23514") throw new AuthError("The account could not be saved.", 400, "invalid_account");
  throw error;
}

const USER_RETURNING = `
RETURNING id, display_name, email, role, status, created_at, last_login_at
`;

export class PostgresAuthStore implements AuthStore {
  constructor(private readonly pool: pg.Pool) {}

  private async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await fn(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original failure, including a unique-email rejection.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async registration(): Promise<RegistrationPolicy> {
    const result = await this.pool.query<{ n: number; self_registration: boolean | null }>(`
      SELECT
        (SELECT count(*)::int FROM users) AS n,
        (SELECT self_registration FROM auth_policy WHERE singleton = true) AS self_registration
    `);
    const row = result.rows[0];
    const count = row?.n ?? 0;
    const selfRegistration = row?.self_registration === true;
    return { open: count === 0 || selfRegistration, bootstrap: count === 0, selfRegistration };
  }

  async register(input: NewAccount): Promise<SessionAccount> {
    try {
      return await this.transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [AUTH_LOCK_KEY]);
        await client.query("INSERT INTO auth_policy (singleton, self_registration) VALUES (true, false) ON CONFLICT (singleton) DO NOTHING");
        const policy = await client.query<{ n: number; self_registration: boolean }>(`
          SELECT
            (SELECT count(*)::int FROM users) AS n,
            (SELECT self_registration FROM auth_policy WHERE singleton = true) AS self_registration
        `);
        const count = policy.rows[0]?.n ?? 0;
        const selfRegistration = policy.rows[0]?.self_registration === true;
        if (count > 0 && !selfRegistration) {
          throw new AuthError("Account creation is closed. Ask an administrator for an account.", 403, "registration_closed");
        }
        const inserted = await client.query<UserRow>(`
          INSERT INTO users (id, display_name, email, email_normalized, password_hash, role, status)
          VALUES ($1, $2, $3, $4, $5, $6, 'active')
          ${USER_RETURNING}
        `, [
          randomUUID(),
          input.displayName,
          input.email,
          input.emailNormalized,
          input.passwordHash,
          count === 0 ? "administrator" : "user",
        ]);
        const row = inserted.rows[0];
        if (!row) throw new AuthError("The account could not be saved.", 503, "unavailable");
        return { ...asAccount(row), id: row.id };
      });
    } catch (error) {
      mapWriteError(error);
    }
  }

  async findLogin(emailNormalized: string): Promise<LoginRecord | null> {
    const result = await this.pool.query<UserRow>(`
      SELECT id, display_name, email, role, status, created_at, last_login_at, password_hash
      FROM users
      WHERE email_normalized = $1
    `, [emailNormalized]);
    const row = result.rows[0];
    if (!row?.password_hash) return null;
    return { id: row.id, passwordHash: row.password_hash, status: row.status, account: asAccount(row) };
  }

  async startSession(userId: string, tokenHash: string, absoluteSeconds: number, idleSeconds: number): Promise<PublicAccount> {
    return this.transaction(async (client) => {
      const updated = await client.query<UserRow>(`
        UPDATE users
        SET last_login_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'active'
        ${USER_RETURNING}
      `, [userId]);
      const row = updated.rows[0];
      if (!row) throw new AuthError("Invalid email or password.", 401, "invalid_login");
      await client.query(`
        INSERT INTO user_sessions (id, user_id, token_hash, expires_at, last_used_at, idle_seconds)
        VALUES ($1, $2, $3, now() + ($4 * interval '1 second'), now(), $5)
      `, [randomUUID(), userId, tokenHash, absoluteSeconds, idleSeconds]);
      return asAccount(row);
    });
  }

  async readSession(tokenHash: string): Promise<SessionAccount | null> {
    const result = await this.pool.query<UserRow>(SESSION_LOOKUP_SQL, [tokenHash]);
    const row = result.rows[0];
    if (!row) return null;
    await this.pool.query(`
      UPDATE user_sessions
      SET last_used_at = now()
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND last_used_at < now() - interval '30 seconds'
    `, [tokenHash]);
    return { ...asAccount(row), id: row.id };
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.pool.query(`
      UPDATE user_sessions
      SET revoked_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL
    `, [tokenHash]);
  }

  async rotatePassword(userId: string, passwordHash: string, tokenHash: string, absoluteSeconds: number, idleSeconds: number): Promise<PublicAccount> {
    return this.transaction(async (client) => {
      const updated = await client.query<UserRow>(`
        UPDATE users
        SET password_hash = $2, updated_at = now()
        WHERE id = $1 AND status = 'active'
        ${USER_RETURNING}
      `, [userId, passwordHash]);
      const row = updated.rows[0];
      if (!row) throw new AuthError("Sign in to continue.", 401, "unauthenticated");
      await client.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
      await client.query(`
        INSERT INTO user_sessions (id, user_id, token_hash, expires_at, last_used_at, idle_seconds)
        VALUES ($1, $2, $3, now() + ($4 * interval '1 second'), now(), $5)
      `, [randomUUID(), userId, tokenHash, absoluteSeconds, idleSeconds]);
      return asAccount(row);
    });
  }

  async updateDisplayName(userId: string, displayName: string): Promise<PublicAccount> {
    const updated = await this.pool.query<UserRow>(`
      UPDATE users
      SET display_name = $2, updated_at = now()
      WHERE id = $1 AND status = 'active'
      ${USER_RETURNING}
    `, [userId, displayName]);
    const row = updated.rows[0];
    if (!row) throw new AuthError("Sign in to continue.", 401, "unauthenticated");
    return asAccount(row);
  }

  async listUsers(): Promise<ListedAccount[]> {
    const result = await this.pool.query<UserRow>(`
      SELECT id, display_name, email, role, status, created_at, last_login_at
      FROM users
      ORDER BY created_at, email_normalized
    `);
    return result.rows.map(asListed);
  }

  async createUser(input: NewAccount & { role: AccountRole }): Promise<ListedAccount> {
    try {
      return await this.transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [AUTH_LOCK_KEY]);
        const count = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM users");
        const role = (count.rows[0]?.n ?? 0) === 0 ? "administrator" : input.role;
        const inserted = await client.query<UserRow>(`
          INSERT INTO users (id, display_name, email, email_normalized, password_hash, role, status)
          VALUES ($1, $2, $3, $4, $5, $6, 'active')
          ${USER_RETURNING}
        `, [randomUUID(), input.displayName, input.email, input.emailNormalized, input.passwordHash, role]);
        const row = inserted.rows[0];
        if (!row) throw new AuthError("The account could not be saved.", 503, "unavailable");
        return asListed(row);
      });
    } catch (error) {
      mapWriteError(error);
    }
  }

  async updateUser(emailNormalized: string, patch: { role?: AccountRole; status?: AccountStatus }): Promise<ListedAccount> {
    try {
      return await this.transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [AUTH_LOCK_KEY]);
        const existing = await client.query<UserRow>(`
          SELECT id, display_name, email, role, status, created_at, last_login_at
          FROM users
          WHERE email_normalized = $1
          FOR UPDATE
        `, [emailNormalized]);
        const row = existing.rows[0];
        if (!row) throw new AuthError("Account not found.", 404, "not_found");
        const nextRole = patch.role ?? row.role;
        const nextStatus = patch.status ?? row.status;
        await assertAdminRemains(client, row, nextRole, nextStatus);
        const updated = await client.query<UserRow>(`
          UPDATE users
          SET role = $2, status = $3, updated_at = now()
          WHERE id = $1
          ${USER_RETURNING}
        `, [row.id, nextRole, nextStatus]);
        if (nextRole !== row.role || nextStatus !== row.status) {
          await client.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [row.id]);
        }
        const saved = updated.rows[0];
        if (!saved) throw new AuthError("The account could not be saved.", 503, "unavailable");
        return asListed(saved);
      });
    } catch (error) {
      mapWriteError(error);
    }
  }

  async revokeUserSessions(emailNormalized: string): Promise<void> {
    const result = await this.pool.query<{ id: string }>("SELECT id FROM users WHERE email_normalized = $1", [emailNormalized]);
    const row = result.rows[0];
    if (!row) throw new AuthError("Account not found.", 404, "not_found");
    await this.pool.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [row.id]);
  }

  async setSelfRegistration(enabled: boolean): Promise<{ selfRegistration: boolean }> {
    await this.pool.query(`
      INSERT INTO auth_policy (singleton, self_registration) VALUES (true, $1)
      ON CONFLICT (singleton) DO UPDATE SET self_registration = EXCLUDED.self_registration, updated_at = now()
    `, [enabled]);
    return { selfRegistration: enabled };
  }
}

async function assertAdminRemains(client: pg.PoolClient, row: UserRow, nextRole: AccountRole, nextStatus: AccountStatus): Promise<void> {
  const keepsAdmin = nextRole === "administrator" && nextStatus === "active";
  if (row.role !== "administrator" || row.status !== "active" || keepsAdmin) return;
  const admins = await client.query<{ n: number }>(`
    SELECT count(*)::int AS n FROM users WHERE role = 'administrator' AND status = 'active'
  `);
  if ((admins.rows[0]?.n ?? 0) <= 1) {
    throw new AuthError("Keep at least one active administrator.", 409, "last_administrator");
  }
}

interface StoredUser {
  id: string;
  displayName: string;
  email: string;
  emailNormalized: string;
  passwordHash: string;
  role: AccountRole;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

interface StoredSession {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
  idleSeconds: number;
  revokedAt: string | null;
}

export class MemoryAuthStore implements AuthStore {
  private readonly users = new Map<string, StoredUser>();
  private readonly sessions = new Map<string, StoredSession>();
  private selfRegistration = false;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly now: () => Date = () => new Date()) {}

  private exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.tail.then(() => fn());
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private at(): string {
    return this.now().toISOString();
  }

  private account(user: StoredUser): PublicAccount {
    return publicAccount(user);
  }

  private listed(user: StoredUser): ListedAccount {
    return { ...this.account(user), status: user.status };
  }

  private insert(input: NewAccount, role: AccountRole): StoredUser {
    const user: StoredUser = {
      id: randomUUID(),
      displayName: input.displayName,
      email: input.email,
      emailNormalized: input.emailNormalized,
      passwordHash: input.passwordHash,
      role,
      status: "active",
      createdAt: this.at(),
      updatedAt: this.at(),
      lastLoginAt: null,
    };
    this.users.set(user.id, user);
    return user;
  }

  private byEmail(emailNormalized: string): StoredUser | null {
    for (const user of this.users.values()) {
      if (user.emailNormalized === emailNormalized) return user;
    }
    return null;
  }

  async registration(): Promise<RegistrationPolicy> {
    return {
      open: this.users.size === 0 || this.selfRegistration,
      bootstrap: this.users.size === 0,
      selfRegistration: this.selfRegistration,
    };
  }

  register(input: NewAccount): Promise<SessionAccount> {
    return this.exclusive(() => {
      if (this.users.size > 0 && !this.selfRegistration) {
        throw new AuthError("Account creation is closed. Ask an administrator for an account.", 403, "registration_closed");
      }
      if (this.byEmail(input.emailNormalized)) {
        throw new AuthError("An account with that email already exists.", 409, "email_taken");
      }
      const role = this.users.size === 0 ? "administrator" : "user";
      const user = this.insert(input, role);
      return { ...this.account(user), id: user.id };
    });
  }

  async findLogin(emailNormalized: string): Promise<LoginRecord | null> {
    const user = this.byEmail(emailNormalized);
    if (!user) return null;
    return { id: user.id, passwordHash: user.passwordHash, status: user.status, account: this.account(user) };
  }

  async startSession(userId: string, tokenHash: string, absoluteSeconds: number, idleSeconds: number): Promise<PublicAccount> {
    const user = this.users.get(userId);
    if (!user || user.status !== "active") throw new AuthError("Invalid email or password.", 401, "invalid_login");
    user.lastLoginAt = this.at();
    user.updatedAt = user.lastLoginAt;
    this.remember(userId, tokenHash, absoluteSeconds, idleSeconds);
    return this.account(user);
  }

  async readSession(tokenHash: string): Promise<SessionAccount | null> {
    const session = this.sessions.get(tokenHash);
    if (!session || session.revokedAt) return null;
    const moment = this.now().getTime();
    if (new Date(session.expiresAt).getTime() <= moment) return null;
    if (new Date(session.lastUsedAt).getTime() + session.idleSeconds * 1000 <= moment) return null;
    const user = this.users.get(session.userId);
    if (!user || user.status !== "active") return null;
    if (moment - new Date(session.lastUsedAt).getTime() > 30_000) session.lastUsedAt = new Date(moment).toISOString();
    return { ...this.account(user), id: user.id };
  }

  async revokeSession(tokenHash: string): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session && !session.revokedAt) session.revokedAt = this.at();
  }

  async rotatePassword(userId: string, passwordHash: string, tokenHash: string, absoluteSeconds: number, idleSeconds: number): Promise<PublicAccount> {
    const user = this.users.get(userId);
    if (!user || user.status !== "active") throw new AuthError("Sign in to continue.", 401, "unauthenticated");
    const previous = user.passwordHash;
    user.passwordHash = passwordHash;
    try {
      user.updatedAt = this.at();
      this.revokeAll(userId);
      this.remember(userId, tokenHash, absoluteSeconds, idleSeconds);
      return this.account(user);
    } catch (error) {
      user.passwordHash = previous;
      throw error;
    }
  }

  async updateDisplayName(userId: string, displayName: string): Promise<PublicAccount> {
    const user = this.users.get(userId);
    if (!user || user.status !== "active") throw new AuthError("Sign in to continue.", 401, "unauthenticated");
    user.displayName = displayName;
    user.updatedAt = this.at();
    return this.account(user);
  }

  async listUsers(): Promise<ListedAccount[]> {
    return [...this.users.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.emailNormalized.localeCompare(right.emailNormalized))
      .map((user) => this.listed(user));
  }

  createUser(input: NewAccount & { role: AccountRole }): Promise<ListedAccount> {
    return this.exclusive(() => {
      if (this.byEmail(input.emailNormalized)) {
        throw new AuthError("An account with that email already exists.", 409, "email_taken");
      }
      const role = this.users.size === 0 ? "administrator" : input.role;
      return this.listed(this.insert(input, role));
    });
  }

  updateUser(emailNormalized: string, patch: { role?: AccountRole; status?: AccountStatus }): Promise<ListedAccount> {
    return this.exclusive(() => {
      const user = this.byEmail(emailNormalized);
      if (!user) throw new AuthError("Account not found.", 404, "not_found");
      const nextRole = patch.role ?? user.role;
      const nextStatus = patch.status ?? user.status;
      const keepsAdmin = nextRole === "administrator" && nextStatus === "active";
      const changed = nextRole !== user.role || nextStatus !== user.status;
      const activeAdmins = [...this.users.values()].filter((item) => item.role === "administrator" && item.status === "active").length;
      if (user.role === "administrator" && user.status === "active" && !keepsAdmin && activeAdmins <= 1) {
        throw new AuthError("Keep at least one active administrator.", 409, "last_administrator");
      }
      user.role = nextRole;
      user.status = nextStatus;
      user.updatedAt = this.at();
      if (changed) this.revokeAll(user.id);
      return this.listed(user);
    });
  }

  async revokeUserSessions(emailNormalized: string): Promise<void> {
    const user = this.byEmail(emailNormalized);
    if (!user) throw new AuthError("Account not found.", 404, "not_found");
    this.revokeAll(user.id);
  }

  async setSelfRegistration(enabled: boolean): Promise<{ selfRegistration: boolean }> {
    this.selfRegistration = enabled;
    return { selfRegistration: enabled };
  }

  private remember(userId: string, tokenHash: string, absoluteSeconds: number, idleSeconds: number): void {
    const created = this.now();
    this.sessions.set(tokenHash, {
      id: randomUUID(),
      userId,
      tokenHash,
      createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + absoluteSeconds * 1000).toISOString(),
      lastUsedAt: created.toISOString(),
      idleSeconds,
      revokedAt: null,
    });
  }

  private revokeAll(userId: string): void {
    const moment = this.at();
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt) session.revokedAt = moment;
    }
  }
}

export function unavailableAuthStore(): AuthStore {
  const fail = async (): Promise<never> => {
    throw new AuthError("Unable to connect. Please try again.", 503, "unavailable");
  };
  return new Proxy({} as AuthStore, {
    get() {
      return fail;
    },
  });
}
