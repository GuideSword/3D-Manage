ALTER TABLE erp.installation ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0);
