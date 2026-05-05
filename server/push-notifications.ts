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

export async function sendPushToUsers(
  db: DbClient,
  userIds: number[],
  payload: PushPayload
): Promise<{ sent: number; tokens: number }> {
  const uniqueUserIds = [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!uniqueUserIds.length) return { sent: 0, tokens: 0 };

  const tokenResult = await db.query(
    "SELECT expo_push_token FROM user_push_tokens WHERE is_active = TRUE AND user_id = ANY($1::int[])",
    [uniqueUserIds]
  );
  const tokens = [...new Set(tokenResult.rows.map((r: any) => String(r.expo_push_token || "").trim()).filter(Boolean))];
  if (!tokens.length) return { sent: 0, tokens: 0 };

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

  return { sent, tokens: tokens.length };
}

