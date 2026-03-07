# 3i Learning - Math Education Platform

## Overview
A comprehensive math education mobile app (Expo/React Native) with Express backend, similar to Physics Wallah but designed for an individual math teacher. Supports Android and web.

## Architecture
- **Frontend**: Expo (React Native) with expo-router file-based navigation, runs on port 8081
- **Backend**: Express.js with TypeScript, runs on port 5000, serves API + landing page
- **Database**: PostgreSQL via Drizzle ORM, sessions stored in PostgreSQL via connect-pg-simple
- **Auth**: Firebase Phone Authentication (web), dev OTP fallback (server-side)
- **Payments**: Razorpay (create order → checkout → verify → enroll)
- **State**: React Query for server state, React Context for auth
- **Security**: Rate limiting on auth endpoints (20 req/15min), single-device session enforcement

## Key Features
- Phone OTP login via Firebase (single-device enforcement, new login auto-logouts previous)
- Course management with sections/folders, video lectures (YouTube), PDFs
- Razorpay payment gateway for paid course enrollment
- OMR-style test engine with negative marking and detailed results
- AI Tutor for instant doubt resolution
- Daily missions with subsections: All, Daily Drill, Free Practice
- Live classes (YouTube embeds) with auto-recording to lectures on end
- Course types: Live (🔴) and Recorded (📹) with badges on cards
- Import system: Copy lectures/tests from live courses into recorded courses
- Course creation: Choose between "Course" (full) or "Test Series" (tests only)
- Admin dashboard with Courses, Tests, Materials, Missions, Users, Notify tabs
- Free Study Materials tab in admin for uploading materials accessible without enrollment
- Course materials are enrolled-only by default (no "free for all" toggle)
- Download control per study material (admin can toggle allow/disallow)
- Custom domain: 3ilearning.in (CORS configured)
- Landing page at domain root for web visitors

## Important Files
- `app/(tabs)/` - Main tab screens (Home, Daily Mission, Test Series, AI Tutor)
- `app/(auth)/login.tsx` - Phone login with Firebase + fallback OTP
- `app/(auth)/otp.tsx` - OTP verification (Firebase or dev)
- `app/course/[id].tsx` - Course detail with Lectures/Tests/Materials/Live tabs + Razorpay enrollment
- `app/admin/index.tsx` - Admin dashboard (Courses, Tests, Missions, Users, Notify tabs)
- `app/admin/course/[id].tsx` - Admin course management (all 4 tabs)
- `server/routes.ts` - All API endpoints (auth, courses, payments, admin)
- `server/firebase.ts` - Firebase Admin SDK initialization and token verification
- `server/razorpay.ts` - Razorpay instance and payment signature verification
- `server/index.ts` - Express setup, CORS, session (PG store), rate limiting, landing page
- `context/AuthContext.tsx` - Authentication state/logic with "logged_in_elsewhere" detection
- `lib/firebase.ts` - Firebase client SDK (web) for phone auth
- `lib/query-client.ts` - React Query + API helpers
- `shared/schema.ts` - Drizzle database schema
- `constants/colors.ts` - Theme colors (Primary: #1A56DB, Accent: #FF6B35, Dark: #0A1628)

## Database Schema
Tables: users, courses, lectures, enrollments, lecture_progress, study_materials, tests, questions, test_attempts, daily_missions, user_missions, notifications, live_classes, doubts, payments, session

Key columns:
- `users.session_token` - For single-device enforcement
- `courses.course_type` (standard/test_series)
- `lectures.section_title` / `study_materials.section_title` - Folder organization
- `study_materials.download_allowed` - Admin-controlled download toggle
- `daily_missions.mission_type` (daily_drill/free_practice)
- `daily_missions.course_id` - Links mission to specific course
- `payments.razorpay_order_id/payment_id/signature` - Razorpay payment tracking

Database indexes on: user_id, course_id, test_id, mission_date, session_token, email, phone, razorpay_order_id

## Auth Flow
- Login screen: phone number only (no email option)
- Web: Firebase signInWithPhoneNumber with invisible reCAPTCHA → get ID token → POST /api/auth/firebase-login → server verifies with Firebase Admin SDK → creates session
- Fallback (dev/reCAPTCHA fails): server generates OTP → POST /api/auth/send-otp → verify with POST /api/auth/verify-otp
- Mobile (Expo Go): uses dev OTP fallback (Firebase Phone Auth requires native build)
- Single-device: session_token validated on /api/auth/me, mismatch = "logged_in_elsewhere"

## Payment Flow
- Free courses: direct enrollment via POST /api/courses/:id/enroll
- Paid courses: POST /api/payments/create-order → Razorpay Checkout.js popup → POST /api/payments/verify → enrollment + student count update
- Razorpay signature verification: HMAC-SHA256(orderId|paymentId, secret)

## Admin Access
- Phone: 9997198068 (admin role)
- OTP logged to console and returned as `devOtp` in dev mode

## Environment Secrets
- FIREBASE_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT_JSON
- RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
- SESSION_SECRET, DATABASE_URL
- EXPO_PUBLIC_FIREBASE_API_KEY, EXPO_PUBLIC_FIREBASE_PROJECT_ID (public env vars)

## Deployment
- **Web/API**: Autoscale deployment via Replit, build: `npm run server:build`, run: `npm run server:prod`
- **Android**: EAS Build configured in `eas.json`, package: `com.learning.threeI`
- Landing page served at domain root (port 5000) with QR code for Expo Go

## Categories
All, Class 10, Class 12, CDS, NDA, AFCAT, Fundamentals, Trigonometry, Calculus
