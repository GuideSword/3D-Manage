ALTER TABLE erp.users ADD COLUMN last_login_at timestamptz;
UPDATE erp.users SET last_login_at=(legacy_payload->>'lastLoginAt')::timestamptz
  WHERE nullif(legacy_payload->>'lastLoginAt','') IS NOT NULL;

CREATE TABLE erp.user_write_guard (
  id text PRIMARY KEY CHECK (id='default'),
  epoch boolean NOT NULL DEFAULT false
);
INSERT INTO erp.user_write_guard(id) VALUES('default');

-- Updating a sentinel tuple serializes reductions and forces a serialization error
-- for a repeatable-read transaction that would otherwise inspect a stale Owner count.
CREATE FUNCTION erp.lock_user_mutations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE erp.user_write_guard SET epoch=NOT epoch WHERE id='default';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User mutation guard is missing' USING ERRCODE='55000';
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER users_mutation_lock BEFORE UPDATE OR DELETE ON erp.users
  FOR EACH STATEMENT EXECUTE FUNCTION erp.lock_user_mutations();

CREATE FUNCTION erp.protect_last_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.role='owner' AND NEW.active THEN RETURN NULL; END IF;
  END IF;
  IF OLD.role='owner' AND OLD.active THEN
    IF NOT EXISTS(SELECT 1 FROM erp.users WHERE role='owner' AND active) THEN
      RAISE EXCEPTION 'At least one active Owner must remain'
        USING ERRCODE='23514', CONSTRAINT='users_last_owner';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER users_last_owner AFTER UPDATE OR DELETE ON erp.users
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp.protect_last_owner();
