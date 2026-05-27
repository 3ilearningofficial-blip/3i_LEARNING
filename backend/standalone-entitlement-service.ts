type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export async function hasActiveStandaloneEntitlement(
  db: DbClient,
  userId: number,
  materialId: number
): Promise<boolean> {
  const now = Date.now();
  const ent = await db.query(
    `SELECT id
     FROM standalone_material_entitlements
     WHERE user_id = $1
       AND material_id = $2
       AND is_active = TRUE
       AND (expires_at IS NULL OR expires_at > $3)
     LIMIT 1`,
    [userId, materialId, now]
  );
  return ent.rows.length > 0;
}
