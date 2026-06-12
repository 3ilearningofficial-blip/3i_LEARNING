import webpush from "web-push";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }>;
};

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function configureWebPush(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:support@3ilearning.com";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

export async function registerPushToken(db: DbClient, userId: number, token: string, platform: string): Promise<void> {
  const now = Date.now();
  await db.query(
    `INSERT INTO user_push_tokens (user_id, expo_push_token, platform, is_active, created_at, last_seen_at)
     VALUES ($1, $2, $3, TRUE, $4, $4)
     ON CONFLICT (expo_push_token)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       platform = EXCLUDED.platform,
       is_active = TRUE,
       last_seen_at = EXCLUDED.last_seen_at`,
    [userId, token, platform || "unknown", now]
  );
}

export async function unregisterPushToken(db: DbClient, userId: number, token: string): Promise<void> {
  await db.query(
    "UPDATE user_push_tokens SET is_active = FALSE, last_seen_at = $1 WHERE user_id = $2 AND expo_push_token = $3",
    [Date.now(), userId, token]
  );
}

export async function unregisterAllPushTokens(db: DbClient, userId: number): Promise<void> {
  await db.query("UPDATE user_push_tokens SET is_active = FALSE, last_seen_at = $1 WHERE user_id = $2", [
    Date.now(),
    userId,
  ]);
}

export async function registerWebPushSubscription(
  db: DbClient,
  userId: number,
  subscription: { endpoint?: string; keys?: { p256dh?: string; auth?: string } },
  userAgent?: string
): Promise<void> {
  const endpoint = String(subscription?.endpoint || "").trim();
  const p256dh = String(subscription?.keys?.p256dh || "").trim();
  const auth = String(subscription?.keys?.auth || "").trim();
  if (!endpoint || !p256dh || !auth) throw new Error("Invalid web push subscription");
  const now = Date.now();
  await db.query(
    `INSERT INTO web_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, is_active, created_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, TRUE, $6, $6)
     ON CONFLICT (endpoint)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent,
       is_active = TRUE,
       last_seen_at = EXCLUDED.last_seen_at`,
    [userId, endpoint, p256dh, auth, userAgent || null, now]
  );
}

export async function unregisterWebPushSubscription(db: DbClient, userId: number, endpoint: string): Promise<void> {
  await db.query(
    "UPDATE web_push_subscriptions SET is_active = FALSE, last_seen_at = $1 WHERE user_id = $2 AND endpoint = $3",
    [Date.now(), userId, endpoint]
  );
}

async function sendWebPushToUsers(db: DbClient, userIds: number[], payload: PushPayload): Promise<{ sent: number; subscriptions: number }> {
  if (!configureWebPush()) return { sent: 0, subscriptions: 0 };
  const uniqueUserIds = [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!uniqueUserIds.length) return { sent: 0, subscriptions: 0 };

  const result = await db.query(
    "SELECT id, endpoint, p256dh, auth FROM web_push_subscriptions WHERE is_active = TRUE AND user_id = ANY($1::int[])",
    [uniqueUserIds]
  );
  let sent = 0;
  const inactiveIds: number[] = [];
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    data: payload.data || {},
  });
  for (const row of result.rows) {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        body
      );
      sent += 1;
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) inactiveIds.push(Number(row.id));
      else console.error("[WebPush] send failed:", err?.statusCode || err?.message || err);
    }
  }
  if (inactiveIds.length > 0) {
    await db.query("UPDATE web_push_subscriptions SET is_active = FALSE, last_seen_at = $1 WHERE id = ANY($2::int[])", [
      Date.now(),
      inactiveIds,
    ]).catch(() => {});
  }
  return { sent, subscriptions: result.rows.length };
}

export async function sendPushToUsers(
  db: DbClient,
  userIds: number[],
  payload: PushPayload
): Promise<{ sent: number; tokens: number; webSent?: number; webSubscriptions?: number }> {
  const uniqueUserIds = [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!uniqueUserIds.length) return { sent: 0, tokens: 0, webSent: 0, webSubscriptions: 0 };
  const webResultPromise = sendWebPushToUsers(db, uniqueUserIds, payload).catch(() => ({ sent: 0, subscriptions: 0 }));

  const tokenResult = await db.query(
    "SELECT expo_push_token FROM user_push_tokens WHERE is_active = TRUE AND user_id = ANY($1::int[])",
    [uniqueUserIds]
  );
  const tokens = [...new Set(tokenResult.rows.map((r: any) => String(r.expo_push_token || "").trim()).filter(Boolean))];
  if (!tokens.length) {
    const webResult = await webResultPromise;
    return { sent: 0, tokens: 0, webSent: webResult.sent, webSubscriptions: webResult.subscriptions };
  }

  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: payload.data || {},
    priority: "high",
  }));

  const chunks = chunkArray(messages, 100);
  let sent = 0;
  const invalidTokens: string[] = [];

  for (const chunk of chunks) {
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });
      const json = await res.json().catch(() => null);
      const results = Array.isArray(json?.data) ? json.data : [];
      sent += results.filter((r: any) => r?.status === "ok").length;
      results.forEach((r: any, idx: number) => {
        if (r?.status === "error" && r?.details?.error === "DeviceNotRegistered" && chunk[idx]?.to) {
          invalidTokens.push(chunk[idx].to);
        }
      });
    } catch (err) {
      console.error("[Push] send chunk failed:", err);
    }
  }

  if (invalidTokens.length > 0) {
    await db
      .query("UPDATE user_push_tokens SET is_active = FALSE, last_seen_at = $1 WHERE expo_push_token = ANY($2::text[])", [
        Date.now(),
        [...new Set(invalidTokens)],
      ])
      .catch(() => {});
  }

  const webResult = await webResultPromise;
  return { sent, tokens: tokens.length, webSent: webResult.sent, webSubscriptions: webResult.subscriptions };
}

export async function sendPushToAdmins(db: DbClient, payload: PushPayload): Promise<{ sent: number; tokens: number; webSent?: number; webSubscriptions?: number }> {
  const result = await db.query("SELECT id FROM users WHERE role = 'admin'");
  const adminIds = result.rows.map((row: any) => Number(row.id)).filter((id: number) => Number.isFinite(id));
  return sendPushToUsers(db, adminIds, payload);
}

