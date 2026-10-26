DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS auth_policy;
DELETE FROM schema_migrations WHERE id = '001_auth';
