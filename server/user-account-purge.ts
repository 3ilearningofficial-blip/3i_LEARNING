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
      if (String(err?.code || "") === "42P01") return; // undefined_table
      throw err;
    }
  };

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
