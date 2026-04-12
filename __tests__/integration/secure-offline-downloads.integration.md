# Secure Offline Downloads - Integration Test Plan

## Overview

This document outlines the integration tests for the secure offline downloads feature. These tests verify end-to-end flows on real iOS and Android devices/simulators.

**Note**: These tests require manual execution on physical devices or simulators as they test platform-specific features (encryption, screenshot prevention, file system operations) that cannot be fully automated without a proper E2E testing framework like Detox or Maestro.

## Prerequisites

### iOS Testing
- Xcode with iOS Simulator
- iOS 13.0 or higher
- Test device/simulator with sufficient storage (at least 500MB free)

### Android Testing
- Android Studio with Android Emulator
- Android API 21 or higher
- Test device/emulator with sufficient storage (at least 500MB free)

### Test Data Setup
- Backend server running with test database
- Test user account (student role)
- Test course with:
  - At least 2 lectures with `download_allowed = true`
  - At least 2 study materials with `download_allowed = true`
  - Active enrollment for test user

## Test Suite

### Test 16.1: End-to-End Download Flow (iOS Simulator)

**Objective**: Verify complete download flow from button tap to encrypted file storage on iOS.

**Steps**:
1. Launch app on iOS simulator
2. Log in as test student
3. Navigate to a course with downloadable content
4. Locate a lecture with `download_allowed = true`
5. Tap the DownloadButton component
6. Observe download progress indicator

**Expected Results**:
- ✓ DownloadButton shows download icon initially
- ✓ Network request to `GET /api/download-url` succeeds
- ✓ Response contains valid token and expiresAt timestamp
- ✓ Network request to `GET /api/download-proxy?token=<token>` succeeds
- ✓ Progress indicator updates from 0% to 100%
- ✓ Encrypted file written to `FileSystem.documentDirectory` with UUID filename (`.enc` extension)
- ✓ `POST /api/my-downloads` creates user_downloads record with `local_filename`
- ✓ DownloadButton changes to "Downloaded" state with green checkmark
- ✓ File size on disk is non-zero
- ✓ Filename matches UUID v4 pattern: `[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}.enc`

**Verification Commands** (using Expo FileSystem):
```javascript
// In app console or debug mode
import * as FileSystem from 'expo-file-system';

// List all .enc files
const files = await FileSystem.readDirectoryAsync(FileSystem.documentDirectory);
const encFiles = files.filter(f => f.endsWith('.enc'));
console.log('Encrypted files:', encFiles);

// Check file info
const fileInfo = await FileSystem.getInfoAsync(
  FileSystem.documentDirectory + encFiles[0]
);
console.log('File size:', fileInfo.size, 'bytes');
console.log('File exists:', fileInfo.exists);
```

---

### Test 16.2: End-to-End Download Flow (Android Emulator)

**Objective**: Verify complete download flow on Android and confirm FLAG_SECURE is applied during video playback.

**Steps**:
1. Launch app on Android emulator
2. Log in as test student
3. Navigate to a course with downloadable content
4. Locate a lecture with `download_allowed = true`
5. Tap the DownloadButton component
6. Wait for download to complete
7. Navigate to Downloads screen
8. Tap the downloaded lecture to play it
9. Attempt to take a screenshot during video playback
10. Close video player
11. Attempt to take a screenshot on another screen

**Expected Results**:
- ✓ All download flow results from Test 16.1 apply
- ✓ Video plays from local encrypted file
- ✓ Screenshot during video playback is blocked (black screen captured or screenshot fails)
- ✓ Screenshot on other screens works normally after closing video player
- ✓ FLAG_SECURE is removed when video player closes

**Verification**:
- Check Android logcat for FLAG_SECURE messages:
```bash
adb logcat | grep -i "FLAG_SECURE"
```
- Verify screenshot files in device gallery (should show black screen for video screenshots)

---

### Test 16.3: Offline Playback Test

**Objective**: Verify downloaded content can be accessed and played without network connection.

**Steps**:
1. Download a lecture and a study material (follow Test 16.1)
2. Verify both items show "Downloaded" state
3. **Disable device network connection** (airplane mode or disable WiFi/cellular)
4. Navigate to Downloads screen (`app/downloads.tsx`)
5. Verify "Available Offline" badge is shown for both items
6. Tap the downloaded lecture
7. Verify video plays from local URI
8. Close video player
9. Tap the downloaded study material
10. Verify PDF opens from local URI
11. Monitor network requests (should be zero)

**Expected Results**:
- ✓ Downloads screen loads successfully without network
- ✓ "Available Offline" badge displayed for downloaded items
- ✓ Lecture video plays smoothly from local file
- ✓ Study material PDF opens and displays correctly
- ✓ No network requests made during playback/viewing
- ✓ `getLocalUri` returns `file://` URI pointing to decrypted temp file
- ✓ Decryption completes successfully
- ✓ Temp file created in `cacheDirectory`

**Verification**:
```javascript
// Check network requests in React Native Debugger
// Should see no requests to /api/download-proxy or R2 URLs

// Verify local URI format
console.log('Local URI:', localUri);
// Expected: file:///path/to/cacheDirectory/temp-uuid.mp4
```

---

### Test 16.4: Auto-Deletion Test for Unenrollment

**Objective**: Verify downloaded content is automatically deleted when student is unenrolled from a course.

**Steps**:
1. Download content from a course (lecture + material)
2. Verify files exist in `documentDirectory`
3. Verify `user_downloads` records exist in database
4. **Admin action**: Unenroll student via API:
   ```bash
   DELETE /api/admin/enrollments/:enrollmentId
   ```
5. Bring app to foreground (if backgrounded) or trigger AppState 'active' event
6. Wait for foreground access check to complete
7. Navigate to Downloads screen
8. Check `documentDirectory` for encrypted files
9. Check database for `user_downloads` records

**Expected Results**:
- ✓ Foreground access check triggers on AppState 'active'
- ✓ `GET /api/my-downloads` excludes items from unenrolled course
- ✓ Local encrypted files deleted from `documentDirectory`
- ✓ `DELETE /api/my-downloads/:itemType/:itemId` called for each item
- ✓ `user_downloads` records removed from database
- ✓ Downloads screen no longer shows the items
- ✓ Total storage used decreases accordingly

**Verification**:
```sql
-- Check user_downloads table
SELECT * FROM user_downloads 
WHERE user_id = :testUserId 
AND item_id IN (SELECT id FROM lectures WHERE course_id = :testCourseId);
-- Expected: 0 rows

-- Check download_tokens table (should have used tokens)
SELECT * FROM download_tokens 
WHERE user_id = :testUserId 
AND item_id IN (SELECT id FROM lectures WHERE course_id = :testCourseId);
```

```javascript
// Check file system
const files = await FileSystem.readDirectoryAsync(FileSystem.documentDirectory);
const encFiles = files.filter(f => f.endsWith('.enc'));
console.log('Remaining encrypted files:', encFiles.length);
// Should be 0 if all downloads were from the unenrolled course
```

---

### Test 16.5: Auto-Deletion Test for Enrollment Expiry

**Objective**: Verify downloaded content is automatically deleted when enrollment validity expires.

**Steps**:
1. Download content from a course
2. Verify files exist and Downloads screen shows items
3. **Admin action**: Set `valid_until` to past timestamp via API:
   ```bash
   PUT /api/admin/enrollments/:enrollmentId
   {
     "valid_until": <timestamp 1 hour ago>
   }
   ```
4. Bring app to foreground or trigger AppState 'active' event
5. Wait for foreground access check to complete
6. Navigate to Downloads screen
7. Verify items are no longer shown
8. Check `documentDirectory` for encrypted files
9. Check database for `user_downloads` records

**Expected Results**:
- ✓ `GET /api/my-downloads` excludes items from expired enrollment
- ✓ Foreground check detects missing items from server response
- ✓ Local encrypted files deleted from `documentDirectory`
- ✓ `user_downloads` records removed from database
- ✓ Downloads screen shows no items from expired course
- ✓ If user attempts to download again, receives 403 error

**Verification**:
```sql
-- Check enrollment validity
SELECT id, user_id, course_id, valid_until, 
       CASE WHEN valid_until < EXTRACT(EPOCH FROM NOW()) * 1000 
            THEN 'expired' ELSE 'active' END as status
FROM enrollments 
WHERE user_id = :testUserId;

-- Check user_downloads (should be empty for expired course)
SELECT * FROM user_downloads 
WHERE user_id = :testUserId 
AND item_id IN (
  SELECT id FROM lectures WHERE course_id = :expiredCourseId
);
```

---

### Test 16.6: Screenshot Prevention Test

**Objective**: Verify screenshots are blocked during video playback and work normally on other screens.

**Platform**: Android (FLAG_SECURE) and iOS (expo-screen-capture)

**Steps**:
1. Download a lecture video
2. Navigate to Downloads screen
3. Tap the downloaded lecture to play it
4. Wait for video to start playing
5. **Attempt to take screenshot** (Power + Volume Down on Android, Power + Volume Up on iOS)
6. Observe screenshot result
7. Close video player
8. Navigate to any other screen (e.g., course list)
9. **Attempt to take screenshot** on non-video screen
10. Verify screenshot works normally

**Expected Results**:

**Android**:
- ✓ FLAG_SECURE applied when video player opens
- ✓ Screenshot during video playback results in black screen or fails with error
- ✓ Screenshot notification may show "Can't take screenshot due to security policy"
- ✓ FLAG_SECURE removed when video player closes
- ✓ Screenshots work normally on other screens

**iOS**:
- ✓ `expo-screen-capture.preventScreenCaptureAsync()` called when video starts
- ✓ Screenshot during video playback results in black screen
- ✓ Screen recording is also blocked
- ✓ `expo-screen-capture.allowScreenCaptureAsync()` called when video closes
- ✓ Screenshots work normally on other screens

**Verification**:
```javascript
// Check screen protection status (iOS)
import * as ScreenCapture from 'expo-screen-capture';

const hasPermissions = await ScreenCapture.isAvailableAsync();
console.log('Screen capture available:', hasPermissions);

// Android - check logcat
// adb logcat | grep -i "FLAG_SECURE"
// Should see messages when flag is set/unset
```

**Manual Verification**:
- Check device photo gallery for screenshots
- Black screen screenshots indicate successful blocking
- Normal screenshots on other screens indicate proper cleanup

---

## Test Execution Checklist

### Pre-Test Setup
- [ ] Backend server running with test database
- [ ] Test user account created (student role)
- [ ] Test course created with downloadable content
- [ ] Test user enrolled in test course
- [ ] Device/simulator has sufficient storage
- [ ] Network connection available (for download tests)

### iOS Tests
- [ ] Test 16.1: End-to-end download flow (iOS)
- [ ] Test 16.3: Offline playback (iOS)
- [ ] Test 16.4: Auto-deletion for unenrollment (iOS)
- [ ] Test 16.5: Auto-deletion for enrollment expiry (iOS)
- [ ] Test 16.6: Screenshot prevention (iOS)

### Android Tests
- [ ] Test 16.2: End-to-end download flow (Android)
- [ ] Test 16.3: Offline playback (Android)
- [ ] Test 16.4: Auto-deletion for unenrollment (Android)
- [ ] Test 16.5: Auto-deletion for enrollment expiry (Android)
- [ ] Test 16.6: Screenshot prevention (Android)

### Post-Test Cleanup
- [ ] Delete test downloads from device
- [ ] Remove test user_downloads records from database
- [ ] Clean up test data (users, courses, enrollments)
- [ ] Clear download_tokens table

---

## Automated Testing Setup (Future Enhancement)

To automate these integration tests, consider setting up:

### Option 1: Detox (Recommended)
```bash
npm install --save-dev detox detox-cli
```

**Pros**:
- Mature, widely used
- Good React Native support
- Synchronization with React Native bridge

**Cons**:
- Complex setup
- Requires native code configuration

### Option 2: Maestro (Simpler Alternative)
```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
```

**Pros**:
- Simple YAML-based tests
- No native code changes needed
- Fast setup

**Cons**:
- Newer, less mature
- Limited advanced features

### Example Detox Test (Test 16.1)
```javascript
// e2e/secure-offline-downloads.e2e.js
describe('Secure Offline Downloads', () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  it('should download a lecture end-to-end', async () => {
    // Login
    await element(by.id('email-input')).typeText('student@test.com');
    await element(by.id('password-input')).typeText('password123');
    await element(by.id('login-button')).tap();

    // Navigate to course
    await element(by.id('course-1')).tap();

    // Tap download button
    await element(by.id('download-button-lecture-1')).tap();

    // Wait for download to complete
    await waitFor(element(by.id('download-button-lecture-1')))
      .toHaveText('Downloaded')
      .withTimeout(30000);

    // Verify downloaded state
    await expect(element(by.id('download-button-lecture-1'))).toHaveText('Downloaded');
  });
});
```

---

## Known Limitations

1. **Encryption verification**: Cannot directly verify AES-256 encryption without decrypting files
2. **Watermark verification**: Cannot verify watermark token without inspecting network traffic
3. **File system access**: Limited ability to inspect app-private storage on real devices
4. **Screenshot blocking**: Must be verified manually by checking captured screenshots
5. **Network isolation**: Airplane mode may affect other device functions during testing

---

## Troubleshooting

### Issue: Download fails with 403 error
- **Cause**: Token expired or enrollment check failed
- **Solution**: Verify enrollment exists and is active, check `valid_until` timestamp

### Issue: Encrypted file not found after download
- **Cause**: File write failed or wrong directory
- **Solution**: Check device storage space, verify `FileSystem.documentDirectory` path

### Issue: Offline playback fails
- **Cause**: Decryption failed or temp file not created
- **Solution**: Check encryption key in SecureStore, verify `cacheDirectory` is writable

### Issue: Auto-deletion not triggered
- **Cause**: AppState listener not firing or foreground check not running
- **Solution**: Manually trigger foreground event, check AppState listener registration

### Issue: Screenshot prevention not working
- **Cause**: FLAG_SECURE not applied or expo-screen-capture not called
- **Solution**: Check video player component, verify screen protection hooks are active

---

## Success Criteria

All integration tests pass when:
- ✓ Downloads complete successfully on both iOS and Android
- ✓ Encrypted files stored with UUID filenames
- ✓ Offline playback works without network
- ✓ Auto-deletion triggers on unenrollment and expiry
- ✓ Screenshots blocked during video playback
- ✓ No crashes or errors during any test flow
- ✓ Database records consistent with file system state
- ✓ Storage usage accurately reported

---

## Test Report Template

```markdown
# Integration Test Report: Secure Offline Downloads

**Date**: YYYY-MM-DD
**Tester**: [Name]
**Platform**: iOS / Android
**Device**: [Device/Simulator Name]
**OS Version**: [Version]

## Test Results

| Test ID | Test Name | Status | Notes |
|---------|-----------|--------|-------|
| 16.1 | End-to-end download (iOS) | ✓ Pass / ✗ Fail | |
| 16.2 | End-to-end download (Android) | ✓ Pass / ✗ Fail | |
| 16.3 | Offline playback | ✓ Pass / ✗ Fail | |
| 16.4 | Auto-deletion (unenrollment) | ✓ Pass / ✗ Fail | |
| 16.5 | Auto-deletion (expiry) | ✓ Pass / ✗ Fail | |
| 16.6 | Screenshot prevention | ✓ Pass / ✗ Fail | |

## Issues Found

1. [Issue description]
   - **Severity**: Critical / High / Medium / Low
   - **Steps to reproduce**: [Steps]
   - **Expected**: [Expected behavior]
   - **Actual**: [Actual behavior]

## Recommendations

[Any recommendations for improvements or fixes]

## Sign-off

- [ ] All tests passed
- [ ] Issues documented and assigned
- [ ] Feature ready for production

**Tester Signature**: _______________
**Date**: _______________
```
