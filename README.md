# 3i Learning Platform

## What this project is about

3i Learning is a full-stack exam preparation platform built for defense and competitive exam learners (NDA, CDS, AFCAT, etc.).

The product combines:
- structured video courses,
- live classes,
- OMR-style tests and analytics,
- daily mission practice,
- study materials,
- support chat,
- and an AI Tutor experience.

The goal is to provide one focused learning system where a student can enroll, learn, practice, revise, ask doubts, and track progress from mobile or web.

## What we are making here

We are building a scalable learning ecosystem with two core surfaces:

1. Student App (Expo + React Native + Web)
- onboarding and authentication,
- paid/free course enrollment,
- lecture playback,
- test attempts and analysis,
- daily missions,
- doubts/AI tutor,
- notifications,
- secure offline downloads.

2. Admin Studio
- course/content creation and updates,
- test/question management (including bulk import),
- live class scheduling and stream controls,
- support operations,
- user management,
- revenue and engagement analytics.

In short: this codebase is not just a course app, it is a learning business platform with content operations, commerce, and classroom tooling.

## Product capabilities implemented

### Student side
- Phone OTP and email/password login
- Profile setup flow
- Home feed with enrolled and discoverable courses
- Course details with lectures, tests, materials, and live classes
- Test series with attempts, analysis, and leaderboard endpoints
- Daily missions
- AI Tutor tab backed by `doubts` APIs
- Support chat tab and notifications
- Downloads screen for offline access

### Admin side
- Course CRUD and content imports (lectures/tests/materials)
- Study material and lecture management
- Live class CRUD and moderation tools
- Cloudflare Stream live input creation/status/end
- Recording completion flow that creates lecture entries
- Test/question management (including bulk text/PDF upload paths)
- User listing, block/unblock, delete
- Notification sending/history
- Revenue and performance analytics

### Security/content protection highlights
- Secure download token flow (`/api/download-url` + `/api/download-proxy`)
- Enrollment and validity checks before issuing download tokens
- Single-use, short-expiry download tokens
- Encrypted offline files on device (AES-based flow)
- Screenshot/screen recording protections (platform dependent)
- Video watermark component and stream protection work

## Architecture overview

### Frontend
- Expo Router app in `app/`
- Shared UI/components in `components/`
- Auth state in `context/AuthContext.tsx`
- Data fetching/caching via TanStack Query (`lib/query-client.ts`)
- Platform-aware fetch logic for web/native

### Backend
- Express server in `server/index.ts` + routes in `server/routes.ts`
- PostgreSQL via `pg` pool
- Session support (`express-session`, `connect-pg-simple` in production)
- API route groups for auth, courses, tests, payments, admin, media, live classes, downloads, etc.

### Data layer
- Drizzle schema definitions in `shared/schema.ts`
- Core entities include users, courses, lectures, enrollments, tests, questions, attempts, missions, notifications, live classes, doubts, payments.

### Integrations
- Razorpay (payments)
- Firebase (token verification / phone auth support)
- Fast2SMS (OTP delivery fallback)
- Cloudflare R2 (media storage)
- Cloudflare Stream (live classes + recording flow)

## Repository map (high-level)

- `app/` - Expo Router screens (student + admin)
- `components/` - shared UI and feature components
- `context/` - auth context and app-level providers
- `lib/` - utilities (query client, download manager, encryption, stream helpers)
- `server/` - Express server and API routes
- `shared/` - shared schema/types
- `__tests__/` - integration test assets and docs
- `scripts/` - build/deploy/support scripts

## How to run locally

### 1) Install dependencies
```bash
npm install
```

### 2) Configure environment
Create/update `.env` with required keys used by server and app:
- `DATABASE_URL`
- `SESSION_SECRET`
- `EXPO_PUBLIC_DOMAIN`
- `EXPO_PUBLIC_API_URL`
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- `CF_STREAM_ACCOUNT_ID`, `CF_STREAM_API_TOKEN`
- `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`
- optional: `FAST2SMS_API_KEY`

### 3) Start backend
```bash
npm run server:dev
```

### 4) Start Expo app
```bash
npm run start
```

For static web build support:
```bash
npm run expo:static:build
npm run server:build
npm run server:prod
```

## Testing

Run all tests:
```bash
npm test
```

Notable test focus currently present:
- secure offline downloads integration coverage,
- token issuance and enrollment validation logic,
- recording completion and utility-level tests.

Manual mobile integration test plans are documented in:
- `__tests__/integration/secure-offline-downloads.integration.md`

## Current technical shape and next evolution

### Strong foundations already in place
- End-to-end content delivery flows (learning + assessment + live)
- Admin operations and analytics in one app
- Cross-platform (Android/iOS/Web) strategy
- Defensive handling for offline and access revocation scenarios

### Natural next improvements
- Split `server/routes.ts` into domain modules for maintainability
- Replace placeholder AI doubt responses with a production LLM service
- Expand automated E2E coverage (Detox/Maestro) for mobile-critical flows
- Add stronger observability (structured logs, metrics, alerts)
- Harden role/permission boundaries with centralized policy checks

## One-line project definition

3i Learning is a cross-platform exam-prep super app and admin platform that unifies teaching, testing, live delivery, support, and secure content distribution in one system.
