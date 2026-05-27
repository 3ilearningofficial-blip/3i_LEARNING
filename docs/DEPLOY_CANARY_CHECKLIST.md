# Deploy Canary Checklist

## Pre-Deploy

1. Confirm `main` is green in CI (`validate`, `db-schema`).
2. Confirm migrations are applied in staging.
3. Verify required env vars are present (`DATABASE_URL`, `SESSION_SECRET`, `OTP_HMAC_SECRET`).
4. Confirm feature flags for risky changes are default-off.

## Canary Rollout

1. Deploy to single canary instance.
2. Wait 30 minutes and monitor:
   - `/api/health/version`
   - `/api/health/ready`
   - p95 latency
   - 5xx rate
   - login success rate
   - media token issuance errors
3. Run smoke flows:
   - login/logout
   - student mission/material access
   - download URL generation
   - live class open + recording playback
4. Increase traffic to 25% only if stable.
5. Repeat monitor/smoke checks for 30-60 minutes.
6. Roll out to 100%.

## Rollback

1. Disable new runtime flags first.
2. If still unstable, execute rollback script to known-good commit.
3. Re-run smoke flows and keep canary at low traffic until stable.
