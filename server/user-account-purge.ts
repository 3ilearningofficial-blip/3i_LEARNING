/**
 * Hard-delete all app data tied to a user (student self-delete + admin delete user).
 * Order: child rows first, then users.
 */
export type DbExec = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

export async function purgeStudentAccountById(db: DbExec, userId: number): Promise<void> {
  const id = userId;
  const q = (sql: string) => db.query(sql, [id]);
  await q("DELETE FROM user_sessions WHERE user_id = $1");
  await q("DELETE FROM lecture_progress WHERE user_id = $1");
  await q("DELETE FROM live_class_recording_progress WHERE user_id = $1");
  await q("DELETE FROM live_chat_messages WHERE user_id = $1");
  await q("DELETE FROM live_class_hand_raises WHERE user_id = $1");
  await q("DELETE FROM live_class_viewers WHERE user_id = $1");
  await q("DELETE FROM device_block_events WHERE user_id = $1");
  await q("DELETE FROM user_missions WHERE user_id = $1");
  await q("DELETE FROM doubts WHERE user_id = $1");
  await q("DELETE FROM media_tokens WHERE user_id = $1");
  await q("DELETE FROM download_tokens WHERE user_id = $1");
  await q("DELETE FROM test_attempts WHERE user_id = $1");
  await q("DELETE FROM enrollments WHERE user_id = $1");
  await q("DELETE FROM notifications WHERE user_id = $1");
  await q("DELETE FROM payments WHERE user_id = $1");
  await q("DELETE FROM book_purchases WHERE user_id = $1");
  await q("DELETE FROM book_click_tracking WHERE user_id = $1");
  await q("DELETE FROM folder_purchases WHERE user_id = $1");
  await q("DELETE FROM support_messages WHERE user_id = $1");
  await q("DELETE FROM user_downloads WHERE user_id = $1");
  await q("DELETE FROM mission_attempts WHERE user_id = $1");
  await db.query("DELETE FROM users WHERE id = $1", [id]);
}
