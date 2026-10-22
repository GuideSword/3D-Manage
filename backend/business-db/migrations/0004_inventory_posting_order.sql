-- Preserve pre-existing facts: their relative order is unknown, so leave it NULL.
CREATE SEQUENCE erp.inventory_posting_seq AS bigint;
ALTER TABLE erp.inventory_txns ADD COLUMN posting_seq bigint;
ALTER TABLE erp.inventory_txns ALTER COLUMN posting_seq SET DEFAULT nextval('erp.inventory_posting_seq');
ALTER SEQUENCE erp.inventory_posting_seq OWNED BY erp.inventory_txns.posting_seq;
CREATE UNIQUE INDEX inventory_posting_seq_unique ON erp.inventory_txns(posting_seq) WHERE posting_seq IS NOT NULL;
CREATE INDEX inventory_txns_lot_posting ON erp.inventory_txns(lot_id, posting_seq DESC);
