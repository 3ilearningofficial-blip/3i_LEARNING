# Integration Tests: Secure Offline Downloads

This directory contains integration tests for the secure offline downloads feature.

## Test Files

### 1. `secure-offline-downloads.integration.test.ts`
**Automated backend integration tests** that verify database operations and backend logic.

**What it tests**:
- ✓ End-to-end download flow (token generation → proxy download → user_downloads record)
- ✓ Token expiry and single-use enforcement
- ✓ Offline playback data retrieval
- ✓ Auto-deletion on unenrollment
- ✓ Auto-deletion on enrollment expiry
- ✓ Student blocking cleanup
- ✓ Course deletion cleanup
- ✓ Token cleanup job

**How to run**:
```bash
npm test -- __tests__/integration/secure-offline-downloads.integration.test.ts
```

**Requirements**:
- PostgreSQL database (uses `DATABASE_URL` from `.env`)
- Node.js environment
- No mobile device/simulator needed

---

### 2. `secure-offline-downloads.integration.md`
**Manual E2E test plan** for iOS and Android platforms.

**What it covers**:
- Test 16.1: End-to-end download flow (iOS simulator)
- Test 16.2: End-to-end download flow (Android emulator)
- Test 16.3: Offline playback test
- Test 16.4: Auto-deletion test for unenrollment
- Test 16.5: Auto-deletion test for enrollment expiry
- Test 16.6: Screenshot prevention test

**How to use**:
1. Open `secure-offline-downloads.integration.md`
2. Follow the step-by-step instructions for each test
3. Execute tests manually on iOS simulator or Android emulator
4. Document results using the test report template

**Requirements**:
- iOS Simulator (Xcode) or Android Emulator (Android Studio)
- Running backend server
- Test data setup (user, course, enrollment)

---

## Test Coverage

### Automated Tests (`.test.ts`)
These tests run in Node.js and verify:
- ✅ Database schema and queries
- ✅ Token generation and validation
- ✅ Enrollment checks
- ✅ Auto-deletion logic
- ✅ Cleanup operations

### Manual Tests (`.md`)
These tests require physical devices/simulators and verify:
- ⚠️ React Native UI components
- ⚠️ File system operations (encryption, storage)
- ⚠️ Platform-specific features (FLAG_SECURE, expo-screen-capture)
- ⚠️ Network operations (download progress, offline mode)
- ⚠️ Video playback and PDF viewing

---

## Running All Tests

### Backend Integration Tests Only
```bash
npm test -- __tests__/integration/
```

### Full Test Suite (including unit tests)
```bash
npm test
```

### Watch Mode (for development)
```bash
npm run test:watch -- __tests__/integration/
```

---

## Test Data Setup

The automated tests create their own test data in `beforeEach` hooks. For manual E2E tests, you need to set up:

1. **Test User**:
   - Email: `student@test.com`
   - Role: `student`
   - Password: (set via your auth system)

2. **Test Course**:
   - Title: "Test Course"
   - At least 2 lectures with `download_allowed = true`
   - At least 2 study materials with `download_allowed = true`

3. **Test Enrollment**:
   - Link test user to test course
   - Status: `active`
   - `valid_until`: `NULL` (no expiry)

---

## Troubleshooting

### Tests fail with "relation does not exist"
**Cause**: Database tables not created.
**Solution**: The tests create tables automatically in `beforeAll`. Ensure `DATABASE_URL` is set correctly in `.env`.

### Tests timeout
**Cause**: Database connection issues.
**Solution**: Check PostgreSQL is running and `DATABASE_URL` is correct.

### Manual tests fail on device
**Cause**: Various platform-specific issues.
**Solution**: See troubleshooting section in `secure-offline-downloads.integration.md`.

---

## CI/CD Integration

To run these tests in CI/CD:

```yaml
# Example GitHub Actions workflow
- name: Run Integration Tests
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
  run: npm test -- __tests__/integration/
```

**Note**: Manual E2E tests (`.md`) cannot be automated without a proper E2E testing framework like Detox or Maestro.

---

## Future Enhancements

1. **Automated E2E Tests**: Set up Detox or Maestro for automated mobile testing
2. **Screenshot Verification**: Automate screenshot prevention testing
3. **Performance Tests**: Add tests for large file downloads and concurrent operations
4. **Network Simulation**: Test various network conditions (slow, intermittent)
5. **Storage Limits**: Test behavior when device storage is full

---

## Related Documentation

- [Design Document](../../.kiro/specs/secure-offline-downloads/design.md)
- [Requirements Document](../../.kiro/specs/secure-offline-downloads/requirements.md)
- [Tasks Document](../../.kiro/specs/secure-offline-downloads/tasks.md)
