-- Unconstrained numeric domains reject excess precision instead of silently rounding.
CREATE DOMAIN erp.quantity3 AS numeric
  CHECK (VALUE > 0 AND VALUE < 1e15 AND VALUE = round(VALUE, 3));
CREATE DOMAIN erp.price6 AS numeric
  CHECK (VALUE >= 0 AND VALUE < 1e14 AND VALUE = round(VALUE, 6));
CREATE DOMAIN erp.money2 AS numeric
  CHECK (VALUE >= 0 AND VALUE < 1e18 AND VALUE = round(VALUE, 2));

CREATE TABLE erp.users (
  id text PRIMARY KEY CHECK (length(id) > 0),
  email text NOT NULL CHECK (length(btrim(email)) > 0 AND email = btrim(email)),
  name text NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('owner', 'staff', 'viewer')),
  password_hash text NOT NULL CHECK (length(password_hash) > 0),
  token_version bigint NOT NULL DEFAULT 1 CHECK (token_version > 0),
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  legacy_payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(legacy_payload) = 'object')
);
CREATE UNIQUE INDEX users_email_unique ON erp.users (lower(email));

CREATE TABLE erp.customers (
  id text PRIMARY KEY CHECK (length(id) > 0),
  code text NOT NULL UNIQUE CHECK (length(btrim(code)) > 0),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  contact_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  legacy_payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(legacy_payload) = 'object')
);
CREATE TABLE erp.suppliers (LIKE erp.customers INCLUDING ALL);

CREATE TABLE erp.warehouses (
  id text PRIMARY KEY CHECK (length(id) > 0),
  code text NOT NULL UNIQUE CHECK (length(btrim(code)) > 0),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_default OR active)
);
CREATE UNIQUE INDEX warehouses_single_default ON erp.warehouses (is_default) WHERE is_default;

CREATE TABLE erp.materials (
  id text PRIMARY KEY CHECK (length(id) > 0),
  code text,
  name text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT '',
  brand text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '',
  diameter numeric,
  density numeric,
  unit text NOT NULL DEFAULT 'g',
  unit_price erp.price6,
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  legacy_payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(legacy_payload) = 'object')
);
CREATE UNIQUE INDEX materials_code_unique ON erp.materials (code) WHERE code IS NOT NULL AND code <> '';

CREATE TABLE erp.models (
  id text PRIMARY KEY CHECK (length(id) > 0),
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  legacy_payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(legacy_payload) = 'object')
);
CREATE TABLE erp.model_files (
  model_id text NOT NULL REFERENCES erp.models(id),
  id text NOT NULL CHECK (length(id) > 0),
  position integer NOT NULL CHECK (position >= 0),
  file_key text,
  url text,
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  PRIMARY KEY (model_id, id),
  UNIQUE (model_id, position)
);
CREATE TABLE erp.model_images (LIKE erp.model_files INCLUDING ALL);
ALTER TABLE erp.model_images ADD FOREIGN KEY (model_id) REFERENCES erp.models(id);

CREATE TABLE erp.orders (
  id text PRIMARY KEY CHECK (length(id) > 0),
  number text NOT NULL UNIQUE CHECK (length(btrim(number)) > 0),
  customer_id text NOT NULL REFERENCES erp.customers(id),
  customer_snapshot jsonb NOT NULL CHECK (jsonb_typeof(customer_snapshot) = 'object'),
  status text NOT NULL CHECK (status IN ('draft', 'pending_review', 'in_progress', 'completed', 'cancelled')),
  currency text NOT NULL DEFAULT 'CNY' CHECK (currency = 'CNY'),
  total erp.money2 NOT NULL,
  notes text NOT NULL DEFAULT '',
  due_date text,
  created_by text NOT NULL REFERENCES erp.users(id),
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  legacy_payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(legacy_payload) = 'object')
);
CREATE INDEX orders_customer ON erp.orders(customer_id);
CREATE INDEX orders_created_by ON erp.orders(created_by);

CREATE TABLE erp.order_items (
  order_id text NOT NULL REFERENCES erp.orders(id),
  id text NOT NULL CHECK (length(id) > 0),
  position integer NOT NULL CHECK (position >= 0),
  model_id text REFERENCES erp.models(id),
  model_name_snapshot text NOT NULL DEFAULT '',
  quantity erp.quantity3 NOT NULL,
  unit_price erp.price6 NOT NULL,
  subtotal erp.money2 NOT NULL,
  spec_snapshot jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(spec_snapshot) = 'object'),
  PRIMARY KEY (order_id, id),
  UNIQUE (order_id, position)
);
CREATE INDEX order_items_model ON erp.order_items(model_id);
CREATE TABLE erp.order_attachments (
  order_id text NOT NULL REFERENCES erp.orders(id),
  position integer NOT NULL CHECK (position >= 0),
  file_key text,
  original_name text,
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  PRIMARY KEY (order_id, position)
);

CREATE TABLE erp.stock_lots (
  id text PRIMARY KEY CHECK (length(id) > 0),
  material_id text NOT NULL REFERENCES erp.materials(id),
  warehouse_id text NOT NULL REFERENCES erp.warehouses(id),
  lot_no text NOT NULL DEFAULT '',
  serial_no text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  photo_key text NOT NULL DEFAULT '',
  qty_mg bigint,
  baseline_qty_mg bigint,
  balance_status text NOT NULL CHECK (balance_status IN ('tracked', 'legacy_unverified', 'legacy_invalid')),
  state text NOT NULL DEFAULT 'in_stock' CHECK (state IN ('in_stock', 'frozen', 'scrapped')),
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  ledger_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  legacy_payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(legacy_payload) = 'object'),
  CHECK ((balance_status = 'legacy_invalid' AND NOT active)
    OR (balance_status <> 'legacy_invalid' AND qty_mg IS NOT NULL AND qty_mg >= 0
      AND baseline_qty_mg IS NOT NULL AND baseline_qty_mg >= 0)),
  CHECK (balance_status <> 'tracked' OR baseline_qty_mg = 0)
);
CREATE INDEX stock_lots_material ON erp.stock_lots(material_id);
CREATE INDEX stock_lots_warehouse ON erp.stock_lots(warehouse_id);

CREATE TABLE erp.inventory_txns (
  id text PRIMARY KEY CHECK (length(id) > 0),
  lot_id text NOT NULL REFERENCES erp.stock_lots(id),
  order_id text REFERENCES erp.orders(id),
  actor_id text REFERENCES erp.users(id),
  legacy_actor_id text,
  type text NOT NULL,
  qty_mg bigint,
  before_qty_mg bigint,
  after_qty_mg bigint,
  delta_qty_mg bigint,
  ledger_version integer,
  source text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  legacy_payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(legacy_payload) = 'object'),
  CHECK (ledger_version IS NULL OR ledger_version = 1),
  CHECK (ledger_version IS NULL OR (
    type IN ('in', 'out', 'adjust', 'scrap') AND qty_mg IS NOT NULL AND qty_mg >= 0
    AND before_qty_mg IS NOT NULL AND before_qty_mg >= 0
    AND after_qty_mg IS NOT NULL AND after_qty_mg >= 0 AND delta_qty_mg IS NOT NULL
    AND after_qty_mg::numeric - before_qty_mg::numeric = delta_qty_mg::numeric
    AND ((type = 'in' AND qty_mg > 0 AND delta_qty_mg = qty_mg)
      OR (type IN ('out', 'scrap') AND qty_mg > 0 AND delta_qty_mg::numeric = -qty_mg::numeric)
      OR (type = 'adjust' AND qty_mg = after_qty_mg))
  ))
);
CREATE INDEX inventory_txns_lot ON erp.inventory_txns(lot_id);
CREATE INDEX inventory_txns_order ON erp.inventory_txns(order_id);
CREATE INDEX inventory_txns_actor ON erp.inventory_txns(actor_id);

CREATE TABLE erp.audit_logs (
  id text PRIMARY KEY CHECK (length(id) > 0),
  actor_id text REFERENCES erp.users(id),
  legacy_actor_id text,
  entity text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  legacy_payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(legacy_payload) = 'object')
);
CREATE INDEX audit_logs_entity ON erp.audit_logs(entity, entity_id);
CREATE INDEX audit_logs_actor ON erp.audit_logs(actor_id);

CREATE TABLE erp.command_receipts (
  id text PRIMARY KEY CHECK (length(id) > 0),
  scope text NOT NULL CHECK (length(scope) > 0),
  actor_id text REFERENCES erp.users(id),
  legacy_actor_id text,
  key text NOT NULL CHECK (length(key) > 0),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  status_code integer NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  legacy_payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(legacy_payload) = 'object'),
  CHECK (actor_id IS NOT NULL OR legacy_actor_id IS NOT NULL)
);
CREATE UNIQUE INDEX command_receipts_identity ON erp.command_receipts(scope, (coalesce(actor_id, legacy_actor_id)), key);

CREATE TABLE erp.object_uploads (
  id text PRIMARY KEY CHECK (length(id) > 0),
  owner_id text REFERENCES erp.users(id),
  legacy_owner_id text,
  file_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX object_uploads_owner ON erp.object_uploads(owner_id);

CREATE TABLE erp.migration_runs (
  id text PRIMARY KEY CHECK (length(id) > 0),
  source_sha256 text NOT NULL UNIQUE CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  decisions_sha256 text NOT NULL CHECK (decisions_sha256 ~ '^[a-f0-9]{64}$'),
  source_raw text NOT NULL,
  decisions jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('importing', 'completed')),
  report jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE TABLE erp.legacy_id_map (
  run_id text NOT NULL REFERENCES erp.migration_runs(id),
  collection text NOT NULL,
  source_id text NOT NULL,
  target_table text NOT NULL CHECK (target_table IN ('users', 'customers', 'materials', 'models', 'orders', 'stock_lots', 'inventory_txns', 'audit_logs', 'command_receipts', 'object_uploads')),
  target_id text NOT NULL,
  PRIMARY KEY (run_id, collection, source_id, target_table)
);

CREATE FUNCTION erp.reject_fact_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Historical facts cannot be edited or deleted' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER inventory_txns_immutable BEFORE UPDATE OR DELETE ON erp.inventory_txns
  FOR EACH ROW EXECUTE FUNCTION erp.reject_fact_mutation();
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON erp.audit_logs
  FOR EACH ROW EXECUTE FUNCTION erp.reject_fact_mutation();
CREATE TRIGGER command_receipts_immutable BEFORE UPDATE OR DELETE ON erp.command_receipts
  FOR EACH ROW EXECUTE FUNCTION erp.reject_fact_mutation();
