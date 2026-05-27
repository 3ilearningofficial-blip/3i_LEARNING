import crypto from "node:crypto";
import type { Request } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

function stableJson(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
}

export function requestHash(req: Request): string {
  const body = stableJson(req.body ?? {});
  return crypto.createHash("sha256").update(body).digest("hex");
}

export function getIdempotencyKey(req: Request): string | null {
  const raw = String(req.get("idempotency-key") || req.get("x-idempotency-key") || "").trim();
  if (!raw) return null;
  if (raw.length > 128) return raw.slice(0, 128);
  return raw;
}

export async function getCachedIdempotentResponse(
  db: DbClient,
  userId: number,
  scope: string,
  idempotencyKey: string,
  reqHash: string
): Promise<{ statusCode: number; responseJson: any } | null> {
  const result = await db.query(
    `SELECT status_code, response_json, request_hash
     FROM api_idempotency_keys
     WHERE user_id = $1 AND scope = $2 AND idempotency_key = $3
     ORDER BY id DESC
     LIMIT 1`,
    [userId, scope, idempotencyKey]
  );
  if (!result.rows.length) return null;
  const row = result.rows[0];
  if (String(row.request_hash) !== reqHash) {
    throw new Error("Idempotency key reuse with different payload");
  }
  return {
    statusCode: Number(row.status_code) || 200,
    responseJson: row.response_json ?? {},
  };
}

export async function saveIdempotentResponse(
  db: DbClient,
  userId: number,
  scope: string,
  idempotencyKey: string,
  reqHash: string,
  statusCode: number,
  responseJson: any
): Promise<void> {
  await db.query(
    `INSERT INTO api_idempotency_keys
       (user_id, scope, idempotency_key, request_hash, response_json, status_code, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     ON CONFLICT (user_id, scope, idempotency_key)
     DO UPDATE SET
       request_hash = EXCLUDED.request_hash,
       response_json = EXCLUDED.response_json,
       status_code = EXCLUDED.status_code,
       created_at = EXCLUDED.created_at`,
    [userId, scope, idempotencyKey, reqHash, JSON.stringify(responseJson ?? {}), statusCode, Date.now()]
  );
}
