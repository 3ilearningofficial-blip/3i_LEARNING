# Implementation Plan: Secure Offline Downloads

## Overview

This implementation adds encrypted offline download capability for course lectures and study materials on native iOS and Android platforms. The feature extends existing infrastructure (user_downloads table, /api/my-downloads endpoints, app/downloads.tsx screen) with backend proxy streaming, AES-256 encryption, UUID-obfuscated filenames, and automatic deletion on access revocation.

Key technical components:
- Backend: Express endpoints for signed URL generation and download proxy with watermarking
- Database: New download_tokens table, extensions to user_downloads and enrollments tables
- Client: React Native components using Expo FileSystem, react-native-crypto-js for encryption
- Security: Single-use 30-second tokens, AES-256-CBC encryption, FLAG_SECURE for video playback

## Tasks

- [x] 1. Set up database schema changes and migrations
  - Add `download_tokens` table with columns: id, token, user_id, item_type, item_id, r2_key, used, created_at, expires_at
  - Add indexes on download_tokens(token) and download_tokens(expires_at)
  - Add `local_filename` column to `user_downloads` table (TEXT, nullable)
  - Add `valid_until` column to `enrollments` table (BIGINT, nullable, epoch milliseconds)
  - Create migration script in server/routes.ts initialization section
  - _Requirements: 8.1, 9.1_

- [x] 2. Install required dependencies
  - Install `react-native-crypto-js` for AES-256 encryption
  - Install `expo-secure-store` for encryption key storage
  - Install `expo-file-system` (verify already installed)
  - Install `react-native-flag-secure` for Android screenshot prevention
  - Verify `expo-screen-capture` is installed for iOS screenshot prevention
  - _Requirements: 4.2, 5.1, 5.2_

- [x] 3. Implement backend download authorization endpoint
  - [x] 3.1 Create `GET /api/download-url` endpoint in server/routes.ts
    - Accept query params: itemType (lecture|material), itemId (number)
    - Verify user authentication (require student role)
    - Resolve item to course via JOIN on lectures or study_materials
    - Check download_allowed = TRUE on item → return 403 if false
    - Check active enrollment with valid_until validation
    - Resolve R2 key from item's file_url (strip CDN prefix)
    - Generate UUID token using crypto.randomUUID()
    - Insert token into download_tokens with expires_at = now + 30000ms
    - Return JSON: { token, expiresAt }
    - _Requirements: 2.1, 2.2, 2.3, 8.1, 8.2, 8.3, 8.4, 9.3_

  - [ ] 3.2 Write property test for download-url endpoint
    - **Property 8: Enrollment verification gates all signed URL issuance**
    - **Validates: Requirements 2.2, 2.3, 8.2, 8.3, 8.4, 9.3**
    - Generate random (userId, itemId, itemType, enrollmentState) combinations
    - Assert token returned if and only if: download_allowed=true AND active enrollment exists AND valid_until not expired

  - [ ] 3.3 Write property test for token expiry
    - **Property 2: Signed token expiry is always ≤ 30 seconds from creation**
    - **Validates: Requirements 2.5, 8.1**
    - Generate random valid token creation calls
    - Assert expires_at - created_at <= 30000 milliseconds

- [x] 4. Implement backend download proxy endpoint
  - [x] 4.1 Create `GET /api/download-proxy` endpoint in server/routes.ts
    - Accept query param: token (UUID string)
    - Look up token in download_tokens WHERE token=$1 AND used=FALSE AND expires_at > now()
    - Return 403 if token not found, expired, or already used
    - Mark token as used: UPDATE download_tokens SET used=TRUE WHERE token=$1
    - Fetch file from R2 using AWS SDK S3 client with r2_key
    - Generate watermark token: HMAC-SHA256(userId + ":" + timestamp, server_secret)
    - Set response headers: Content-Type, Content-Disposition: attachment, X-Watermark-Token
    - Stream R2 object body to response
    - _Requirements: 2.4, 2.6, 2.7, 2.8, 8.5, 8.6, 8.7, 8.8_

  - [ ] 4.2 Write property test for single-use tokens
    - **Property 3: Signed tokens are single-use — a used token always returns 403**
    - **Validates: Requirements 2.6, 2.7, 8.6, 8.8**
    - Generate random valid tokens
    - Use each token once successfully
    - Assert all subsequent uses return 403 and no file bytes streamed

  - [ ] 4.3 Write property test for watermark header
    - **Property 4: Download proxy always includes watermark header**
    - **Validates: Requirements 2.8, 8.7**
    - Generate random valid (unused, non-expired) tokens
    - Call download-proxy endpoint
    - Assert X-Watermark-Token header is present and non-empty

- [x] 5. Implement encryption service
  - [x] 5.1 Create lib/encryptionService.ts with EncryptionService class
    - Implement getOrCreateKey(): derive key using PBKDF2(sessionToken + deviceId, salt, 100000 iterations, 256 bits)
    - Store salt in Expo SecureStore as "download_key_salt"
    - Cache derived key in memory for session
    - Implement encryptBuffer(data: ArrayBuffer): encrypt with AES-256-CBC, prepend 16-byte IV, return base64 ciphertext
    - Implement decryptToUri(ciphertext: string, destPath: string): split IV, decrypt, write plaintext to temp file in cacheDirectory, return file:// URI
    - Use react-native-crypto-js for AES operations
    - _Requirements: 2.9, 4.2_

  - [ ] 5.2 Write property test for encryption round-trip
    - **Property 5: Encryption round-trip preserves file content**
    - **Validates: Requirements 2.9, 4.2**
    - Generate random byte sequences (1 byte to 10 MB)
    - Encrypt with encryptBuffer then decrypt with decryptToUri
    - Assert decrypted content is byte-for-byte identical to original

- [x] 6. Implement download manager hook
  - [x] 6.1 Create hooks/useDownloadManager.ts with core state management
    - Define DownloadState interface: status, progress, localFilename, error
    - Create Map<string, DownloadState> keyed by "itemType:itemId"
    - Persist state to AsyncStorage for cross-session continuity
    - Implement getDownloadState(itemType, itemId): return current state or idle default
    - Implement getTotalStorageBytes(): sum sizes of all .enc files in documentDirectory
    - _Requirements: 2.12, 7.5_

  - [x] 6.2 Implement startDownload function in useDownloadManager
    - Request signed token from GET /api/download-url
    - Handle 403 errors (not enrolled, download not allowed) with user-friendly messages
    - Download file via GET /api/download-proxy with progress tracking
    - Update download state with progress percentage during download
    - On completion: encrypt file using EncryptionService.encryptBuffer
    - Generate UUID filename using expo-crypto.randomUUID()
    - Write encrypted file to FileSystem.documentDirectory + uuid + ".enc"
    - Record download via POST /api/my-downloads with itemType, itemId, localFilename
    - Update state to "downloaded" on success
    - On network error: display error message, do NOT create user_downloads record
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.9, 2.10, 2.11, 2.12, 2.13_

  - [ ] 6.3 Write property test for UUID filenames
    - **Property 6: Downloaded files are stored under UUID filenames in documentDirectory**
    - **Validates: Requirements 2.10, 4.1, 4.3**
    - Generate random completed downloads
    - Assert local_filename matches UUID v4 regex pattern
    - Assert file path is FileSystem.documentDirectory + local_filename + ".enc"

  - [ ] 6.4 Write property test for failed downloads
    - **Property 7: Failed downloads leave no user_downloads record**
    - **Validates: Requirements 2.13**
    - Generate random download attempts with injected network failures
    - Assert no user_downloads record exists for (user_id, item_type, item_id) after failure

  - [x] 6.3 Implement deleteDownload function in useDownloadManager
    - Delete encrypted file from FileSystem.documentDirectory
    - Call DELETE /api/my-downloads/:itemType/:itemId
    - Remove item from local state map
    - Handle filesystem errors by marking deletion_pending
    - _Requirements: 7.6_

  - [x] 6.4 Implement getLocalUri function in useDownloadManager
    - Check if local_filename exists in state for given itemType/itemId
    - Verify file exists at FileSystem.documentDirectory + local_filename + ".enc"
    - If file missing: return null
    - If file exists: decrypt using EncryptionService.decryptToUri to temp file in cacheDirectory
    - Return file:// URI of decrypted temp file
    - _Requirements: 3.2, 3.3, 3.5_

  - [x] 6.5 Implement runForegroundAccessCheck function in useDownloadManager
    - Fetch current downloads from GET /api/my-downloads
    - Compare server response against local state map
    - For each local item NOT in server response: trigger deleteDownload
    - For each local item with expired enrollment: trigger deleteDownload
    - Handle filesystem errors by marking deletion_pending and retrying on next check
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6, 6.7_

  - [ ] 6.6 Write property test for auto-deletion on enrollment revocation
    - **Property 9: Auto-deletion removes all records for a revoked enrollment**
    - **Validates: Requirements 6.1, 6.5**
    - Generate random (userId, courseId) pairs with deleted/expired enrollments
    - Run foreground access check
    - Assert no user_downloads records exist for that (userId, courseId) combination

- [x] 7. Checkpoint - Verify backend and core services
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement DownloadButton component
  - [x] 8.1 Create components/DownloadButton.tsx
    - Accept props: itemType, itemId, downloadAllowed, isEnrolled
    - Guard rendering: only show if Platform.OS !== 'web' AND downloadAllowed === true AND isEnrolled === true
    - Use useDownloadManager hook to get download state
    - Render states: idle (download icon), downloading (circular progress with %), downloaded (green checkmark + "Downloaded"), error (red alert icon)
    - On tap: call startDownload from useDownloadManager
    - On error state tap: retry download
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ] 8.2 Write property test for button visibility
    - **Property 1: Download button visibility is determined solely by (download_allowed, isEnrolled, platform)**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
    - Generate random (downloadAllowed, isEnrolled, platform) triples
    - Render DownloadButton component
    - Assert button is visible if and only if downloadAllowed=true AND isEnrolled=true AND platform !== 'web'

  - [ ] 8.3 Write unit tests for DownloadButton states
    - Test idle state renders download icon
    - Test downloading state shows progress indicator with percentage
    - Test downloaded state shows green checkmark and "Downloaded" label
    - Test error state shows red alert icon and retry on tap

- [x] 9. Integrate DownloadButton into existing screens
  - [x] 9.1 Add DownloadButton to course detail screen (app/course/[id].tsx)
    - Import DownloadButton component
    - Add button to lecture rows where download_allowed = true
    - Add button to study material rows where download_allowed = true
    - Pass itemType, itemId, downloadAllowed, isEnrolled props
    - Guard with Platform.OS !== 'web' check
    - _Requirements: 1.1, 1.2_

  - [x] 9.2 Add DownloadButton to lecture player screen (app/lecture/[id].tsx)
    - Import DownloadButton component
    - Add button to player UI controls
    - Pass itemType='lecture', itemId, downloadAllowed, isEnrolled props
    - Guard with Platform.OS !== 'web' check
    - _Requirements: 1.1_

  - [x] 9.3 Add DownloadButton to material viewer screen (app/material/[id].tsx)
    - Import DownloadButton component
    - Add button to viewer UI controls
    - Pass itemType='material', itemId, downloadAllowed, isEnrolled props
    - Guard with Platform.OS !== 'web' check
    - _Requirements: 1.2_

  - [x] 9.4 Add DownloadButton to material folder screen (app/material-folder/[name].tsx)
    - Import DownloadButton component
    - Add button to material rows where download_allowed = true
    - Pass itemType='material', itemId, downloadAllowed, isEnrolled props
    - Guard with Platform.OS !== 'web' check
    - _Requirements: 1.2_

- [x] 10. Extend existing Downloads screen (app/downloads.tsx)
  - [x] 10.1 Extend GET /api/my-downloads endpoint in server/routes.ts
    - Add JOIN with enrollments table
    - Filter out items where valid_until < now()
    - Include local_filename in response for each item
    - _Requirements: 7.1, 9.2_

  - [ ] 10.2 Write property test for expired enrollment exclusion
    - **Property 12: Expired enrollments are excluded from /api/my-downloads**
    - **Validates: Requirements 9.2**
    - Generate random users with expired and active enrollments
    - Call GET /api/my-downloads
    - Assert items from expired courses are absent from response

  - [x] 10.3 Update Downloads screen UI to show offline availability
    - Use useDownloadManager hook to check local file existence
    - Show green "Available Offline" badge when local file exists
    - Show "Re-download" button when local file is missing but user_downloads record exists
    - Display total storage used at top of screen using getTotalStorageBytes()
    - Add long-press/swipe gesture to show "Delete Download" option
    - On delete: call deleteDownload from useDownloadManager
    - _Requirements: 7.2, 7.3, 7.5, 7.6_

  - [ ] 10.4 Write property test for offline availability badge
    - **Property 13: Downloads screen shows correct offline availability badge**
    - **Validates: Requirements 7.2, 7.3**
    - Generate random sets of user_downloads items with varying local file presence
    - Render Downloads screen
    - Assert "Available Offline" badge shown if and only if local file exists in documentDirectory

  - [ ] 10.5 Write property test for total storage display
    - **Property 14: Total storage display equals sum of local file sizes**
    - **Validates: Requirements 7.5**
    - Generate random sets of local .enc files with known sizes
    - Render Downloads screen storage summary
    - Assert displayed total equals computed sum of all .enc file sizes

  - [x] 10.6 Implement offline playback in Downloads screen
    - On item tap: call getLocalUri from useDownloadManager
    - If local URI returned: use local file:// URI for video/PDF player
    - If null returned: fall back to remote URL or show "File not available" message with re-download option
    - For videos: apply FLAG_SECURE during playback (see task 11)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 11. Implement screenshot and screen recording prevention
  - [x] 11.1 Add FLAG_SECURE for Android video playback
    - Use react-native-flag-secure to set FLAG_SECURE when local video starts playing
    - Remove FLAG_SECURE when video player closes or user navigates away
    - Apply only during local video playback, not for other screens
    - _Requirements: 5.1, 5.3_

  - [x] 11.2 Add iOS screen capture prevention
    - Use expo-screen-capture to prevent screenshots/recordings when local video plays
    - Remove prevention when video player closes or user navigates away
    - Apply only during local video playback, not for other screens
    - _Requirements: 5.2, 5.3_

- [x] 12. Implement AppState foreground check
  - [x] 12.1 Add AppState listener in app root (_layout.tsx or similar)
    - Import AppState from react-native
    - Add listener for 'active' state transitions
    - On foreground: call runForegroundAccessCheck from useDownloadManager
    - Ensure check completes before Downloads screen renders
    - _Requirements: 6.6_

- [x] 13. Implement backend cleanup functions for admin actions
  - [x] 13.1 Create internal deleteDownloadsForUser function in server/routes.ts
    - Accept userId and optional courseId parameters
    - Delete user_downloads records: WHERE user_id=$1 AND (courseId IS NULL OR course_id=$2)
    - Call from unenroll endpoint, course delete endpoint, student block endpoint
    - _Requirements: 6.1, 6.2, 6.3, 8.10, 8.11_

  - [ ] 13.2 Write property test for course deletion cleanup
    - **Property 10: Course deletion removes all user_downloads records for that course**
    - **Validates: Requirements 6.2**
    - Generate random course with multiple user downloads
    - Delete course via admin endpoint
    - Assert no user_downloads records exist for any lecture/material from that course

  - [ ] 13.3 Write property test for student blocking cleanup
    - **Property 11: Student blocking removes all user_downloads records for that student**
    - **Validates: Requirements 6.3**
    - Generate random student with multiple downloads
    - Block student via admin endpoint
    - Assert no user_downloads records exist for that user_id

  - [x] 13.2 Extend DELETE /api/my-downloads/:itemType/:itemId endpoint
    - Verify user authentication
    - Delete user_downloads record WHERE user_id=$1 AND item_type=$2 AND item_id=$3
    - Return 200 on success, 404 if record not found
    - _Requirements: 8.9_

  - [x] 13.3 Extend PUT /api/admin/enrollments/:id endpoint
    - Add support for valid_until field (BIGINT, epoch milliseconds or null)
    - Allow admin to set or update valid_until on enrollment
    - _Requirements: 9.1, 9.4_

- [x] 14. Add token cleanup job
  - [x] 14.1 Create periodic cleanup job in server/index.ts
    - Run every 5 minutes using setInterval
    - Delete expired used tokens: DELETE FROM download_tokens WHERE expires_at < now() AND used = TRUE
    - Log cleanup count for monitoring
    - _Requirements: 8.1_

- [x] 15. Checkpoint - Integration verification
  - All required tasks completed (optional property-based tests skipped as per user instruction)

- [x] 16. Write integration tests
  - [x] 16.1 End-to-end download flow test (iOS simulator)
    - Tap DownloadButton on a lecture
    - Verify token request to /api/download-url
    - Verify file download via /api/download-proxy
    - Verify encrypted file written to documentDirectory with UUID filename
    - Verify user_downloads record created with local_filename
    - Verify DownloadButton shows "Downloaded" state

  - [x] 16.2 End-to-end download flow test (Android emulator)
    - Same as 16.1 but on Android platform
    - Verify FLAG_SECURE is applied during video playback

  - [x] 16.3 Offline playback test
    - Download a lecture and study material
    - Disable device network connection
    - Open Downloads screen
    - Tap downloaded lecture - verify it plays from local URI
    - Tap downloaded material - verify it opens from local URI
    - Verify no network requests are made

  - [x] 16.4 Auto-deletion test for unenrollment
    - Download content from a course
    - Admin unenrolls student via API
    - Bring app to foreground
    - Verify local files are deleted from documentDirectory
    - Verify user_downloads records are removed
    - Verify Downloads screen no longer shows the items

  - [x] 16.5 Auto-deletion test for enrollment expiry
    - Download content from a course
    - Admin sets valid_until to past timestamp on enrollment
    - Bring app to foreground
    - Verify local files are deleted
    - Verify Downloads screen no longer shows the items

  - [x] 16.6 Screenshot prevention test
    - Play a downloaded video on Android
    - Attempt to take screenshot
    - Verify screenshot is blocked (black screen captured)
    - Close video player
    - Verify screenshots work normally on other screens

- [x] 17. Final checkpoint - Complete feature verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Integration tests verify end-to-end flows on real devices
- The feature extends existing infrastructure (user_downloads table, /api/my-downloads endpoints, app/downloads.tsx) rather than replacing it
- Web platform is explicitly excluded from all download functionality via Platform.OS guards
- Encryption uses AES-256-CBC with PBKDF2 key derivation stored in Expo SecureStore
- All file downloads are proxied through the backend - no direct R2 URLs are exposed to clients
- Auto-deletion is triggered by AppState foreground events and admin actions
