import { autoNotificationExpiresAt } from "./auto-notification-expiry";
import { sendPushToUsers } from "./push-notifications";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }>;
};

export const ADMIN_OPS_SOURCE = "admin_ops";

const captureAttemptLastAt = new Map<number, number>();
const CAPTURE_ATTEMPT_COOLDOWN_MS = 5 * 60 * 1000;

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
    source?: string | null;
    pushData?: Record<string, unknown>;
  }
): Promise<void> {
  const recipientIds = [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!recipientIds.length) return;

  const now = opts.now ?? Date.now();
  const expiresAt = opts.expiresAt === undefined ? autoNotificationExpiresAt(now) : opts.expiresAt;
  const source = opts.source ?? null;
  await db
    .query(
      `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at, source)
       SELECT u, $2::text, $3::text, $4::text, $5::bigint, $6::bigint, $7::text
       FROM unnest($1::int[]) AS u`,
      [recipientIds, opts.title, opts.message, opts.type ?? "info", now, expiresAt, source]
    )
    .catch(() => {});

  await sendPushToUsers(db, recipientIds, {
    title: opts.title,
    body: opts.message,
    data: opts.pushData || {},
  }).catch((err) => console.error("[Notify] push failed:", err));
}

/** In-app bell + push for every admin (operational alerts persist until cleared). */
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

  const now = Date.now();
  await db
    .query(
      `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at, source)
       SELECT u, $2::text, $3::text, 'info', $4::bigint, NULL::bigint, $5::text
       FROM unnest($1::int[]) AS u`,
      [adminIds, opts.title, opts.message, now, ADMIN_OPS_SOURCE]
    )
    .catch((err) => console.error("[AdminNotify] in-app insert failed:", err));

  const pushResult = await sendPushToUsers(db, adminIds, {
    title: opts.title,
    body: opts.message,
    data: opts.pushData || {},
  }).catch((err) => {
    console.error("[AdminNotify] push failed:", err);
    return { sent: 0, tokens: 0, webSent: 0, webSubscriptions: 0 };
  });

  console.log(
    `[AdminNotify] "${opts.title}" — admins=${adminIds.length} expoSent=${pushResult.sent}/${pushResult.tokens} webSent=${pushResult.webSent}/${pushResult.webSubscriptions}`
  );
  if ((pushResult.webSubscriptions ?? 0) === 0) {
    console.warn("[AdminNotify] hint: no active web_push_subscriptions for admin(s); browser push skipped (in-app still delivered)");
  }
}

async function dedupAdminEvent(
  db: DbClient,
  dedupKey: string,
  actorUserId: number
): Promise<boolean> {
  const inserted = await db
    .query(
      `INSERT INTO notifications_sent (class_id, user_id, type, sent_at)
       VALUES (0, $1, $2, $3)
       ON CONFLICT (class_id, user_id, type) DO NOTHING
       RETURNING user_id`,
      [actorUserId, dedupKey, Date.now()]
    )
    .catch(() => ({ rows: [] as any[] }));
  return inserted.rows.length > 0;
}

export async function notifyAdminsNewDeviceLogin(
  db: DbClient,
  opts: { userId: number; userName: string; deviceId: string; platform?: string }
): Promise<void> {
  const name = opts.userName.trim() || `Student #${opts.userId}`;
  const platform = opts.platform?.trim() || "unknown";
  await notifyAdminsInAppAndPush(db, {
    title: "🔑 Student Login (New Device)",
    message: `${name} signed in from a new device (${platform}).`,
    pushData: { type: "student_login_new_device", userId: opts.userId },
  });
}

export async function notifyAdminsPurchase(
  db: DbClient,
  opts: {
    kind: "course" | "book" | "folder" | "test";
    buyerName: string;
    itemTitle: string;
    userId: number;
    itemId: number;
  }
): Promise<void> {
  const buyer = opts.buyerName.trim() || `Student #${opts.userId}`;
  const item = opts.itemTitle.trim() || "an item";
  const kindLabel =
    opts.kind === "course"
      ? "Course"
      : opts.kind === "book"
        ? "Book"
        : opts.kind === "folder"
          ? "Test Series Folder"
          : "Test";
  await notifyAdminsInAppAndPush(db, {
    title: `💰 New ${kindLabel} Purchase`,
    message: `${buyer} purchased ${item}.`,
    pushData: { type: "new_purchase", purchaseKind: opts.kind, userId: opts.userId, itemId: opts.itemId },
  });
}

export async function notifyAdminsBuyNowTap(
  db: DbClient,
  opts: {
    kind: "course" | "book" | "folder" | "test";
    buyerName: string;
    itemTitle: string;
    userId: number;
    itemId: number;
  }
): Promise<void> {
  const dedupKey = `admin_buy_now_${opts.kind}_${opts.itemId}`;
  const isNew = await dedupAdminEvent(db, dedupKey, opts.userId);
  if (!isNew) return;

  const buyer = opts.buyerName.trim() || `Student #${opts.userId}`;
  const item = opts.itemTitle.trim() || "an item";
  await notifyAdminsInAppAndPush(db, {
    title: "🛒 Buy Now — Not Purchased",
    message: `${buyer} tapped Buy Now for ${item} but did not complete payment.`,
    pushData: { type: "buy_now_abandoned", purchaseKind: opts.kind, userId: opts.userId, itemId: opts.itemId },
  });
}

export async function notifyAdminsAppInstall(
  db: DbClient,
  opts: { userId: number; userName: string; platform: string; isPwa?: boolean }
): Promise<void> {
  const dedupKey = `admin_app_install_${opts.platform}_${opts.isPwa ? "pwa" : "native"}`;
  const isNew = await dedupAdminEvent(db, dedupKey, opts.userId);
  if (!isNew) return;

  const name = opts.userName.trim() || `Student #${opts.userId}`;
  const label = opts.isPwa ? "web app (home screen)" : "mobile app";
  await notifyAdminsInAppAndPush(db, {
    title: "📲 New App Install",
    message: `${name} added the ${label} on ${opts.platform}.`,
    pushData: { type: "app_install", userId: opts.userId, platform: opts.platform, isPwa: !!opts.isPwa },
  });
}

export async function notifyAdminsCaptureAttempt(
  db: DbClient,
  opts: { userId: number; userName: string; context: string; kind: "screenshot" | "recording" }
): Promise<void> {
  const now = Date.now();
  const last = captureAttemptLastAt.get(opts.userId) || 0;
  if (now - last < CAPTURE_ATTEMPT_COOLDOWN_MS) return;
  captureAttemptLastAt.set(opts.userId, now);

  const name = opts.userName.trim() || `Student #${opts.userId}`;
  const action = opts.kind === "recording" ? "screen recording" : "screenshot";
  const ctx = opts.context.trim() || "protected content";
  await notifyAdminsInAppAndPush(db, {
    title: `⚠️ ${opts.kind === "recording" ? "Screen Recording" : "Screenshot"} Attempt`,
    message: `${name} may have tried ${action} during ${ctx}.`,
    pushData: { type: "capture_attempt", userId: opts.userId, kind: opts.kind },
  });
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
  await notifyAdminsInAppAndPush(db, {
    title: "✅ Live Class Completed",
    message: `"${title}" has ended.`,
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

/** Call after student login when device/installation id changed from the stored value. */
export async function maybeNotifyAdminsStudentNewDeviceLogin(
  db: DbClient,
  opts: {
    userId: number;
    role: string;
    userName: string;
    deviceId: string | null | undefined;
    platform?: string;
  }
): Promise<void> {
  if (opts.role !== "student") return;
  const deviceId = String(opts.deviceId || "").trim();
  if (!deviceId) return;

  const prev = await db.query("SELECT device_id FROM users WHERE id = $1", [opts.userId]).catch(() => ({ rows: [] as any[] }));
  const prevDevice = String(prev.rows[0]?.device_id || "").trim();
  if (!prevDevice || prevDevice === deviceId) return;

  await notifyAdminsNewDeviceLogin(db, {
    userId: opts.userId,
    userName: opts.userName,
    deviceId,
    platform: opts.platform,
  }).catch((err) => console.error("[Auth] admin new-device login notify failed:", err));
}
