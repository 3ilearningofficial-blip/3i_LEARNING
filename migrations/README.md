## Migration Workflow

This project previously relied heavily on runtime schema mutation in `server/routes.ts`.
For production safety, prefer reviewed SQL migrations in this folder.

### Rules

1. Add schema changes as new ordered SQL files (`0001_*.sql`, `0002_*.sql`, ...).
2. Run migrations during deploy before starting the app.
3. Keep `ALLOW_RUNTIME_SCHEMA_SYNC=false` and `ALLOW_STARTUP_SCHEMA_ENSURE=false` in production.
4. Runtime startup should validate readiness, not mutate schema.

### Commands

- Generate/push (existing): `npm run db:push`
- Migrate (new): `npm run db:migrate`
- Verify critical tables/columns after deploy: `npm run db:check`

Use explicit migration files for production changes even when using Drizzle tooling.
