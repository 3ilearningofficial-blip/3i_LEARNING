# 3i Learning - Math Education Platform

## Overview
A comprehensive math education mobile app (Expo/React Native) with Express backend, similar to Physics Wallah but designed for an individual math teacher. Supports Android and web.

## Architecture
- **Frontend**: Expo (React Native) with expo-router file-based navigation, runs on port 8081
- **Backend**: Express.js with TypeScript, runs on port 5000, serves API + landing page
- **Database**: PostgreSQL via Drizzle ORM
- **State**: React Query for server state, React Context for auth

## Key Features
- Phone/Email OTP login with one-device binding
- Course management with sections/folders, video lectures (YouTube), PDFs
- OMR-style test engine with negative marking and detailed results
- AI Tutor for instant doubt resolution
- Daily missions with XP rewards
- Live classes (YouTube embeds)
- Admin dashboard for course/content management
- Landing page at domain root for web visitors

## Important Files
- `app/(tabs)/` - Main tab screens (Home, Daily Mission, Test Series, AI Tutor)
- `app/course/[id].tsx` - Course detail with Lectures/Tests/Materials/Live tabs
- `app/admin/index.tsx` - Admin dashboard
- `app/admin/course/[id].tsx` - Admin course management (all 4 tabs)
- `server/routes.ts` - All API endpoints
- `server/index.ts` - Express setup, CORS, session, landing page serving
- `context/AuthContext.tsx` - Authentication state/logic
- `lib/query-client.ts` - React Query + API helpers
- `shared/schema.ts` - Drizzle database schema
- `constants/colors.ts` - Theme colors (Primary: #1A56DB, Accent: #FF6B35, Dark: #0A1628)

## Database Schema
Tables: users, courses, lectures, enrollments, lecture_progress, study_materials, tests, questions, test_attempts, daily_missions, user_missions, notifications, live_classes, doubts

Key columns added:
- `courses.course_type` (standard/test_series)
- `lectures.section_title` (for folder organization)
- `study_materials.section_title` (for folder organization)

## Admin Access
- Email: admin@3ilearning.com or Phone: 9999999999
- OTP is logged to console and returned as `devOtp` in API response (dev mode)

## Deployment
- **Web/API**: Autoscale deployment via Replit, build: `npm run server:build`, run: `npm run server:prod`
- **Android**: EAS Build configured in `eas.json`, package: `com.learning.threeI`
- Landing page served at domain root (port 5000) with QR code for Expo Go

## Play Store Setup
1. Run `npx eas build --platform android --profile production` to build AAB
2. Upload to Google Play Console
3. Set `EXPO_PUBLIC_DOMAIN` to your production domain for the build
4. Configure `eas.json` with your EAS project ID and Google service account key

## Categories
All, Class 10, Class 12, CDS, NDA, AFCAT, Fundamentals, Trigonometry, Calculus
