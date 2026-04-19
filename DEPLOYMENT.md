# Deployment Guide

This repo contains two deployable parts:

1. An Expo app (`app/`, `components/`, `lib/`)
2. A Node/Express backend that also serves the web build (`server/`, `server_dist/`)

## Recommended setup

Use one backend host and one mobile release flow:

- Backend + web app: Railway, Render, Fly.io, or a VPS
- Database: Neon or PostgreSQL
- Android app: EAS Build + Play Store

This codebase is already closest to that model.

## What must be configured first

Create a real `.env` from `.env.example` and fill at least:

- `DATABASE_URL`
- `SESSION_SECRET`
- `EXPO_PUBLIC_DOMAIN`
- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `FIREBASE_API_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON`

Optional but required for the related features:

- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
- `FAST2SMS_API_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- `CF_STREAM_ACCOUNT_ID`, `CF_STREAM_API_TOKEN`
- `EXPO_PUBLIC_CLOUDFLARE_ACCOUNT_ID`

## Backend deployment

### Build command

```bash
npm ci
npm run server:build
EXPO_PUBLIC_DOMAIN=api.yourdomain.com npm run expo:static:build
EXPO_PUBLIC_DOMAIN=api.yourdomain.com npx expo export --platform web --output-dir static-build/web
```

### Start command

```bash
npm run server:prod
```

The Express server serves:

- `/api/*` from the backend
- `/` landing page
- `/app` and app routes from the exported Expo web build

## Database setup

Provision PostgreSQL, then run:

```bash
npx drizzle-kit push
```

Your app depends on `DATABASE_URL` at runtime and for schema push.

## Mobile app deployment

This repo already includes `eas.json`, so the intended path is EAS.

### Before EAS build

Update:

- `app.json` -> replace `extra.eas.projectId` (`YOUR_EAS_PROJECT_ID`)
- any real production env vars in EAS secrets or build env

### Build Android

```bash
npx eas login
npx eas init
npx eas build --platform android --profile production
```

For Play Store submission:

```bash
npx eas submit --platform android --profile production
```

## Web deployment flow

The web app is not deployed separately in this setup. Build it and let Express serve `static-build/web`.

That means one deployment can handle:

- website
- API
- Expo web app

## Important codebase notes

These are the main deployment-sensitive spots I found:

- `.env` is currently empty, so deployment will fail until secrets are added.
- `app.json` still contains `YOUR_EAS_PROJECT_ID`.
- `app.json` has Expo router origin set to `http://localhost:5000`.
- `server/index.ts` only allows a small fixed CORS list plus `3ilearning.in`.
- Some files are hardcoded to `3ilearning.in`, especially:
  - `server/index.ts`
  - `app/profile.tsx`
  - `app/material/[id].tsx`
  - `app/lecture/[id].tsx`
- `lib/useDownloadManager.ts` requires `EXPO_PUBLIC_API_URL`, not just `EXPO_PUBLIC_DOMAIN`.

If you deploy to a domain other than `3ilearning.in`, update those references first.

## Minimal production checklist

- Add all required env vars
- Provision PostgreSQL
- Run `npx drizzle-kit push`
- Build backend with `npm run server:build`
- Build Expo static assets with `npm run expo:static:build`
- Export web with `npx expo export --platform web --output-dir static-build/web`
- Start with `npm run server:prod`
- Point DNS/domain to the server
- Configure EAS and release Android app

## Verified locally

I verified:

- `npm run server:build` succeeds

I could not fully verify:

- tests that require PostgreSQL, because no database is configured in this environment
- production build with real env vars, because `.env` is empty
