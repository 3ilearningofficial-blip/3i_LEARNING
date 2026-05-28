# 3i Learning — agent / developer notes

## Backend

- Start API: `npm run server:dev` (requires `.env` with `DATABASE_URL`, `SESSION_SECRET`, `OTP_HMAC_SECRET`, and optionally `REDIS_URL`).
- Apply SQL migrations before deploy: `npm run db:apply-sql` (includes `0027`–`0033`).
- CI runs `db:apply-sql` + `db:check` on Postgres 16 for every PR to `main`.
- Regenerate Drizzle schema after DB changes: `npm run db:push` (review `shared/schema.ts` in PRs).
- Redis (`REDIS_URL`): shared OTP/global rate limits, live-class notification dedup, and `/api/download-url` throttling. Falls back to PostgreSQL when unset.
- Large uploads: use presigned R2 client upload only; `POST /api/upload/to-r2` returns 410.

## Frontend (Expo)

- Dev: `npm run expo:dev` with `EXPO_PUBLIC_DOMAIN` pointing at your LAN IP + API port.
- TanStack Query: access-sensitive lists use `staleTime: 0` in `lib/query-client.ts`.

## Architecture decisions (ADRs)

### ORM strategy (CQTD-01)
All database operations in `backend/` use **raw `pg` (`db.query()`)** exclusively.
`drizzle-orm` is intentionally limited to `shared/schema.ts` for schema declarations,
used only by `drizzle-kit` for migration generation and drift detection in CI.
Do NOT introduce Drizzle query builder (`db.select()`, `db.insert()`, etc.) in route
handlers — it creates two parallel query systems, hides SQL, and complicates testing.

### Offline encryption key derivation (ODSR-01)
New device installs: key = PBKDF2(sessionToken:deviceId:serverNonce, salt, 100k iters).
The serverNonce is fetched once from `POST /api/offline/device-secret`, stored in
SecureStore only. The server stores HMAC(nonce) only — cannot reconstruct it.
Legacy installs (existing key in SecureStore) continue using the old key; rotation
happens on credential change (logout/login), at which point old files are inaccessible by design.

### Admin session device binding (SEC-04)
Admin sessions stored in `user_sessions` now include a `device_id` column.
New admin logins bind the session to the requesting device. Subsequent requests
from a different device are rejected (403 / null user resolution).
Sessions created before migration 0042 (device_id IS NULL) are grandfathered in.

## Manual QA checklist (production-sensitive)

- [ ] Live class 30-min reminder fires once per student per class (multi-instance / Redis).
- [ ] Revoked enrollment removes offline downloads (native + web IndexedDB).
- [ ] Download button does not flash “Re-download” before state loads.
- [ ] My Downloads: course → section drill-down and Android back stack.
- [ ] Admin missions: folder opens full-screen; Add Mission prefills folder name.
- [ ] Media playback denied after enrollment expires or revoke.
- [ ] `OTP_HMAC_SECRET` set on all API hosts (startup hard-fail if missing).
