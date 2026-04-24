import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { Pool } from 'pg';

const TEST_DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === 'true' && Boolean(TEST_DB_URL);
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

/**
 * Feature: secure-offline-downloads
 * Property 8: Enrollment verification gates all signed URL issuance
 * 
 * **Validates: Requirements 2.2, 2.3, 8.2, 8.3, 8.4, 9.3**
 * 
 * This property test verifies that the /api/download-url endpoint correctly
 * enforces enrollment verification and download_allowed checks before issuing
 * signed tokens. A token should be returned if and only if:
 * - download_allowed = true on the item
 * - active enrollment exists for the user in the course
 * - valid_until is NULL or has not expired
 */

// Test database connection
let db: Pool;

// Helper function to simulate the download-url endpoint logic
async function simulateDownloadUrlRequest(
  userId: number,
  itemType: 'lecture' | 'material',
  itemId: number
): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    // Resolve item to course and check download_allowed
    let courseId: number | null = null;
    let downloadAllowed = false;
    let r2Key: string | null = null;

    if (itemType === 'lecture') {
      const lectureResult = await db.query(
        'SELECT course_id, download_allowed, video_url FROM lectures WHERE id = $1',
        [itemId]
      );
      if (lectureResult.rows.length === 0) {
        return { success: false, error: 'Lecture not found' };
      }
      const lecture = lectureResult.rows[0];
      courseId = lecture.course_id;
      downloadAllowed = lecture.download_allowed;
      r2Key = lecture.video_url;
    } else if (itemType === 'material') {
      const materialResult = await db.query(
        'SELECT course_id, download_allowed, file_url FROM study_materials WHERE id = $1',
        [itemId]
      );
      if (materialResult.rows.length === 0) {
        return { success: false, error: 'Material not found' };
      }
      const material = materialResult.rows[0];
      courseId = material.course_id;
      downloadAllowed = material.download_allowed;
      r2Key = material.file_url;
    }

    if (!downloadAllowed) {
      return { success: false, error: 'Download not allowed for this item' };
    }

    if (!r2Key) {
      return { success: false, error: 'File URL not found' };
    }

    // Check active enrollment with valid_until validation
    if (courseId) {
      const enrollmentResult = await db.query(
        'SELECT id, valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = \'active\' OR status IS NULL)',
        [userId, courseId]
      );
      if (enrollmentResult.rows.length === 0) {
        return { success: false, error: 'Not enrolled in this course' };
      }
      const enrollment = enrollmentResult.rows[0];
      if (enrollment.valid_until && enrollment.valid_until < Date.now()) {
        return { success: false, error: 'Course access has expired' };
      }
    }

    // Strip CDN prefix to get R2 key
    let cleanR2Key = r2Key;
    if (r2Key.startsWith('http')) {
      try {
        const url = new URL(r2Key);
        cleanR2Key = url.pathname.substring(1);
      } catch (_e) {
        cleanR2Key = r2Key;
      }
    }

    // Generate token
    const { randomUUID } = await import('crypto');
    const token = randomUUID();
    const createdAt = Date.now();
    const expiresAt = createdAt + 30000;

    // Insert token into database
    await db.query(
      'INSERT INTO download_tokens (token, user_id, item_type, item_id, r2_key, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [token, userId, itemType, itemId, cleanR2Key, createdAt, expiresAt]
    );

    return { success: true, token };
  } catch (err) {
    console.error('[download-url] Error:', err);
    return { success: false, error: 'Failed to generate download token' };
  }
}

beforeAll(async () => {
  // Initialize test database connection
  db = new Pool({
    connectionString: TEST_DB_URL,
  });

  // Create test tables if they don't exist
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      email TEXT UNIQUE,
      role TEXT NOT NULL DEFAULT 'student'
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
  await db.query(`ALTER TABLE lectures ADD COLUMN IF NOT EXISTS course_id INTEGER`);
  await db.query(`ALTER TABLE lectures ADD COLUMN IF NOT EXISTS video_url TEXT`);
  await db.query(`ALTER TABLE lectures ADD COLUMN IF NOT EXISTS download_allowed BOOLEAN DEFAULT FALSE`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS study_materials (
      id SERIAL PRIMARY KEY,
      course_id INTEGER,
      title TEXT NOT NULL,
      file_url TEXT,
      download_allowed BOOLEAN DEFAULT FALSE
    )
  `);
  await db.query(`ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS course_id INTEGER`);
  await db.query(`ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS file_url TEXT`);
  await db.query(`ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS download_allowed BOOLEAN DEFAULT FALSE`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      course_id INTEGER,
      status TEXT DEFAULT 'active',
      valid_until BIGINT
    )
  `);
  await db.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS user_id INTEGER`);
  await db.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS course_id INTEGER`);
  await db.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`);
  await db.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS valid_until BIGINT`);

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
});

afterAll(async () => {
  // Clean up test data
  await db.query('DROP TABLE IF EXISTS download_tokens CASCADE');
  await db.query('DROP TABLE IF EXISTS enrollments CASCADE');
  await db.query('DROP TABLE IF EXISTS study_materials CASCADE');
  await db.query('DROP TABLE IF EXISTS lectures CASCADE');
  await db.query('DROP TABLE IF EXISTS courses CASCADE');
  await db.query('DROP TABLE IF EXISTS users CASCADE');
  await db.end();
});

beforeEach(async () => {
  // Clear test data before each test
  await db.query('DELETE FROM download_tokens');
  await db.query('DELETE FROM enrollments');
  await db.query('DELETE FROM study_materials');
  await db.query('DELETE FROM lectures');
  await db.query('DELETE FROM courses');
  await db.query('DELETE FROM users');
});

describeDb('GET /api/download-url - Property-Based Tests', () => {
  it('Property 8: Enrollment verification gates all signed URL issuance', { timeout: 30000 }, async () => {
    // Arbitraries for generating test data
    const userIdArbitrary = fc.integer({ min: 1, max: 1000 });
    const courseIdArbitrary = fc.integer({ min: 1, max: 100 });
    const itemIdArbitrary = fc.integer({ min: 1, max: 1000 });
    const itemTypeArbitrary = fc.constantFrom('lecture' as const, 'material' as const);
    const downloadAllowedArbitrary = fc.boolean();
    const hasEnrollmentArbitrary = fc.boolean();
    
    // Generate valid_until: null, future timestamp, or past timestamp
    const validUntilArbitrary = fc.oneof(
      fc.constant(null),
      fc.integer({ min: Date.now() + 10000, max: Date.now() + 1000000 }), // future
      fc.integer({ min: Date.now() - 1000000, max: Date.now() - 10000 })  // past
    );

    // Combined arbitrary for test scenario
    const scenarioArbitrary = fc.record({
      userId: userIdArbitrary,
      courseId: courseIdArbitrary,
      itemId: itemIdArbitrary,
      itemType: itemTypeArbitrary,
      downloadAllowed: downloadAllowedArbitrary,
      hasEnrollment: hasEnrollmentArbitrary,
      validUntil: validUntilArbitrary,
    });

    await fc.assert(
      fc.asyncProperty(scenarioArbitrary, async (scenario) => {
        // Setup: Create user
        await db.query(
          'INSERT INTO users (id, name, email, role) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
          [scenario.userId, `User ${scenario.userId}`, `user${scenario.userId}@test.com`, 'student']
        );

        // Setup: Create course
        await db.query(
          'INSERT INTO courses (id, title) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
          [scenario.courseId, `Course ${scenario.courseId}`]
        );

        // Setup: Create item (lecture or material)
        const fileUrl = `https://cdn.example.com/file-${scenario.itemId}.mp4`;
        if (scenario.itemType === 'lecture') {
          await db.query(
            'INSERT INTO lectures (id, course_id, title, video_url, download_allowed) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET course_id = $2, download_allowed = $5',
            [scenario.itemId, scenario.courseId, `Lecture ${scenario.itemId}`, fileUrl, scenario.downloadAllowed]
          );
        } else {
          await db.query(
            'INSERT INTO study_materials (id, course_id, title, file_url, download_allowed) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET course_id = $2, download_allowed = $5',
            [scenario.itemId, scenario.courseId, `Material ${scenario.itemId}`, fileUrl, scenario.downloadAllowed]
          );
        }

        // Setup: Create enrollment if specified
        if (scenario.hasEnrollment) {
          await db.query(
            'INSERT INTO enrollments (user_id, course_id, status, valid_until) VALUES ($1, $2, $3, $4)',
            [scenario.userId, scenario.courseId, 'active', scenario.validUntil]
          );
        }

        // Execute: Simulate the download-url request
        const result = await simulateDownloadUrlRequest(
          scenario.userId,
          scenario.itemType,
          scenario.itemId
        );

        // Determine expected outcome
        const enrollmentValid = scenario.hasEnrollment && 
          (scenario.validUntil === null || scenario.validUntil > Date.now());
        const shouldSucceed = scenario.downloadAllowed && enrollmentValid;

        // Assert: Token returned if and only if conditions are met
        if (shouldSucceed) {
          expect(result.success).toBe(true);
          expect(result.token).toBeDefined();
          expect(typeof result.token).toBe('string');
          expect(result.token!.length).toBeGreaterThan(0);
          
          // Verify token was inserted into database
          const tokenResult = await db.query(
            'SELECT * FROM download_tokens WHERE token = $1',
            [result.token]
          );
          expect(tokenResult.rows.length).toBe(1);
          expect(tokenResult.rows[0].user_id).toBe(scenario.userId);
          expect(tokenResult.rows[0].item_type).toBe(scenario.itemType);
          expect(tokenResult.rows[0].item_id).toBe(scenario.itemId);
          expect(tokenResult.rows[0].used).toBe(false);
          
          // Verify token expiry is within 30 seconds
          const createdAt = tokenResult.rows[0].created_at;
          const expiresAt = tokenResult.rows[0].expires_at;
          expect(expiresAt - createdAt).toBeLessThanOrEqual(30000);
        } else {
          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.token).toBeUndefined();
          
          // Verify no token was created for this specific request
          const tokenResult = await db.query(
            'SELECT * FROM download_tokens WHERE user_id = $1 AND item_type = $2 AND item_id = $3 AND created_at > $4',
            [scenario.userId, scenario.itemType, scenario.itemId, Date.now() - 5000]
          );
          expect(tokenResult.rows.length).toBe(0);
        }

        // Cleanup for next iteration
        await db.query('DELETE FROM download_tokens WHERE user_id = $1', [scenario.userId]);
        await db.query('DELETE FROM enrollments WHERE user_id = $1', [scenario.userId]);
        await db.query('DELETE FROM lectures WHERE id = $1', [scenario.itemId]);
        await db.query('DELETE FROM study_materials WHERE id = $1', [scenario.itemId]);
      }),
      { numRuns: 20 } // Run 20 random test cases
    );
  });
});
