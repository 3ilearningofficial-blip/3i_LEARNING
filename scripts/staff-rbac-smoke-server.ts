#!/usr/bin/env tsx
/** Minimal API for staff RBAC smoke tests (avoids full server startup). */
import dotenv from "dotenv";
import express from "express";
import pg from "pg";
import { createRequireAdmin } from "../backend/require-admin";
import { createRequireStaff } from "../backend/require-staff";
import { registerAdminStaffRoutes } from "../backend/admin-staff-routes";
import { registerStaffRoutes } from "../backend/staff-routes";

dotenv.config();

const PORT = Number(process.env.SMOKE_PORT || 5099);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? undefined : { rejectUnauthorized: false },
});

const db = {
  query: async (text: string, params?: unknown[]) => {
    const result = await pool.query(text, params);
    return { rows: result.rows, rowCount: result.rowCount ?? undefined };
  },
};

async function getAuthUser(req: express.Request) {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const r = await db.query(`SELECT id, role FROM users WHERE session_token = $1 LIMIT 1`, [token]);
  if (!r.rows[0]) return null;
  return { id: Number(r.rows[0].id), role: String(r.rows[0].role) };
}

const app = express();
app.use(express.json());
app.get("/api/health/ready", (_req, res) => res.json({ ok: true }));

const requireAdmin = createRequireAdmin(getAuthUser);
const requireStaff = createRequireStaff(getAuthUser);

registerAdminStaffRoutes({ app, db, requireAdmin });
registerStaffRoutes({ app, db, requireStaff });

app.listen(PORT, () => {
  console.log(`[staff-smoke-server] http://127.0.0.1:${PORT}`);
});
