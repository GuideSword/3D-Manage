ALTER TABLE erp.orders ADD COLUMN status_reason text NOT NULL DEFAULT '';
UPDATE erp.orders SET status_reason = coalesce(legacy_payload->>'statusReason', '');

-- Reordering retains line IDs and future production references. Check positions at commit.
ALTER TABLE erp.order_items DROP CONSTRAINT order_items_order_id_position_key;
ALTER TABLE erp.order_items ADD CONSTRAINT order_items_order_id_position_key
  UNIQUE (order_id, position) DEFERRABLE INITIALLY DEFERRED;
