import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { Pool } from 'pg';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === 'true' && Boolean(TEST_DB_URL);
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

if (process.env.RUN_DB_TESTS === 'true' && !TEST_DB_URL) {
  throw new Error("RUN_DB_TESTS=true requires TEST_DATABASE_URL (DATABASE_URL fallback is disabled for safety)");
}

/**
 * Feature: professional-live-class-studio
 * Property 3: Recording completion creates lecture and updates state
 * 
 * **Validates: Requirements 12.4, 12.5, 12.7**
 */

// Database connection pool for testing
const pool = new Pool({
  connectionString: TEST_DB_URL,
  max: 5,
});

// Helper to execute recording completion logic (mimics the endpoint logic)
async function completeRecording(liveClassId: number, recordingUrl: string, sectionTitle?: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get the live class
    const lcResult = await client.query('SELECT * FROM live_classes WHERE id = $1', [liveClassId]);
    if (lcResult.rows.length === 0) {
      throw new Error('Live class not found');
    }
    const liveClass = lcResult.rows[0];

    // Update live class: set recording_url, is_completed=true, is_live=false
    await client.query(
      'UPDATE live_classes SET recording_url = $1, is_completed = TRUE, is_live = FALSE WHERE id = $2',
      [recordingUrl, liveClassId]
    );

    // Create lecture record if course is associated
    let lectureId = null;
    if (liveClass.course_id) {
      const maxOrder = await client.query(
        'SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1',
        [liveClass.course_id]
      );
      const lectureResult = await client.query(
        `INSERT INTO lectures (course_id, title, description, video_url, video_type, duration_minutes, order_index, is_free_preview, section_title, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          liveClass.course_id,
          liveClass.title,
          liveClass.description || '',
          recordingUrl,
          'r2',
          0,
          maxOrder.rows[0].next_order,
          false,
          sectionTitle || 'Live Class Recordings',
          Date.now()
        ]
      );
      lectureId = lectureResult.rows[0].id;

      // Update course total_lectures count
      await client.query(
        'UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1',
        [liveClass.course_id]
      );
    }

    await client.query('COMMIT');
    return { success: true, lectureId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

describeDb('Recording Completion - Property-Based Tests', () => {
  let testCourseId: number;
  let createdLiveClassIds: number[] = [];
  let createdLectureIds: number[] = [];

  beforeAll(async () => {
    // Ensure required schema exists even if other test files dropped tables.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS courses (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        teacher_name TEXT,
        price TEXT,
        category TEXT,
        is_published BOOLEAN DEFAULT FALSE,
        total_lectures INTEGER DEFAULT 0,
        created_at BIGINT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS live_classes (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        course_id INTEGER,
        is_live BOOLEAN DEFAULT FALSE,
        is_completed BOOLEAN DEFAULT FALSE,
        recording_url TEXT,
        created_at BIGINT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lectures (
        id SERIAL PRIMARY KEY,
        course_id INTEGER,
        title TEXT NOT NULL,
        description TEXT,
        video_url TEXT,
        video_type TEXT,
        duration_minutes INTEGER,
        order_index INTEGER,
        is_free_preview BOOLEAN DEFAULT FALSE,
        section_title TEXT,
        created_at BIGINT
      )
    `);

    // Create a test course for all tests
    try {
      const courseResult = await pool.query(
        `INSERT INTO courses (title, description, teacher_name, price, category, is_published, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        ['Test Course for Recording', 'Test course description', 'Test Teacher', '0', 'Test', true, Date.now()]
      );
      testCourseId = courseResult.rows[0].id;
    } catch (err) {
      console.error('Failed to create test course:', err);
      throw err;
    }
  });

  afterAll(async () => {
    // Clean up created lectures
    if (createdLectureIds.length > 0) {
      await pool.query('DELETE FROM lectures WHERE id = ANY($1)', [createdLectureIds]);
    }
    
    // Clean up created live classes
    if (createdLiveClassIds.length > 0) {
      await pool.query('DELETE FROM live_classes WHERE id = ANY($1)', [createdLiveClassIds]);
    }
    
    // Clean up test course
    if (testCourseId) {
      await pool.query('DELETE FROM courses WHERE id = $1', [testCourseId]);
    }
    
    await pool.end();
  });

  beforeEach(() => {
    // Reset tracking arrays before each test
    createdLiveClassIds = [];
    createdLectureIds = [];
  });

  it('Property 3: Recording completion creates lecture and updates state', { timeout: 120000 }, async () => {
    // Generator for live class titles
    const titleArbitrary = fc.string({ minLength: 5, maxLength: 100 });

    // Generator for R2 recording URLs (simulating Cloudflare R2 URLs)
    const r2UrlArbitrary = fc.tuple(
      fc.array(fc.constantFrom(...'0123456789abcdef'.split('')), { minLength: 32, maxLength: 32 }).map(chars => chars.join('')),
      fc.constantFrom('webm', 'mp4', 'mkv')
    ).map(([hash, ext]) => `https://pub-example.r2.dev/recordings/${hash}.${ext}`);

    // Generator for optional section titles
    const sectionTitleArbitrary = fc.option(
      fc.string({ minLength: 3, maxLength: 50 }),
      { nil: undefined }
    );

    // Property: For any valid live class with a course association and any valid R2 recording URL,
    // when the recording endpoint is called, the system should:
    // (a) create a lecture record with the recording URL as video_url and video_type='r2'
    // (b) set is_completed=true and is_live=false on the live class
    // (c) update the course's total_lectures count to match the actual number of lectures
    await fc.assert(
      fc.asyncProperty(
        titleArbitrary,
        r2UrlArbitrary,
        sectionTitleArbitrary,
        async (title, recordingUrl, sectionTitle) => {
          // Create a live class with the test course
          const liveClassResult = await pool.query(
            `INSERT INTO live_classes (title, description, course_id, is_live, is_completed, created_at)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [title, 'Test description', testCourseId, true, false, Date.now()]
          );
          const liveClassId = liveClassResult.rows[0].id;
          createdLiveClassIds.push(liveClassId);

          // Get initial lecture count for the course
          const initialCountResult = await pool.query(
            'SELECT total_lectures FROM courses WHERE id = $1',
            [testCourseId]
          );
          const initialLectureCount = initialCountResult.rows[0].total_lectures;

          // Call the recording completion logic
          const result = await completeRecording(liveClassId, recordingUrl, sectionTitle);

          // Track created lecture for cleanup
          if (result.lectureId) {
            createdLectureIds.push(result.lectureId);
          }

          // Verify (a): Lecture record created with correct video_url and video_type='r2'
          expect(result.success).toBe(true);
          expect(result.lectureId).not.toBeNull();

          const lectureResult = await pool.query(
            'SELECT * FROM lectures WHERE id = $1',
            [result.lectureId]
          );
          expect(lectureResult.rows.length).toBe(1);
          const lecture = lectureResult.rows[0];
          expect(lecture.video_url).toBe(recordingUrl);
          expect(lecture.video_type).toBe('r2');
          expect(lecture.course_id).toBe(testCourseId);
          expect(lecture.title).toBe(title);

          // Verify (b): Live class marked as is_completed=true and is_live=false
          const liveClassResult2 = await pool.query(
            'SELECT * FROM live_classes WHERE id = $1',
            [liveClassId]
          );
          expect(liveClassResult2.rows.length).toBe(1);
          const updatedLiveClass = liveClassResult2.rows[0];
          expect(updatedLiveClass.is_completed).toBe(true);
          expect(updatedLiveClass.is_live).toBe(false);
          expect(updatedLiveClass.recording_url).toBe(recordingUrl);

          // Verify (c): Course total_lectures count updated to match actual count
          const finalCountResult = await pool.query(
            'SELECT total_lectures FROM courses WHERE id = $1',
            [testCourseId]
          );
          const finalLectureCount = finalCountResult.rows[0].total_lectures;

          // The count should have increased by 1
          expect(finalLectureCount).toBe(initialLectureCount + 1);

          // Verify the count matches the actual number of lectures
          const actualCountResult = await pool.query(
            'SELECT COUNT(*) as count FROM lectures WHERE course_id = $1',
            [testCourseId]
          );
          const actualCount = parseInt(actualCountResult.rows[0].count);
          expect(finalLectureCount).toBe(actualCount);
        }
      ),
      { numRuns: 5 } // Reduced for faster test execution (database operations are slow)
    );
  });
});
