CREATE TABLE IF NOT EXISTS api_idempotency_keys (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json JSONB NOT NULL,
  status_code INTEGER NOT NULL DEFAULT 200,
  created_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS api_idempotency_unique_idx
  ON api_idempotency_keys (user_id, scope, idempotency_key);

CREATE INDEX IF NOT EXISTS api_idempotency_created_at_idx
  ON api_idempotency_keys (created_at DESC);

CREATE TABLE IF NOT EXISTS standalone_material_entitlements (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  material_id BIGINT NOT NULL,
  granted_at BIGINT NOT NULL,
  granted_by_payment_ref TEXT,
  expires_at BIGINT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS standalone_material_entitlement_unique_idx
  ON standalone_material_entitlements (user_id, material_id);

CREATE INDEX IF NOT EXISTS standalone_material_entitlement_active_idx
  ON standalone_material_entitlements (user_id, is_active, expires_at);

CREATE TABLE IF NOT EXISTS webhook_event_receipts (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT,
  received_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_event_unique_idx
  ON webhook_event_receipts (source, event_id);
