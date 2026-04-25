# Scalability, Performance, and Stability Checklist

Use this checklist before major production releases.

## Capacity target
- Baseline target: 100 concurrent students for core APIs and media access flows.
- Track p95 latency and error rate per endpoint.

## Load testing
- Run load tests against staging first.
- Quick smoke check command:
  - `npm run loadtest:smoke`
- Cover at minimum:
  - `POST /api/auth/email-login`
  - `GET /api/courses`
  - `GET /api/download-url`
  - `GET /api/media-stream/:key`
  - `POST /api/payments/verify`
- Pass criteria:
  - p95 latency under 500ms for non-media APIs
  - error rate under 1%
  - no sustained CPU saturation or DB pool exhaustion

## Database
- Validate `DATABASE_URL` uses strict SSL mode (`sslmode=verify-full`).
- Confirm connection pool size matches EC2 CPU/memory.
- Ensure indexes exist for high-frequency filters:
  - enrollments by `(user_id, course_id, status, valid_until)`
  - lectures/materials by `course_id`
  - tokens by `(token, used, expires_at)`

## Runtime stability
- Keep runtime schema sync disabled in production by default.
- Enable `ALLOW_RUNTIME_SCHEMA_SYNC=true` only for controlled one-time schema sync.
- Monitor process restarts and memory growth under PM2.
- Run weekly maintenance check:
  - `npm run maintenance:check`

## Rollback readiness
- Keep rollback script ready:
  - `bash scripts/rollback-last.sh 5`

## Release gate
- Required checks:
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm run test`
  - `npm run server:build`
- DB integration tests:
  - Run with `npm run test:db` when test DB is reachable.
