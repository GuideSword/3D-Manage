CREATE TABLE erp.runtime_control (
  id text PRIMARY KEY CHECK (id = 'default'),
  state text NOT NULL CHECK (state IN ('open', 'maintenance')),
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 1000),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO erp.runtime_control(id,state) VALUES('default','open');
