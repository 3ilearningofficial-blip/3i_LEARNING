-- ODSR-01: Per-device server-issued secrets for offline encryption key derivation.
--
-- Each device gets one 32-byte random secret, issued by the server on first download
-- setup and never reissued.  The plaintext secret is stored ONLY in the device's
-- SecureStore (iOS Keychain / Android Keystore).  The server stores only a
-- HMAC-SHA256 of the secret for audit purposes — it cannot reconstruct the secret.
--
-- Threat model improvement:
--   Old:  key = PBKDF2(sessionToken:deviceId, salt)
--         Extractable if an attacker has both sessionToken (from AsyncStorage) and
--         deviceId (from AsyncStorage) — possible on rooted Android via ADB.
--   New:  key = PBKDF2(sessionToken:deviceId:serverNonce, salt)
--         Also requires the server nonce, which lives only in SecureStore (hardware-
--         backed on modern Android/iOS) — substantially harder to extract.

CREATE TABLE IF NOT EXISTS device_offline_secrets (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id  TEXT    NOT NULL,
  -- HMAC-SHA256(secret, OTP_HMAC_SECRET) — for auditing only; cannot reconstruct plaintext
  secret_hash TEXT   NOT NULL,
  issued_at  BIGINT  NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_offline_secrets_user
  ON device_offline_secrets (user_id);
