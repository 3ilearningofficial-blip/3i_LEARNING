# Implementation Plan: Professional Live Class Studio

## Overview

Replace the current YouTube-URL-centric live class system with a professional Studio experience. Implementation proceeds incrementally: schema changes first, then backend API endpoints, then frontend hooks and utility functions, then the new pages (Studio Setup, Broadcast), and finally modifications to the existing Schedule Form and live class cards. Each step builds on the previous and wires into the existing codebase.

## Tasks

- [x] 1. Database schema and Drizzle model updates
  - [x] 1.1 Add new columns to `liveClasses` in `shared/schema.ts` and create new tables
    - Add `streamType`, `chatMode`, `recordingUrl`, `showViewerCount` columns to the `liveClasses` table definition
    - Add `liveClassViewers` table with `id`, `liveClassId`, `userId`, `userName`, `lastHeartbeat` and UNIQUE(liveClassId, userId)
    - Add `liveClassHandRaises` table with `id`, `liveClassId`, `userId`, `userName`, `raisedAt` and UNIQUE(liveClassId, userId)
    - Export inferred types for the new tables
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x] 1.2 Add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations in `server/routes.ts`
    - Add migration queries for `stream_type`, `chat_mode`, `recording_url`, `show_viewer_count` on `live_classes`
    - Add `CREATE TABLE IF NOT EXISTS` for `live_class_viewers` and `live_class_hand_raises`
    - Follow existing migration pattern at server startup
    - _Requirements: 14.5_

- [x] 2. Backend API endpoints for viewers, hand raises, and recording
  - [x] 2.1 Implement viewer heartbeat and viewer list endpoints
    - `POST /api/live-classes/:id/viewers/heartbeat` — upsert viewer row with current timestamp
    - `GET /api/live-classes/:id/viewers` — return viewers with heartbeat within last 30 seconds
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 2.2 Implement hand raise endpoints
    - `POST /api/live-classes/:id/raise-hand` — upsert hand raise for authenticated student
    - `DELETE /api/live-classes/:id/raise-hand` — remove hand raise for authenticated student
    - `GET /api/admin/live-classes/:id/raised-hands` — list all raised hands (admin only)
    - `POST /api/admin/live-classes/:id/raised-hands/:userId/resolve` — dismiss a raised hand (admin only)
    - _Requirements: 9.6, 9.7, 11.1, 11.2_

  - [x] 2.3 Implement recording completion endpoint
    - `POST /api/admin/live-classes/:id/recording` — accepts `recordingUrl`, sets `recording_url` on live class, sets `is_completed=true` and `is_live=false`, creates lecture record with `video_url=recordingUrl` and `video_type='r2'`, updates course `total_lectures` count
    - _Requirements: 12.4, 12.5, 12.7_

  - [x] 2.4 Modify existing live class create/update endpoints
    - Update `POST /api/admin/live-classes` to accept `streamType`, `chatMode`, `showViewerCount` fields; remove requirement for `youtubeUrl` at creation time
    - Update `PUT /api/admin/live-classes/:id` to accept `streamType`, `chatMode`, `showViewerCount`, `recordingUrl`
    - _Requirements: 1.1, 1.2, 5.2, 6.1, 6.2_

- [x] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Utility functions and custom hooks
  - [x] 4.1 Create YouTube URL validation utility
    - Create a `getYouTubeVideoId(url: string): string | null` function that extracts video IDs from standard YouTube URL formats (`youtube.com/live/...`, `youtu.be/...`, `youtube.com/watch?v=...`, `youtube.com/embed/...`)
    - Place in a shared utility file (e.g., `lib/youtube-utils.ts`)
    - _Requirements: 5.4_

  - [x] 4.2 Write property test for YouTube URL validation
    - **Property 1: YouTube URL format acceptance**
    - Generate YouTube URLs in various valid formats, verify `getYouTubeVideoId` extracts a valid non-empty video ID. Minimum 100 iterations.
    - **Validates: Requirements 5.4**

  - [x] 4.3 Create chat message filtering utility
    - Create a `filterChatMessages(messages, viewerUserId, isAdmin, chatMode)` function
    - When `chatMode === 'public'`, return all messages
    - When `chatMode === 'private'`, return only admin messages and the viewer's own messages
    - Place in `lib/chat-utils.ts`
    - _Requirements: 9.3, 9.4_

  - [x] 4.4 Write property test for chat message filtering
    - **Property 2: Chat mode message filtering**
    - Generate random message sets with random user IDs and admin flags, test filtering for both public and private modes. Minimum 100 iterations.
    - **Validates: Requirements 9.3, 9.4**

  - [x] 4.5 Create `useWebRTCStream` hook
    - Implement in `lib/useWebRTCStream.ts`
    - Manage camera/mic stream via `getUserMedia`, device enumeration, device selection, toggle video/audio, screen share via `getDisplayMedia`
    - Handle permission errors with descriptive messages
    - Provide cleanup function to stop all tracks
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 7.3, 7.4, 7.5, 7.6_

  - [x] 4.6 Create `useMediaRecorder` hook
    - Implement in `lib/useMediaRecorder.ts`
    - Start/stop recording on a given `MediaStream`, collect chunks, return `Blob` on stop
    - Record in `video/webm` format
    - Handle `MediaRecorder` not supported gracefully
    - _Requirements: 12.1, 12.2_

- [x] 5. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Studio Setup Page
  - [x] 6.1 Create Studio Setup page at `app/admin/studio/[id].tsx`
    - Full-screen layout: 3/4 preview area + 1/4 control panel
    - Back button in top-left corner that navigates back without changing `is_live`
    - Fetch live class data on mount
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2_

  - [x] 6.2 Implement stream source selector and WebRTC preview
    - Control panel contains WebRTC / RTMP radio selector
    - When WebRTC selected: show camera preview using `useWebRTCStream`, camera selector dropdown, microphone selector dropdown
    - When RTMP selected: show YouTube URL text input, placeholder in preview area
    - _Requirements: 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 5.1_

  - [x] 6.3 Implement "Go Live" button and navigation to Broadcast
    - "Go Live" button at bottom-right of control panel
    - WebRTC mode: set `is_live=true` via PUT, navigate to Broadcast page
    - RTMP mode: validate YouTube URL (using `getYouTubeVideoId`), save URL, set `is_live=true`, navigate to Broadcast
    - Show loading indicator while request is in progress, disable button
    - Show validation error if RTMP selected with no/invalid YouTube URL
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4_

- [x] 7. Broadcast Page
  - [x] 7.1 Create Broadcast page at `app/admin/broadcast/[id].tsx`
    - Full-screen layout: 3/4 left stream area + 1/4 right side panel
    - Fetch live class data on mount to determine stream type
    - WebRTC mode: display camera feed, cam/mic/screen-share toggle controls
    - RTMP mode: embed YouTube player using stored URL
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.2_

  - [x] 7.2 Implement auto-recording on screen share
    - When admin activates screen share, automatically start `useMediaRecorder` on the screen stream
    - When screen share stops, stop recording
    - _Requirements: 7.7, 12.1_

  - [x] 7.3 Implement side panel with Chat and Students tabs
    - Right panel with tab switcher: "Chat" and "Students"
    - "End Class" button at bottom-right of right panel
    - _Requirements: 7.8, 7.9, 8.3, 8.4_

- [x] 8. Chat Panel component
  - [x] 8.1 Create `components/LiveChatPanel.tsx`
    - Display messages polling every 3 seconds using existing chat API
    - Visually distinguish admin messages (different background, "TEACHER" badge)
    - Use `filterChatMessages` utility for public/private mode filtering
    - Admin can delete any message
    - Show hand-raise count indicator
    - Admin can dismiss individual raised hands
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 8.2 Implement voice-to-text input for students (web only)
    - Add microphone button in chat input area
    - Use browser Speech Recognition API to transcribe speech into chat input
    - Hide button if Speech Recognition API not supported
    - _Requirements: 11.3, 11.4, 11.5_

- [x] 9. Students Panel component
  - [x] 9.1 Create `components/LiveStudentsPanel.tsx`
    - Display list of currently watching students, polling `/api/live-classes/:id/viewers` every 10 seconds
    - Show each student's name
    - Show total viewer count when `showViewerCount` is enabled
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 9.2 Implement student heartbeat on the student live class page
    - In existing `app/live-class/[id].tsx`, add heartbeat POST to `/api/live-classes/:id/viewers/heartbeat` every 15 seconds while the page is open
    - Add raise-hand button for students
    - _Requirements: 10.1, 11.1, 11.2_

- [x] 10. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. End Class flow and recording upload
  - [x] 11.1 Implement End Class confirmation and post-session logic
    - "End Class" button shows confirmation dialog
    - On confirm: set `is_live=false`, `is_completed=true`
    - WebRTC with recording: stop recorder → upload blob to R2 via presigned URL (with progress bar) → call recording endpoint → navigate to admin panel
    - WebRTC without recording: mark completed, no lecture created, navigate to admin panel
    - RTMP: create lecture from YouTube URL, mark completed, navigate to admin panel
    - Handle upload failures: show error, keep blob in memory for retry, do NOT mark completed
    - _Requirements: 12.3, 12.4, 12.5, 12.6, 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 11.2 Write property test for recording completion logic
    - **Property 3: Recording completion creates lecture and updates state**
    - Generate random live class records with course IDs and R2 URLs, call recording completion logic, verify lecture creation, state updates, and lecture count. Minimum 100 iterations.
    - **Validates: Requirements 12.4, 12.5, 12.7**

- [x] 12. Schedule Form modifications
  - [x] 12.1 Modify Schedule Form in `app/admin/index.tsx`
    - Remove `liveYoutubeUrl` field from the form
    - Add `chatMode` selector (Public/Private) and `showViewerCount` toggle
    - "Start Live" button creates Live_Class record and navigates to Studio Setup page
    - When no scheduled time provided, set `scheduled_at` to current timestamp
    - Pre-fill fields when editing an existing live class
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 12.2 Update scheduled class card "Go Live" button
    - Change "Go Live" button on scheduled live class cards to navigate to Studio Setup page instead of starting the class directly
    - _Requirements: 2.1_

- [x] 13. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Cloudflare Stream Integration

- [x] 14. Cloudflare Stream professional live video
  - [x] 14.1 Backend: DB migration for CF Stream columns
    - Added `cf_stream_uid`, `cf_stream_key`, `cf_stream_rtmp_url`, `cf_playback_hls` columns to `live_classes`
  - [x] 14.2 Backend: Cloudflare Stream API endpoints
    - `POST /api/admin/live-classes/:id/stream/create` — creates CF Stream live input, returns RTMP URL + stream key
    - `GET /api/admin/live-classes/:id/stream/status` — polls stream connection status
    - `POST /api/admin/live-classes/:id/stream/end` — ends the live input (recording preserved)
  - [x] 14.3 Studio Setup: Cloudflare Stream option
    - Added "☁️ Cloudflare Stream" as third stream source option
    - Auto-creates CF Stream live input when selected
    - Displays RTMP URL and stream key for OBS/encoder setup
  - [x] 14.4 Broadcast Page: HLS playback for Cloudflare Stream
    - Added HLS player (hls.js) rendered in iframe for CF Stream playback
    - Auto-reconnects every 5s while waiting for stream to connect
    - LIVE indicator with animated dot
  - [x] 14.5 End Class: CF Stream cleanup
    - Calls stream/end to stop the live input
    - Saves HLS URL as lecture recording
  - [x] 14.6 Environment: Added CF_STREAM_ACCOUNT_ID and CF_STREAM_API_TOKEN to .env

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 3 correctness properties defined in the design document
- The implementation uses TypeScript throughout, matching the existing codebase (React Native Web + Expo frontend, Express backend, Drizzle ORM)
