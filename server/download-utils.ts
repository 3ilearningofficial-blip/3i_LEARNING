/**
 * download-utils.ts
 * Offline download cleanup utilities.
 * Extracted from server/routes.ts (Phase 2 refactor — T-08).
 *
 * These functions delete rows from the user_downloads table when:
 * - A student's enrollment is revoked or expires
 * - A course is deleted or its content is removed
 *
 * They accept a db client as a parameter so they can be used
 * by any route file without importing from routes.ts.
 */

type DbClient = {
  query: (text: string, params?: unknown[], options?: any) => Promise<{ rows: any[]; rowCount?: number }>;
};

/**
 * Delete all offline downloads for a user, optionally filtered to a specific course.
 * Called when a student's enrollment is revoked or their account is deleted.
 *
 * @param db        The main database client
 * @param userId    The student's user ID
 * @param courseId  Optional: if provided, only deletes downloads for that course
 */
export async function deleteDownloadsForUser(
  db: DbClient,
  userId: number,
  courseId?: number
): Promise<void> {
  try {
    if (courseId) {
      // Delete downloads for a specific course only
      await db.query(
        `DELETE FROM user_downloads
         WHERE user_id = $1
         AND (
           (item_type = 'lecture' AND item_id IN (SELECT id FROM lectures WHERE course_id = $2))
           OR
           (item_type = 'material' AND item_id IN (SELECT id FROM study_materials WHERE course_id = $2))
         )`,
        [userId, courseId]
      );
      console.log(`[Cleanup] Deleted downloads for user ${userId} in course ${courseId}`);
    } else {
      // Delete all downloads for this user across all courses
      await db.query("DELETE FROM user_downloads WHERE user_id = $1", [userId]);
      console.log(`[Cleanup] Deleted all downloads for user ${userId}`);
    }
  } catch (err) {
    console.error("[Cleanup] Failed to delete downloads:", err);
  }
}

/**
 * Delete all offline downloads for a course across all users.
 * Called when a course is deleted or its content is being cleaned up.
 *
 * @param db        The main database client
 * @param courseId  The course ID whose downloads should be removed
 */
export async function deleteDownloadsForCourse(
  db: DbClient,
  courseId: number
): Promise<void> {
  try {
    await db.query(
      `DELETE FROM user_downloads
       WHERE (item_type = 'lecture' AND item_id IN (SELECT id FROM lectures WHERE course_id = $1))
       OR (item_type = 'material' AND item_id IN (SELECT id FROM study_materials WHERE course_id = $1))`,
      [courseId]
    );
    console.log(`[Cleanup] Deleted all downloads for course ${courseId}`);
  } catch (err) {
    console.error("[Cleanup] Failed to delete course downloads:", err);
  }
}
