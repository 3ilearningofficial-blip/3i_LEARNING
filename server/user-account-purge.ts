/**
 * Hard-delete all app data tied to a user (student self-delete + admin delete user).
 * Order: child rows first, then users.
 */
export type DbExec = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

export async function purgeStudentAccountById(db: DbExec, userId: number): Promise<void> {
  const id = userId;
  const safeDeleteByUser = async (tableName: string) => {
    try {
      await db.query(`DELETE FROM ${tableName} WHERE user_id = $1`, [id]);
    } catch (err: any) {
      // Keep user deletion working across partially migrated/stale schemas on prod.
      const code = String(err?.code || "");
      if (code === "42P01" || code === "42703") return; // undefined_table / undefined_column
      throw err;
    }
  };

  // Production can have schema drift across instances; discover all user_id tables dynamically.
  // This avoids transaction aborts when a newly added relation is forgotten in the static list.
  try {
    const discovered = await db.query(
      `SELECT DISTINCT table_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name = 'user_id'
         AND table_name <> 'users'`
    );
    for (const row of discovered.rows as Array<{ table_name?: string }>) {
      const tableName = String(row.table_name || "");
      if (!/^[a-z_][a-z0-9_]*$/.test(tableName)) continue;
      await safeDeleteByUser(tableName);
    }
  } catch {
    // Fall back to known core tables if metadata query fails.
  }

  // Keep explicit deletions for safety/fallback and predictable cleanup ordering.
  await safeDeleteByUser("user_push_tokens");
  await safeDeleteByUser("user_sessions");
  await safeDeleteByUser("lecture_progress");
  await safeDeleteByUser("live_class_recording_progress");
  await safeDeleteByUser("live_chat_messages");
  await safeDeleteByUser("live_class_hand_raises");
  await safeDeleteByUser("live_class_viewers");
  await safeDeleteByUser("device_block_events");
  await safeDeleteByUser("user_missions");
  await safeDeleteByUser("doubts");
  await safeDeleteByUser("media_tokens");
  await safeDeleteByUser("download_tokens");
  await safeDeleteByUser("test_attempts");
  await safeDeleteByUser("test_purchases");
  await safeDeleteByUser("question_reports");
  await safeDeleteByUser("enrollments");
  await safeDeleteByUser("notifications");
  await safeDeleteByUser("payments");
  await safeDeleteByUser("book_purchases");
  await safeDeleteByUser("book_click_tracking");
  await safeDeleteByUser("folder_purchases");
  await safeDeleteByUser("support_messages");
  await safeDeleteByUser("user_downloads");
  await safeDeleteByUser("mission_attempts");

  await db.query("DELETE FROM users WHERE id = $1", [id]);
}
