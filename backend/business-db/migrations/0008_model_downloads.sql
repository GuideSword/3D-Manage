CREATE TABLE erp.model_download_policy (
  id text PRIMARY KEY CHECK (id = 'default'),
  enabled boolean NOT NULL DEFAULT false,
  password_hash text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (NOT enabled OR password_hash IS NOT NULL)
);
INSERT INTO erp.model_download_policy(id) VALUES ('default');
CREATE TABLE erp.model_download_grants (
  hash text PRIMARY KEY CHECK (hash ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL REFERENCES erp.users(id) ON DELETE CASCADE,
  token_version bigint NOT NULL,
  policy_version bigint NOT NULL,
  file_key text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('download','handoff','transfer')),
  expires_at bigint NOT NULL,
  consumed boolean NOT NULL DEFAULT false
);
CREATE INDEX model_download_grants_expiry ON erp.model_download_grants(expires_at);
CREATE TABLE erp.model_download_attempts (
  actor_id text PRIMARY KEY REFERENCES erp.users(id) ON DELETE CASCADE,
  count integer NOT NULL CHECK (count >= 0),
  until_ms bigint NOT NULL
);
