import { autoNotificationExpiresAt } from "./auto-notification-expiry";
import { sendPushToUsers } from "./push-notifications";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }>;
};

export function testNotificationCopy(
  testType: unknown,
  title: string,
  contextLabel: string
): { notifTitle: string; notifMessage: string } {
  const norm = String(testType || "practice").toLowerCase();
  const notifTitle =
    norm === "mock" ? "📝 New Mock Test Added" : norm === "pyq" ? "📝 New PYQ Added" : "📝 New Test Added";
  const notifMessage = `"${title}" has been added in ${contextLabel}.`;
  return { notifTitle, notifMessage };
}

export async function getAllStudentIds(db: DbClient): Promise<number[]> {
  const result = await db.query("SELECT id FROM users WHERE role = 'student'").catch(() => ({ rows: [] as any[] }));
  return result.rows.map((row: any) => Number(row.id)).filter((id: number) => Number.isFinite(id) && id > 0);
}

export async function getAdminIds(db: DbClient): Promise<number[]> {
  const result = await db.query("SELECT id FROM users WHERE role = 'admin'").catch(() => ({ rows: [] as any[] }));
  return result.rows.map((row: any) => Number(row.id)).filter((id: number) => Number.isFinite(id) && id > 0);
}

export async function getFolderPurchaserIds(db: DbClient, folderId: number): Promise<number[]> {
  const result = await db
    .query("SELECT DISTINCT user_id FROM folder_purchases WHERE folder_id = $1", [folderId])
    .catch(() => ({ rows: [] as any[] }));
  return result.rows.map((row: any) => Number(row.user_id)).filter((id: number) => Number.isFinite(id) && id > 0);
}

/** Mini test series: all students if free, else folder purchasers only. */
export async function getMiniCourseNotificationRecipients(db: DbClient, miniCourseId: number): Promise<number[]> {
  const folder = await db
    .query("SELECT id, is_free, name FROM standalone_folders WHERE id = $1 AND type = 'mini_course' LIMIT 1", [miniCourseId])
    .catch(() => ({ rows: [] as any[] }));
  if (!folder.rows.length) return getAllStudentIds(db);
  if (folder.rows[0].is_free) return getAllStudentIds(db);
  const purchasers = await getFolderPurchaserIds(db, miniCourseId);
  return purchasers.length > 0 ? purchasers : getAllStudentIds(db);
}

export async function notifyUsersInAppAndPush(
  db: DbClient,
  userIds: number[],
  opts: {
    title: string;
    message: string;
    type?: string;
    now?: number;
    expiresAt?: number | null;
    pushData?: Record<string, unknown>;
  }
): Promise<void> {
  const recipientIds = [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!recipientIds.length) return;

  const now = opts.now ?? Date.now();
  const expiresAt = opts.expiresAt === undefined ? autoNotificationExpiresAt(now) : opts.expiresAt;
  await db
    .query(
      `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
       SELECT u, $2::text, $3::text, $4::text, $5::bigint, $6::bigint
       FROM unnest($1::int[]) AS u`,
      [recipientIds, opts.title, opts.message, opts.type ?? "info", now, expiresAt]
    )
    .catch(() => {});

  await sendPushToUsers(db, recipientIds, {
    title: opts.title,
    body: opts.message,
    data: opts.pushData || {},
  }).catch((err) => console.error("[Notify] push failed:", err));
}

/** In-app bell + push for every admin (operational alerts persist until read). */
export async function notifyAdminsInAppAndPush(
  db: DbClient,
  opts: {
    title: string;
    message: string;
    pushData?: Record<string, unknown>;
  }
): Promise<void> {
  const adminIds = await getAdminIds(db);
  if (!adminIds.length) return;
  await notifyUsersInAppAndPush(db, adminIds, { ...opts, expiresAt: null });
}

/** Notify admins once per live class completion (deduped via notifications_sent). */
export async function notifyAdminsLiveClassCompleted(
  db: DbClient,
  liveClass: { id: unknown; title?: unknown; course_id?: unknown }
): Promise<void> {
  const liveClassId = Number(liveClass.id);
  if (!Number.isFinite(liveClassId) || liveClassId <= 0) return;

  const adminIds = await getAdminIds(db);
  if (!adminIds.length) return;

  const newlyNotified: number[] = [];
  const now = Date.now();
  for (const adminId of adminIds) {
    const inserted = await db
      .query(
        `INSERT INTO notifications_sent (class_id, user_id, type, sent_at)
         VALUES ($1::int, $2::int, 'admin_live_completed', $3::bigint)
         ON CONFLICT (class_id, user_id, type) DO NOTHING
         RETURNING user_id`,
        [liveClassId, adminId, now]
      )
      .catch(() => ({ rows: [] as any[] }));
    if (inserted.rows.length > 0) newlyNotified.push(adminId);
  }
  if (!newlyNotified.length) return;

  const title = String(liveClass.title || "Live class").trim();
  await notifyUsersInAppAndPush(db, newlyNotified, {
    title: "✅ Live Class Completed",
    message: `"${title}" has ended.`,
    expiresAt: null,
    pushData: {
      type: "live_class_completed",
      liveClassId,
      courseId: liveClass.course_id != null ? Number(liveClass.course_id) : null,
    },
  });
}

export async function notifyStandaloneTestAdded(
  db: DbClient,
  opts: {
    testId: number;
    title: string;
    testType: unknown;
    miniCourseId?: number | null;
  }
): Promise<void> {
  let contextLabel = "Tests";
  let recipientIds: number[] = [];

  if (opts.miniCourseId) {
    const folder = await db
      .query("SELECT name FROM standalone_folders WHERE id = $1 LIMIT 1", [opts.miniCourseId])
      .catch(() => ({ rows: [] as any[] }));
    contextLabel = String(folder.rows[0]?.name || "Mini Test Series");
    recipientIds = await getMiniCourseNotificationRecipients(db, opts.miniCourseId);
  } else {
    recipientIds = await getAllStudentIds(db);
  }

  const { notifTitle, notifMessage } = testNotificationCopy(opts.testType, opts.title, contextLabel);
  await notifyUsersInAppAndPush(db, recipientIds, {
    title: notifTitle,
    message: notifMessage,
    pushData: {
      type: "new_test_added",
      testId: opts.testId,
      miniCourseId: opts.miniCourseId || null,
    },
  });
}

export async function notifyStandaloneMaterialAdded(
  db: DbClient,
  opts: { materialId: number; title: string; sectionTitle?: string | null }
): Promise<void> {
  const contextLabel = opts.sectionTitle?.trim() || "Study Materials";
  const recipientIds = await getAllStudentIds(db);
  await notifyUsersInAppAndPush(db, recipientIds, {
    title: "📘 New Material Added",
    message: `"${opts.title}" has been added in ${contextLabel}.`,
    pushData: { type: "new_material_added", materialId: opts.materialId },
  });
}

export async function notifyStandaloneMissionAdded(
  db: DbClient,
  opts: { missionId: number; title: string; folderName?: string | null }
): Promise<void> {
  const contextLabel = opts.folderName?.trim() || "Daily Missions";
  const recipientIds = await getAllStudentIds(db);
  await notifyUsersInAppAndPush(db, recipientIds, {
    title: "🎯 New Daily Mission",
    message: `"${opts.title}" has been added to ${contextLabel}.`,
    pushData: { type: "standalone_mission_added", missionId: opts.missionId },
  });
}
