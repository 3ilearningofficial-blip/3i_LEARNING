# 3i Learning - Math Education Platform

## Overview
A comprehensive math education mobile app (Expo/React Native) with Express backend, similar to Physics Wallah but designed for an individual math teacher. Supports Android and web.

## Architecture
- **Frontend**: Expo (React Native) with expo-router file-based navigation, runs on port 8081
- **Backend**: Express.js with TypeScript, runs on port 5000, serves API + landing page
- **Database**: PostgreSQL via Drizzle ORM, sessions stored in PostgreSQL via connect-pg-simple
- **State**: React Query for server state, React Context for auth
- **Security**: Rate limiting on auth endpoints (20 req/15min), single-device session enforcement

## Key Features
- Phone/Email OTP login with single-device enforcement (new login auto-logouts previous)
- Course management with sections/folders, video lectures (YouTube), PDFs
- OMR-style test engine with negative marking and detailed results
- AI Tutor for instant doubt resolution
- Daily missions with subsections: All, Daily Drill, Free Practice
- Live classes (YouTube embeds)
- Admin dashboard for course/content/mission management
- Download control per study material (admin can toggle allow/disallow)
- Landing page at domain root for web visitors

## Important Files
- `app/(tabs)/` - Main tab screens (Home, Daily Mission, Test Series, AI Tutor)
- `app/course/[id].tsx` - Course detail with Lectures/Tests/Materials/Live tabs
- `app/admin/index.tsx` - Admin dashboard (Courses, Tests, Missions, Users, Notify tabs)
- `app/admin/course/[id].tsx` - Admin course management (all 4 tabs)
- `server/routes.ts` - All API endpoints
- `server/index.ts` - Express setup, CORS, session (PG store), rate limiting, landing page
- `context/AuthContext.tsx` - Authentication state/logic with "logged_in_elsewhere" detection
- `lib/query-client.ts` - React Query + API helpers
- `shared/schema.ts` - Drizzle database schema
- `constants/colors.ts` - Theme colors (Primary: #1A56DB, Accent: #FF6B35, Dark: #0A1628)

## Database Schema
Tables: users, courses, lectures, enrollments, lecture_progress, study_materials, tests, questions, test_attempts, daily_missions, user_missions, notifications, live_classes, doubts, session

Key columns:
- `users.session_token` - For single-device enforcement
- `courses.course_type` (standard/test_series)
- `lectures.section_title` / `study_materials.section_title` - Folder organization
- `study_materials.download_allowed` - Admin-controlled download toggle
- `daily_missions.mission_type` (daily_drill/free_practice)
- `daily_missions.course_id` - Links mission to specific course

Database indexes on: user_id, course_id, test_id, mission_date, session_token, email, phone

## Admin Access
- Email: 3ilearningofficial@gmail.com or Phone: 9997198068
- OTP is logged to console and returned as `devOtp` in API response (dev mode)
- For production: integrate SMS gateway (MSG91/Twilio) and email service (SendGrid)

## Single Device Enforcement
- On login, a unique session_token is generated and stored in both DB and session
- On /api/auth/me, session_token is validated against DB
- If mismatch (another device logged in), returns 401 "logged_in_elsewhere"
- Frontend auto-logouts and shows alert: "Your account has been logged in on another device"

## Daily Missions
- Three subsections: All, Daily Drill, Free Practice
- Free Practice: available to all students without course purchase
- Daily Drill: requires course enrollment
- Admin can manually create missions with questions via admin dashboard
- API: GET /api/daily-missions?type=X, POST /api/admin/daily-missions

## Deployment
- **Web/API**: Autoscale deployment via Replit, build: `npm run server:build`, run: `npm run server:prod`
- **Android**: EAS Build configured in `eas.json`, package: `com.learning.threeI`
- Landing page served at domain root (port 5000) with QR code for Expo Go

## Bulk Question Upload
- Text paste mode: POST /api/admin/questions/bulk-text with { testId, text }
- PDF upload mode: POST /api/admin/questions/bulk-pdf (multipart form with 'pdf' file)
- Parser supports formats: Q1/1./Question 1 with A/B/C/D options, optional "Answer: X" line
- Dependencies: pdf-parse, multer, expo-document-picker

## Payments (Not Yet Integrated)
- Recommended: Razorpay for Indian payments (UPI, cards, net banking)
- Alternative: RevenueCat for Play Store in-app purchases
- Payments go to your linked Razorpay/bank account

## Categories
All, Class 10, Class 12, CDS, NDA, AFCAT, Fundamentals, Trigonometry, Calculus
