CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  display_name varchar(80) NOT NULL,
  email varchar(254) NOT NULL,
  email_normalized varchar(254) NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  CONSTRAINT users_email_normalized_key UNIQUE (email_normalized),
  CONSTRAINT users_role_check CHECK (role IN ('administrator', 'user')),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT users_password_hash_check CHECK (char_length(password_hash) >= 20),
  CONSTRAINT users_display_name_check CHECK (char_length(display_name) BETWEEN 1 AND 80)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  idle_seconds integer NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT user_sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT user_sessions_token_hash_check CHECK (char_length(token_hash) = 64),
  CONSTRAINT user_sessions_idle_check CHECK (idle_seconds > 0)
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id);

CREATE TABLE IF NOT EXISTS auth_policy (
  singleton boolean PRIMARY KEY DEFAULT true,
  self_registration boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_policy_singleton_check CHECK (singleton)
);

INSERT INTO auth_policy (singleton, self_registration)
VALUES (true, false)
ON CONFLICT (singleton) DO NOTHING;

INSERT INTO schema_migrations (id)
VALUES ('001_auth')
ON CONFLICT (id) DO NOTHING;
