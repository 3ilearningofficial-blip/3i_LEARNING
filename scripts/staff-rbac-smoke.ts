#!/usr/bin/env tsx
/**
 * RBAC smoke test against live DB + local API.
 * Requires: DATABASE_URL, server on PORT (default 5000), optional SMOKE_ADMIN_USER_ID
 */
import dotenv from "dotenv";
import pg from "pg";
import express from "express";
import { createServer } from "node:http";

dotenv.config();

const PORT = Number(process.env.SMOKE_PORT || process.env.PORT || 5099);
const BASE = `http://127.0.0.1:${PORT}`;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? undefined : { rejectUnauthorized: false },
});

type Result = { name: string; ok: boolean; detail?: string };

async function q(sql: string, params?: unknown[]) {
  const r = await pool.query(sql, params);
  return r.rows;
}

async function api(method: string, path: string, opts?: { headers?: Record<string, string>; body?: unknown }) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
    body: opts?.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

async function ensureSmokeTeacher(): Promise<{ userId: number; phone: string; sessionToken: string }> {
  const phone = "9998887766";
  const existing = await q(`SELECT id, session_token FROM users WHERE phone = $1 LIMIT 1`, [phone]);
  let userId: number;
  let sessionToken: string;
  if (existing[0]?.id) {
    userId = Number(existing[0].id);
    sessionToken = existing[0].session_token || `smoke-staff-${userId}-${Date.now()}`;
    await pool.query(`UPDATE users SET role = 'teacher', session_token = $1, profile_complete = TRUE WHERE id = $2`, [
      sessionToken,
      userId,
    ]);
  } else {
    sessionToken = `smoke-staff-new-${Date.now()}`;
    const ins = await q(
      `INSERT INTO users (name, phone, role, profile_complete, session_token, created_at, last_active_at)
       VALUES ('Smoke Teacher', $1, 'teacher', TRUE, $2, $3, $3) RETURNING id`,
      [phone, sessionToken, Date.now()],
    );
    userId = Number(ins[0].id);
  }
  await pool.query(
    `INSERT INTO staff_profiles (user_id, employee_id, teacher_id, status, created_at, updated_at)
     VALUES ($1, 'EMP-SMOKE', 'TCH-SMOKE', 'active', $2, $2) ON CONFLICT (user_id) DO NOTHING`,
    [userId, Date.now()],
  );
  return { userId, phone, sessionToken };
}

async function ensureAdminSession(): Promise<string | null> {
  const adminId = process.env.SMOKE_ADMIN_USER_ID ? Number(process.env.SMOKE_ADMIN_USER_ID) : null;
  if (adminId) {
    const rows = await q(`SELECT session_token FROM users WHERE id = $1 AND role = 'admin' LIMIT 1`, [adminId]);
    if (rows[0]?.session_token) return String(rows[0].session_token);
  }
  const rows = await q(`SELECT id, session_token FROM users WHERE role = 'admin' AND session_token IS NOT NULL LIMIT 1`);
  if (rows[0]?.session_token) return String(rows[0].session_token);
  return null;
}

async function main() {
  const results: Result[] = [];

  // Table check
  const tbl = await q(`SELECT to_regclass('public.staff_course_assignments') AS t`);
  results.push({ name: "DB: staff_course_assignments table", ok: !!tbl[0]?.t });

  const health = await fetch(`${BASE}/api/health/ready`).catch(() => null);
  if (!health) {
    console.log("[smoke] API not running on", BASE, "- starting ephemeral test server is skipped.");
    console.log("[smoke] Run: npm run server:dev in another terminal, then re-run this script.");
    results.push({ name: "API reachable", ok: false, detail: "server not running" });
    printResults(results);
    process.exit(1);
  }
  results.push({ name: "API reachable", ok: health.ok || health.status === 200 });

  const { userId, sessionToken } = await ensureSmokeTeacher();
  const staffHeaders = {
    Authorization: `Bearer ${sessionToken}`,
    "x-app-platform": "web",
  };

  const me = await api("GET", "/api/staff/me", { headers: staffHeaders });
  results.push({
    name: "GET /api/staff/me",
    ok: me.status === 200 && me.json?.user?.role === "teacher",
    detail: `status=${me.status}`,
  });

  const dash = await api("GET", "/api/staff/dashboard", { headers: staffHeaders });
  results.push({ name: "GET /api/staff/dashboard", ok: dash.status === 200, detail: `status=${dash.status}` });

  const studentToken = `smoke-student-${Date.now()}`;
  await pool.query(`UPDATE users SET role = 'student', session_token = $1 WHERE id = $2`, [studentToken, userId]);
  const denied = await api("GET", "/api/staff/me", { headers: { Authorization: `Bearer ${studentToken}` } });
  results.push({ name: "Staff API denied for student role", ok: denied.status === 403, detail: `status=${denied.status}` });
  await pool.query(`UPDATE users SET role = 'teacher', session_token = $1 WHERE id = $2`, [sessionToken, userId]);

  const nativeLive = await api("POST", `/api/staff/live-classes/1/stream/create`, {
    headers: { ...staffHeaders, "x-app-platform": "android" },
  });
  results.push({
    name: "Live start blocked on android",
    ok: nativeLive.status === 403 && (nativeLive.json?.code === "live_web_only" || String(nativeLive.json?.message || "").includes("web")),
    detail: `status=${nativeLive.status} code=${nativeLive.json?.code}`,
  });

  const adminToken = await ensureAdminSession();
  if (adminToken) {
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    const list = await api("GET", "/api/admin/staff", { headers: adminHeaders });
    results.push({ name: "GET /api/admin/staff", ok: list.status === 200 && Array.isArray(list.json), detail: `status=${list.status}` });

    const courseRows = await q(`SELECT id FROM courses ORDER BY id ASC LIMIT 1`);
    if (courseRows[0]?.id) {
      const assign = await api("POST", `/api/admin/staff/${userId}/assignments`, {
        headers: adminHeaders,
        body: { courseId: Number(courseRows[0].id), subjectKey: null },
      });
      results.push({ name: "POST admin assign course", ok: assign.status === 201 || assign.status === 200, detail: `status=${assign.status}` });

      const courses = await api("GET", "/api/staff/courses", { headers: staffHeaders });
      results.push({
        name: "GET /api/staff/courses after assign",
        ok: courses.status === 200 && Array.isArray(courses.json) && courses.json.length > 0,
        detail: `count=${Array.isArray(courses.json) ? courses.json.length : 0}`,
      });
    } else {
      results.push({ name: "POST admin assign course", ok: false, detail: "no courses in DB" });
    }
  } else {
    results.push({ name: "GET /api/admin/staff", ok: false, detail: "no admin session in DB" });
  }

  const req = await api("POST", "/api/staff/requests", {
    headers: staffHeaders,
    body: { requestType: "youtube_materials", payload: {} },
  });
  results.push({ name: "POST /api/staff/requests", ok: req.status === 201, detail: `status=${req.status}` });

  printResults(results);
  const failed = results.filter((r) => !r.ok);
  await pool.end();
  process.exit(failed.length ? 1 : 0);
}

function printResults(results: Result[]) {
  console.log("\n=== Staff RBAC Smoke Results ===");
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed\n`);
}

main().catch(async (e) => {
  console.error("[smoke] fatal:", e);
  await pool.end().catch(() => {});
  process.exit(1);
});
