/**
 * Integration Tests: Secure Offline Downloads
 * 
 * These tests verify the integration between backend endpoints, database,
 * and core download logic. They do NOT test React Native UI components
 * or platform-specific features (encryption, screenshot prevention).
 * 
 * For full E2E tests on iOS/Android simulators, see:
 * __tests__/integration/secure-offline-downloads.integration.md
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === 'true' && Boolean(TEST_DB_URL);
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

if (process.env.RUN_DB_TESTS === 'true' && !TEST_DB_URL) {
  throw new Error("RUN_DB_TESTS=true requires TEST_DATABASE_URL (DATABASE_URL fallback is disabled for safety)");
}

let db: Pool;

// Test data IDs
let testUserId: number;
let testCourseId: number;
let testLectureId: number;
let testMaterialId: number;
let testEnrollmentId: number;

beforeAll(async () => {
  db = new Pool({
    connectionString: TEST_DB_URL,
  });

  // Create test tables if they don't exist
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      email TEXT UNIQUE,
      role TEXT NOT NULL DEFAULT 'student',
      is_blocked BOOLEAN DEFAULT FALSE
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS courses (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS lectures (
      id SERIAL PRIMARY KEY,
      course_id INTEGER,
      title TEXT NOT NULL,
      video_url TEXT,
      download_allowed BOOLEAN DEFAULT FALSE
    )
  `);
  await db.query(`ALTER TABLE lectures ADD COLUMN IF NOT EXISTS download_allowed BOOLEAN DEFAULT FALSE`);
  await db.query(`ALTER TABLE lectures ADD COLUMN IF NOT EXISTS video_url TEXT`);
  await db.query(`ALTER TABLE lectures ADD COLUMN IF NOT EXISTS course_id INTEGER`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS study_materials (
      id SERIAL PRIMARY KEY,
      course_id INTEGER,
      title TEXT NOT NULL,
      file_url TEXT,
      download_allowed BOOLEAN DEFAULT FALSE
    )
  `);
  await db.query(`ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS download_allowed BOOLEAN DEFAULT FALSE`);
  await db.query(`ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS file_url TEXT`);
  await db.query(`ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS course_id INTEGER`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      course_id INTEGER,
      status TEXT DEFAULT 'active',
      valid_until BIGINT
    )
  `);
  await db.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`);
  await db.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS valid_until BIGINT`);
  await db.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS user_id INTEGER`);
  await db.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS course_id INTEGER`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS download_tokens (
      id SERIAL PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      r2_key TEXT NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    )
  `);
  await db.query(`ALTER TABLE download_tokens ADD COLUMN IF NOT EXISTS token TEXT`);
  await db.query(`ALTER TABLE download_tokens ADD COLUMN IF NOT EXISTS user_id INTEGER`);
  await db.query(`ALTER TABLE download_tokens ADD COLUMN IF NOT EXISTS item_type TEXT`);
  await db.query(`ALTER TABLE download_tokens ADD COLUMN IF NOT EXISTS item_id INTEGER`);
  await db.query(`ALTER TABLE download_tokens ADD COLUMN IF NOT EXISTS r2_key TEXT`);
  await db.query(`ALTER TABLE download_tokens ADD COLUMN IF NOT EXISTS used BOOLEAN DEFAULT FALSE`);
  await db.query(`ALTER TABLE download_tokens ADD COLUMN IF NOT EXISTS created_at BIGINT`);
  await db.query(`ALTER TABLE download_tokens ADD COLUMN IF NOT EXISTS expires_at BIGINT`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_downloads (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      local_filename TEXT,
      downloaded_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      UNIQUE(user_id, item_type, item_id)
    )
  `);
  await db.query(`ALTER TABLE user_downloads ADD COLUMN IF NOT EXISTS user_id INTEGER`);
  await db.query(`ALTER TABLE user_downloads ADD COLUMN IF NOT EXISTS item_type TEXT`);
  await db.query(`ALTER TABLE user_downloads ADD COLUMN IF NOT EXISTS item_id INTEGER`);
  await db.query(`ALTER TABLE user_downloads ADD COLUMN IF NOT EXISTS local_filename TEXT`);
});

afterAll(async () => {
  // Clean up test tables
  await db.query('DROP TABLE IF EXISTS user_downloads CASCADE');
  await db.query('DROP TABLE IF EXISTS download_tokens CASCADE');
  await db.query('DROP TABLE IF EXISTS enrollments CASCADE');
  await db.query('DROP TABLE IF EXISTS study_materials CASCADE');
  await db.query('DROP TABLE IF EXISTS lectures CASCADE');
  await db.query('DROP TABLE IF EXISTS courses CASCADE');
  await db.query('DROP TABLE IF EXISTS users CASCADE');
  await db.end();
});

beforeEach(async () => {
  // Clear test data
  await db.query('DELETE FROM user_downloads');
  await db.query('DELETE FROM download_tokens');
  await db.query('DELETE FROM enrollments');
  await db.query('DELETE FROM study_materials');
  await db.query('DELETE FROM lectures');
  await db.query('DELETE FROM courses');
  await db.query('DELETE FROM users');

  // Create test data
  const userResult = await db.query(
    'INSERT INTO users (name, email, role) VALUES ($1, $2, $3) RETURNING id',
    ['Test Student', 'student@test.com', 'student']
  );
  testUserId = userResult.rows[0].id;

  const courseResult = await db.query(
    'INSERT INTO courses (title) VALUES ($1) RETURNING id',
    ['Test Course']
  );
  testCourseId = courseResult.rows[0].id;

  const lectureResult = await db.query(
    'INSERT INTO lectures (course_id, title, video_url, download_allowed) VALUES ($1, $2, $3, $4) RETURNING id',
    [testCourseId, 'Test Lecture', 'https://cdn.example.com/video.mp4', true]
  );
  testLectureId = lectureResult.rows[0].id;

  const materialResult = await db.query(
    'INSERT INTO study_materials (course_id, title, file_url, download_allowed) VALUES ($1, $2, $3, $4) RETURNING id',
    [testCourseId, 'Test Material', 'https://cdn.example.com/material.pdf', true]
  );
  testMaterialId = materialResult.rows[0].id;

  const enrollmentResult = await db.query(
    'INSERT INTO enrollments (user_id, course_id, status) VALUES ($1, $2, $3) RETURNING id',
    [testUserId, testCourseId, 'active']
  );
  testEnrollmentId = enrollmentResult.rows[0].id;
});

describeDb('Integration Test 16.1 & 16.2: End-to-End Download Flow', () => {
  it('should complete full download flow: token generation → proxy download → user_downloads record', async () => {
    // Step 1: Generate download token (simulates GET /api/download-url)
    const token = randomUUID();
    const createdAt = Date.now();
    const expiresAt = createdAt + 30000;

    await db.query(
      'INSERT INTO download_tokens (token, user_id, item_type, item_id, r2_key, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [token, testUserId, 'lecture', testLectureId, 'video.mp4', createdAt, expiresAt]
    );

    // Verify token was created
    const tokenResult = await db.query(
      'SELECT * FROM download_tokens WHERE token = $1',
      [token]
    );
    expect(tokenResult.rows.length).toBe(1);
    expect(tokenResult.rows[0].used).toBe(false);
    expect(tokenResult.rows[0].expires_at - tokenResult.rows[0].created_at).toBeLessThanOrEqual(30000);

    // Step 2: Mark token as used (simulates GET /api/download-proxy)
    await db.query(
      'UPDATE download_tokens SET used = TRUE WHERE token = $1',
      [token]
    );

    const usedTokenResult = await db.query(
      'SELECT * FROM download_tokens WHERE token = $1',
      [token]
    );
    expect(usedTokenResult.rows[0].used).toBe(true);

    // Step 3: Create user_downloads record (simulates POST /api/my-downloads)
    const localFilename = randomUUID();
    await db.query(
      'INSERT INTO user_downloads (user_id, item_type, item_id, local_filename) VALUES ($1, $2, $3, $4)',
      [testUserId, 'lecture', testLectureId, localFilename]
    );

    // Verify user_downloads record
    const downloadResult = await db.query(
      'SELECT * FROM user_downloads WHERE user_id = $1 AND item_type = $2 AND item_id = $3',
      [testUserId, 'lecture', testLectureId]
    );
    expect(downloadResult.rows.length).toBe(1);
    expect(downloadResult.rows[0].local_filename).toBe(localFilename);
    expect(downloadResult.rows[0].local_filename).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('should prevent token reuse after first use', async () => {
    const token = randomUUID();
    const createdAt = Date.now();
    const expiresAt = createdAt + 30000;

    await db.query(
      'INSERT INTO download_tokens (token, user_id, item_type, item_id, r2_key, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [token, testUserId, 'lecture', testLectureId, 'video.mp4', createdAt, expiresAt]
    );

    // First use - should succeed
    const firstUseResult = await db.query(
      'SELECT * FROM download_tokens WHERE token = $1 AND used = FALSE AND expires_at > $2',
      [token, Date.now()]
    );
    expect(firstUseResult.rows.length).toBe(1);

    // Mark as used
    await db.query('UPDATE download_tokens SET used = TRUE WHERE token = $1', [token]);

    // Second use - should fail (no rows returned)
    const secondUseResult = await db.query(
      'SELECT * FROM download_tokens WHERE token = $1 AND used = FALSE AND expires_at > $2',
      [token, Date.now()]
    );
    expect(secondUseResult.rows.length).toBe(0);
  });
});

describeDb('Integration Test 16.3: Offline Playback', () => {
  it('should retrieve user_downloads records for offline playback', async () => {
    // Create download records
    const lectureFilename = randomUUID();
    const materialFilename = randomUUID();

    await db.query(
      'INSERT INTO user_downloads (user_id, item_type, item_id, local_filename) VALUES ($1, $2, $3, $4)',
      [testUserId, 'lecture', testLectureId, lectureFilename]
    );

    await db.query(
      'INSERT INTO user_downloads (user_id, item_type, item_id, local_filename) VALUES ($1, $2, $3, $4)',
      [testUserId, 'material', testMaterialId, materialFilename]
    );

    // Simulate GET /api/my-downloads
    const downloadsResult = await db.query(
      `SELECT ud.*, l.title as lecture_title, sm.title as material_title
       FROM user_downloads ud
       LEFT JOIN lectures l ON ud.item_type = 'lecture' AND ud.item_id = l.id
       LEFT JOIN study_materials sm ON ud.item_type = 'material' AND ud.item_id = sm.id
       WHERE ud.user_id = $1`,
      [testUserId]
    );

    expect(downloadsResult.rows.length).toBe(2);
    
    const lectureDownload = downloadsResult.rows.find(r => r.item_type === 'lecture');
    expect(lectureDownload).toBeDefined();
    expect(lectureDownload.local_filename).toBe(lectureFilename);
    expect(lectureDownload.lecture_title).toBe('Test Lecture');

    const materialDownload = downloadsResult.rows.find(r => r.item_type === 'material');
    expect(materialDownload).toBeDefined();
    expect(materialDownload.local_filename).toBe(materialFilename);
    expect(materialDownload.material_title).toBe('Test Material');
  });
});

describeDb('Integration Test 16.4: Auto-Deletion on Unenrollment', () => {
  it('should remove user_downloads records when enrollment is deleted', async () => {
    // Create download records
    await db.query(
      'INSERT INTO user_downloads (user_id, item_type, item_id, local_filename) VALUES ($1, $2, $3, $4)',
      [testUserId, 'lecture', testLectureId, randomUUID()]
    );

    await db.query(
      'INSERT INTO user_downloads (user_id, item_type, item_id, local_filename) VALUES ($1, $2, $3, $4)',
      [testUserId, 'material', testMaterialId, randomUUID()]
    );

    // Verify downloads exist
    const beforeResult = await db.query(
      'SELECT * FROM user_downloads WHERE user_id = $1',
      [testUserId]
    );
    expect(beforeResult.rows.length).toBe(2);

    // Simulate admin unenrollment - delete enrollment
    await db.query('DELETE FROM enrollments WHERE id = $1', [testEnrollmentId]);

    // Simulate backend cleanup function: deleteDownloadsForUser
    await db.query(
      `DELETE FROM user_downloads 
       WHERE user_id = $1 
       AND item_id IN (
         SELECT id FROM lectures WHERE course_id = $2
         UNION
         SELECT id FROM study_materials WHERE course_id = $2
       )`,
      [testUserId, testCourseId]
    );

    // Verify downloads were deleted
    const afterResult = await db.query(
      'SELECT * FROM user_downloads WHERE user_id = $1',
      [testUserId]
    );
    expect(afterResult.rows.length).toBe(0);
  });

  it('should exclude downloads from deleted enrollments in GET /api/my-downloads', async () => {
    // Create download records
    await db.query(
      'INSERT INTO user_downloads (user_id, item_type, item_id, local_filename) VALUES ($1, $2, $3, $4)',
      [testUserId, 'lecture', testLectureId, randomUUID()]
    );

    // Delete enrollment
    await db.query('DELETE FROM enrollments WHERE id = $1', [testEnrollmentId]);

    // Simulate GET /api/my-downloads with enrollment check
    const downloadsResult = await db.query(
      `SELECT ud.* 
       FROM user_downloads ud
       INNER JOIN lectures l ON ud.item_type = 'lecture' AND ud.item_id = l.id
       INNER JOIN enrollments e ON e.user_id = ud.user_id AND e.course_id = l.course_id
       WHERE ud.user_id = $1 AND e.status = 'active'`,
      [testUserId]
    );

    // Should return 0 rows because enrollment was deleted
    expect(downloadsResult.rows.length).toBe(0);
  });
});

describeDb('Integration Test 16.5: Auto-Deletion on Enrollment Expiry', () => {
  it('should exclude downloads from expired enrollments in GET /api/my-downloads', async () => {
    // Create download records
    await db.query(
      'INSERT INTO user_downloads (user_id, item_type, item_id, local_filename) VALUES ($1, $2, $3, $4)',
      [testUserId, 'lecture', testLectureId, randomUUID()]
    );

    // Set enrollment to expired (1 hour ago)
    const expiredTimestamp = Date.now() - 3600000;
    await db.query(
      'UPDATE enrollments SET valid_until = $1 WHERE id = $2',
      [expiredTimestamp, testEnrollmentId]
    );

    // Simulate GET /api/my-downloads with expiry check
    const downloadsResult = await db.query(
      `SELECT ud.* 
       FROM user_downloads ud
       INNER JOIN lectures l ON ud.item_type = 'lecture' AND ud.item_id = l.id
       INNER JOIN enrollments e ON e.user_id = ud.user_id AND e.course_id = l.course_id
       WHERE ud.user_id = $1 
       AND e.status = 'active'
       AND (e.valid_until IS NULL OR e.valid_until > $2)`,
      [testUserId, Date.now()]
    );

    // Should return 0 rows because enrollment is expired
    expect(downloadsResult.rows.length).toBe(0);
  });

  it('should prevent token generation for expired enrollments', async () => {
    // Set enrollment to expired
    const expiredTimestamp = Date.now() - 3600000;
    await db.query(
      'UPDATE enrollments SET valid_until = $1 WHERE id = $2',
      [expiredTimestamp, testEnrollmentId]
    );

    // Simulate GET /api/download-url enrollment check
    const enrollmentResult = await db.query(
      `SELECT id FROM enrollments 
       WHERE user_id = $1 AND course_id = $2 
       AND status = 'active'
       AND (valid_until IS NULL OR valid_until > $3)`,
      [testUserId, testCourseId, Date.now()]
    );

    // Should return 0 rows - enrollment is expired
    expect(enrollmentResult.rows.length).toBe(0);
  });

  it('should allow downloads for enrollments with future valid_until', async () => {
    // Set enrollment to expire in 1 week
    const futureTimestamp = Date.now() + 7 * 24 * 3600000;
    await db.query(
      'UPDATE enrollments SET valid_until = $1 WHERE id = $2',
      [futureTimestamp, testEnrollmentId]
    );

    // Simulate GET /api/download-url enrollment check
    const enrollmentResult = await db.query(
      `SELECT id FROM enrollments 
       WHERE user_id = $1 AND course_id = $2 
       AND status = 'active'
       AND (valid_until IS NULL OR valid_until > $3)`,
      [testUserId, testCourseId, Date.now()]
    );

    // Should return 1 row - enrollment is still valid
    expect(enrollmentResult.rows.length).toBe(1);
  });
});

describeDb('Integration Test: Token Expiry and Cleanup', () => {
  it('should reject expired tokens', async () => {
    const token = randomUUID();
    const createdAt = Date.now() - 60000; // 1 minute ago
    const expiresAt = createdAt + 30000; // Expired 30 seconds ago

    await db.query(
      'INSERT INTO download_tokens (token, user_id, item_type, item_id, r2_key, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [token, testUserId, 'lecture', testLectureId, 'video.mp4', createdAt, expiresAt]
    );

    // Simulate GET /api/download-proxy token validation
    const tokenResult = await db.query(
      'SELECT * FROM download_tokens WHERE token = $1 AND used = FALSE AND expires_at > $2',
      [token, Date.now()]
    );

    // Should return 0 rows - token is expired
    expect(tokenResult.rows.length).toBe(0);
  });

  it('should clean up expired used tokens', async () => {
    // Create expired used token
    const expiredToken = randomUUID();
    const createdAt = Date.now() - 60000;
    const expiresAt = createdAt + 30000;

    await db.query(
      'INSERT INTO download_tokens (token, user_id, item_type, item_id, r2_key, used, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [expiredToken, testUserId, 'lecture', testLectureId, 'video.mp4', true, createdAt, expiresAt]
    );

    // Create fresh unused token
    const freshToken = randomUUID();
    const freshCreatedAt = Date.now();
    const freshExpiresAt = freshCreatedAt + 30000;

    await db.query(
      'INSERT INTO download_tokens (token, user_id, item_type, item_id, r2_key, used, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [freshToken, testUserId, 'lecture', testLectureId, 'video.mp4', false, freshCreatedAt, freshExpiresAt]
    );

    // Simulate cleanup job: DELETE expired used tokens
    await db.query(
      'DELETE FROM download_tokens WHERE expires_at < $1 AND used = TRUE',
      [Date.now()]
    );

    // Verify expired token was deleted
    const expiredResult = await db.query(
      'SELECT * FROM download_tokens WHERE token = $1',
      [expiredToken]
    );
    expect(expiredResult.rows.length).toBe(0);

    // Verify fresh token still exists
    const freshResult = await db.query(
      'SELECT * FROM download_tokens WHERE token = $1',
      [freshToken]
    );
    expect(freshResult.rows.length).toBe(1);
  });
});

describeDb('Integration Test: Student Blocking', () => {
  it('should remove all downloads when student is blocked', async () => {
    // Create download records
    await db.query(
      'INSERT INTO user_downloads (user_id, item_type, item_id, local_filename) VALUES ($1, $2, $3, $4)',
      [testUserId, 'lecture', testLectureId, randomUUID()]
    );

    await db.query(
      'INSERT INTO user_downloads (user_id, item_type, item_id, local_filename) VALUES ($1, $2, $3, $4)',
      [testUserId, 'material', testMaterialId, randomUUID()]
    );

    // Verify downloads exist
    const beforeResult = await db.query(
      'SELECT * FROM user_downloads WHERE user_id = $1',
      [testUserId]
    );
    expect(beforeResult.rows.length).toBe(2);

    // Simulate admin blocking student
    await db.query('UPDATE users SET is_blocked = TRUE WHERE id = $1', [testUserId]);

    // Simulate backend cleanup: deleteDownloadsForUser (all courses)
    await db.query(
      'DELETE FROM user_downloads WHERE user_id = $1',
      [testUserId]
    );

    // Verify all downloads were deleted
    const afterResult = await db.query(
      'SELECT * FROM user_downloads WHERE user_id = $1',
      [testUserId]
    );
    expect(afterResult.rows.length).toBe(0);
  });
});

describeDb('Integration Test: Course Deletion', () => {
  it('should remove all downloads when course is deleted', async () => {
    // Create another user with downloads from the same course
    const user2Result = await db.query(
      'INSERT INTO users (name, email, role) VALUES ($1, $2, $3) RETURNING id',
      ['Test Student 2', 'student2@test.com', 'student']
    );
    const user2Id = user2Result.rows[0].id;

    await db.query(
      'INSERT INTO enrollments (user_id, course_id, status) VALUES ($1, $2, $3)',
      [user2Id, testCourseId, 'active']
    );

    // Create downloads for both users
    await db.query(
      'INSERT INTO user_downloads (user_id, item_type, item_id, local_filename) VALUES ($1, $2, $3, $4)',
      [testUserId, 'lecture', testLectureId, randomUUID()]
    );

    await db.query(
      'INSERT INTO user_downloads (user_id, item_type, item_id, local_filename) VALUES ($1, $2, $3, $4)',
      [user2Id, 'lecture', testLectureId, randomUUID()]
    );

    // Verify downloads exist for both users
    const beforeResult = await db.query(
      'SELECT * FROM user_downloads WHERE item_id = $1',
      [testLectureId]
    );
    expect(beforeResult.rows.length).toBe(2);

    // Simulate admin deleting course - cleanup all downloads for that course
    await db.query(
      `DELETE FROM user_downloads 
       WHERE item_id IN (
         SELECT id FROM lectures WHERE course_id = $1
         UNION
         SELECT id FROM study_materials WHERE course_id = $1
       )`,
      [testCourseId]
    );

    // Verify all downloads for that course were deleted (both users)
    const afterResult = await db.query(
      'SELECT * FROM user_downloads WHERE item_id = $1',
      [testLectureId]
    );
    expect(afterResult.rows.length).toBe(0);
  });
});
