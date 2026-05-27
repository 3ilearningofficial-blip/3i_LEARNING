import type { AppRedisClient } from "./redis-client";

const NOTIF_DEDUP_TTL_SEC = 24 * 60 * 60;

function dedupKey(classId: number, userId: number, type: string): string {
  return `notif:sent:${classId}:${userId}:${type}`;
}

/**
 * Returns user IDs that were not notified yet for this class+type (SET NX per user).
 * Processes in batches to avoid huge pipelines.
 */
export async function filterNewNotificationRecipientsRedis(
  redis: AppRedisClient,
  classId: number,
  userIds: number[],
  type: string,
  batchSize = 500
): Promise<number[]> {
  const accepted: number[] = [];

  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);
    const multi = redis.multi();
    for (const userId of batch) {
      multi.set(dedupKey(classId, userId, type), "1", { NX: true, EX: NOTIF_DEDUP_TTL_SEC });
    }
    const replies = await multi.exec();
    batch.forEach((userId, idx) => {
      const reply = replies?.[idx];
      // SET NX returns null when the key already exists; any non-null reply means we claimed the slot.
      if (reply != null) accepted.push(userId);
    });
  }

  return accepted;
}
