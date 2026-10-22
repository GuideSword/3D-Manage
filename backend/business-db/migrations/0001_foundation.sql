CREATE TABLE erp.installation (
  id text PRIMARY KEY CHECK (id = 'default'),
  server_id uuid NOT NULL UNIQUE,
  organization_name text NOT NULL,
  initialized_at timestamptz NOT NULL,
  storage_mode text NOT NULL CHECK (storage_mode IN ('legacy', 'relational'))
);
