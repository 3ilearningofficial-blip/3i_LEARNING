type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

/** Remove registry rows when admin disables download for a lecture/material. */
export async function purgeUserDownloadsForItem(
  db: DbClient,
  itemType: "lecture" | "material",
  itemId: number
): Promise<void> {
  await db.query("DELETE FROM user_downloads WHERE item_type = $1 AND item_id = $2", [
    itemType,
    itemId,
  ]);
}

export function isEnrollmentAccessRevoked(
  status: unknown,
  validUntil: unknown,
  nowMs: number = Date.now()
): boolean {
  const s = String(status ?? "").toLowerCase();
  if (s === "inactive" || s === "revoked" || s === "cancelled") return true;
  const vu = validUntil != null ? Number(validUntil) : null;
  if (vu != null && Number.isFinite(vu) && vu < nowMs) return true;
  return false;
}
