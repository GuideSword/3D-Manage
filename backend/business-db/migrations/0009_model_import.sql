CREATE TABLE erp.model_import_jobs (
  id text PRIMARY KEY,
  actor_id text NOT NULL,
  client_job_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('draft','running','cancelling','cancelled','completed','completed_with_errors')),
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_id, client_job_id)
);
CREATE TABLE erp.model_import_items (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES erp.model_import_jobs(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  relative_path text NOT NULL,
  original_name text NOT NULL,
  extension text NOT NULL,
  byte_size bigint NOT NULL,
  sha256 text NOT NULL,
  state text NOT NULL CHECK (state IN ('discovered','queued','preparing','uploading','verifying','completed','duplicate','failed','cancelled','cleaned')),
  model_id text,
  description_facts text NOT NULL DEFAULT '',
  description_ai jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, id),
  UNIQUE(actor_id, job_id, sha256)
);
CREATE INDEX model_import_items_job_state ON erp.model_import_items(job_id, state);
CREATE INDEX model_import_items_actor_sha ON erp.model_import_items(actor_id, sha256);
