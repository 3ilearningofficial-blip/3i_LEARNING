import type { Express, Request, Response } from "express";
import { STAFF_PERMISSION_KEYS } from "./staff-permissions";
import {
  getEffectivePermissions,
  getPermissionOverrides,
  getStaffAssignments,
  logStaffActivity,
  type DbClient,
} from "./staff-access-utils";
import { ensureStaffProfile, loadStaffProfileBundle, serializeStaffListRow } from "./staff-profile-utils";
import { syncTeacherToCourseAbout, parseAadharOcrPlaceholder } from "./staff-course-about-sync";

type RegisterAdminStaffRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  runInTransaction?: <T>(fn: (tx: DbClient) => Promise<T>) => Promise<T>;
};

const STAFF_ROLES_LIST = ["teacher", "manager"];

function parseUserId(raw: unknown): number | null {
  const id = parseInt(String(raw), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function adminUserId(req: Request): number | null {
  const u = (req as Request & { user?: { id: number } }).user;
  return u?.id ?? null;
}

export function registerAdminStaffRoutes({
  app,
  db,
  requireAdmin,
  runInTransaction,
}: RegisterAdminStaffRoutesDeps): void {
  app.get("/api/admin/staff", requireAdmin, async (req: Request, res: Response) => {
    try {
      const search = String(req.query.search ?? "").trim();
      const roleFilter = String(req.query.role ?? "").trim().toLowerCase();
      const params: unknown[] = [];
      let where = `WHERE LOWER(COALESCE(u.role, '')) IN ('teacher', 'manager')`;
      if (roleFilter && STAFF_ROLES_LIST.includes(roleFilter)) {
        params.push(roleFilter);
        where += ` AND LOWER(u.role) = $${params.length}`;
      }
      if (search) {
        params.push(`%${search}%`);
        const p = `$${params.length}`;
        where += ` AND (COALESCE(u.name,'') ILIKE ${p} OR COALESCE(u.phone,'') ILIKE ${p} OR COALESCE(u.email,'') ILIKE ${p})`;
      }
      const result = await db.query(
        `SELECT u.id, u.name, u.email, u.phone, u.role, u.last_active_at, u.created_at,
                sp.employee_id, sp.teacher_id, sp.status, sp.photo_url,
                (SELECT COUNT(*)::int FROM staff_course_assignments a
                 WHERE a.user_id = u.id AND a.is_active = TRUE) AS course_count
         FROM users u
         LEFT JOIN staff_profiles sp ON sp.user_id = u.id
         ${where}
         ORDER BY u.name ASC, u.id ASC
         LIMIT 500`,
        params,
      );
      res.json(result.rows.map(serializeStaffListRow));
    } catch (err) {
      console.error("[AdminStaff] list failed:", err);
      res.status(500).json({ message: "Failed to list staff" });
    }
  });

  app.post("/api/admin/staff/create", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, phone, email, role, employeeId, teacherId, joiningDate, reportingManager } = req.body || {};
      const staffRole = String(role || "teacher").toLowerCase();
      if (!STAFF_ROLES_LIST.includes(staffRole)) {
        return res.status(400).json({ message: "Invalid staff role" });
      }
      const phoneNorm = String(phone || "").replace(/\D/g, "");
      if (phoneNorm.length < 10) return res.status(400).json({ message: "Valid phone required" });
      const existing = await db.query(`SELECT id, role FROM users WHERE phone = $1 LIMIT 1`, [phoneNorm]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ message: "Phone already registered. Use promote instead.", userId: existing.rows[0].id });
      }
      const now = Date.now();
      const userRes = await db.query(
        `INSERT INTO users (name, email, phone, role, profile_complete, created_at, last_active_at)
         VALUES ($1, $2, $3, $4, TRUE, $5, $5) RETURNING id, name, email, phone, role`,
        [String(name || "").trim() || "Teacher", email || null, phoneNorm, staffRole, now],
      );
      const user = userRes.rows[0];
      await db.query(
        `INSERT INTO staff_profiles (user_id, employee_id, teacher_id, joining_date, reporting_manager, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $6)`,
        [
          user.id,
          employeeId || null,
          teacherId || null,
          joiningDate ? Number(joiningDate) : null,
          reportingManager || null,
          now,
        ],
      );
      await logStaffActivity(db, {
        userId: Number(user.id),
        action: "staff.created",
        entityType: "user",
        entityId: user.id,
        meta: { byAdmin: adminUserId(req) },
        req,
      });
      res.status(201).json(user);
    } catch (err) {
      console.error("[AdminStaff] create failed:", err);
      res.status(500).json({ message: "Failed to create staff" });
    }
  });

  app.post("/api/admin/staff/:userId/promote", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const staffRole = String(req.body?.role || "teacher").toLowerCase();
      if (!STAFF_ROLES_LIST.includes(staffRole)) {
        return res.status(400).json({ message: "Invalid staff role" });
      }
      const userRes = await db.query(`SELECT id, role FROM users WHERE id = $1 LIMIT 1`, [userId]);
      if (userRes.rows.length === 0) return res.status(404).json({ message: "User not found" });
      const currentRole = String(userRes.rows[0].role || "").toLowerCase();
      if (currentRole === "admin") return res.status(400).json({ message: "Cannot promote admin" });
      await db.query(`UPDATE users SET role = $1 WHERE id = $2`, [staffRole, userId]);
      await ensureStaffProfile(db, userId);
      const body = req.body || {};
      await db.query(
        `UPDATE staff_profiles SET
           employee_id = COALESCE($2, employee_id),
           teacher_id = COALESCE($3, teacher_id),
           reporting_manager = COALESCE($4, reporting_manager),
           updated_at = $5
         WHERE user_id = $1`,
        [userId, body.employeeId || null, body.teacherId || null, body.reportingManager || null, Date.now()],
      );
      await logStaffActivity(db, {
        userId,
        action: "staff.promoted",
        entityType: "user",
        entityId: userId,
        meta: { role: staffRole, byAdmin: adminUserId(req) },
        req,
      });
      res.json({ success: true, userId, role: staffRole });
    } catch (err) {
      console.error("[AdminStaff] promote failed:", err);
      res.status(500).json({ message: "Failed to promote user" });
    }
  });

  app.post("/api/admin/staff/:userId/demote", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      await db.query(`UPDATE users SET role = 'student' WHERE id = $1 AND role IN ('teacher', 'manager')`, [userId]);
      await db.query(`UPDATE staff_course_assignments SET is_active = FALSE WHERE user_id = $1`, [userId]);
      await db.query(`UPDATE staff_profiles SET status = 'inactive', updated_at = $2 WHERE user_id = $1`, [
        userId,
        Date.now(),
      ]);
      await logStaffActivity(db, {
        userId,
        action: "staff.demoted",
        entityType: "user",
        entityId: userId,
        meta: { byAdmin: adminUserId(req) },
        req,
      });
      res.json({ success: true });
    } catch (err) {
      console.error("[AdminStaff] demote failed:", err);
      res.status(500).json({ message: "Failed to demote staff" });
    }
  });

  app.get("/api/admin/staff/:userId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const bundle = await loadStaffProfileBundle(db, userId);
      if (!bundle) return res.status(404).json({ message: "Staff not found" });
      const assignments = await getStaffAssignments(db, userId);
      const permissions = await getEffectivePermissions(db, userId, String(bundle.user.role));
      const overrides = await getPermissionOverrides(db, userId);
      res.json({ ...bundle, assignments, permissions, permissionOverrides: overrides });
    } catch (err) {
      console.error("[AdminStaff] get detail failed:", err);
      res.status(500).json({ message: "Failed to load staff" });
    }
  });

  app.put("/api/admin/staff/:userId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      await ensureStaffProfile(db, userId);
      const b = req.body || {};
      if (b.name != null) await db.query(`UPDATE users SET name = $1 WHERE id = $2`, [String(b.name).trim(), userId]);
      if (b.email !== undefined) await db.query(`UPDATE users SET email = $1 WHERE id = $2`, [b.email || null, userId]);
      if (b.phone !== undefined) {
        const phoneNorm = String(b.phone || "").replace(/\D/g, "");
        await db.query(`UPDATE users SET phone = $1 WHERE id = $2`, [phoneNorm || null, userId]);
      }
      await db.query(
        `UPDATE staff_profiles SET
           employee_id = COALESCE($2, employee_id),
           teacher_id = COALESCE($3, teacher_id),
           status = COALESCE($4, status),
           personal_json = COALESCE($5, personal_json),
           working_json = COALESCE($6, working_json),
           bank_json = COALESCE($7, bank_json),
           company_json = COALESCE($8, company_json),
           photo_url = COALESCE($9, photo_url),
           resume_url = COALESCE($10, resume_url),
           aadhar_number = COALESCE($11, aadhar_number),
           aadhar_front_url = COALESCE($12, aadhar_front_url),
           aadhar_back_url = COALESCE($13, aadhar_back_url),
           joining_date = COALESCE($14, joining_date),
           reporting_manager = COALESCE($15, reporting_manager),
           department = COALESCE($16, department),
           designation = COALESCE($17, designation),
           updated_at = $18
         WHERE user_id = $1`,
        [
          userId,
          b.employeeId ?? null,
          b.teacherId ?? null,
          b.status ?? null,
          b.personalJson != null ? JSON.stringify(b.personalJson) : null,
          b.workingJson != null ? JSON.stringify(b.workingJson) : null,
          b.bankJson != null ? JSON.stringify(b.bankJson) : null,
          b.companyJson != null ? JSON.stringify(b.companyJson) : null,
          b.photoUrl ?? null,
          b.resumeUrl ?? null,
          b.aadharNumber ?? null,
          b.aadharFrontUrl ?? null,
          b.aadharBackUrl ?? null,
          b.joiningDate != null ? Number(b.joiningDate) : null,
          b.reportingManager ?? null,
          b.department ?? null,
          b.designation ?? null,
          Date.now(),
        ],
      );
      res.json({ success: true });
    } catch (err) {
      console.error("[AdminStaff] update failed:", err);
      res.status(500).json({ message: "Failed to update staff" });
    }
  });

  app.get("/api/admin/staff/:userId/education", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const result = await db.query(
        `SELECT * FROM staff_education WHERE user_id = $1 ORDER BY sort_order ASC, id ASC`,
        [userId],
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to load education" });
    }
  });

  app.put("/api/admin/staff/:userId/education", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const tx = runInTransaction || (async <T>(fn: (d: DbClient) => Promise<T>) => fn(db));
      await tx(async (txDb) => {
        await txDb.query(`DELETE FROM staff_education WHERE user_id = $1`, [userId]);
        for (let i = 0; i < items.length; i++) {
          const e = items[i] || {};
          await txDb.query(
            `INSERT INTO staff_education (user_id, degree, institute, board, university, passing_year, percentage, certificate_url, sort_order, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              userId,
              e.degree || null,
              e.institute || null,
              e.board || null,
              e.university || null,
              e.passingYear || null,
              e.percentage || null,
              e.certificateUrl || null,
              i,
              Date.now(),
            ],
          );
        }
      });
      res.json({ success: true });
    } catch (err) {
      console.error("[AdminStaff] education update failed:", err);
      res.status(500).json({ message: "Failed to update education" });
    }
  });

  app.get("/api/admin/staff/:userId/experience", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const result = await db.query(
        `SELECT * FROM staff_experience WHERE user_id = $1 ORDER BY sort_order ASC, id ASC`,
        [userId],
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to load experience" });
    }
  });

  app.put("/api/admin/staff/:userId/experience", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const tx = runInTransaction || (async <T>(fn: (d: DbClient) => Promise<T>) => fn(db));
      await tx(async (txDb) => {
        await txDb.query(`DELETE FROM staff_experience WHERE user_id = $1`, [userId]);
        for (let i = 0; i < items.length; i++) {
          const e = items[i] || {};
          await txDb.query(
            `INSERT INTO staff_experience (user_id, institute_name, designation, subjects, years_experience, joining_date, leaving_date, experience_letter_url, sort_order, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              userId,
              e.instituteName || null,
              e.designation || null,
              e.subjects || null,
              e.yearsExperience || null,
              e.joiningDate || null,
              e.leavingDate || null,
              e.experienceLetterUrl || null,
              i,
              Date.now(),
            ],
          );
        }
      });
      res.json({ success: true });
    } catch (err) {
      console.error("[AdminStaff] experience update failed:", err);
      res.status(500).json({ message: "Failed to update experience" });
    }
  });

  app.get("/api/admin/staff/:userId/assignments", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const result = await db.query(
        `SELECT a.*, c.title AS course_title
         FROM staff_course_assignments a
         JOIN courses c ON c.id = a.course_id
         WHERE a.user_id = $1 AND a.is_active = TRUE
         ORDER BY a.assigned_at DESC`,
        [userId],
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to load assignments" });
    }
  });

  app.post("/api/admin/staff/:userId/assignments", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseUserId(req.params.userId);
      const courseId = parseUserId(req.body?.courseId);
      if (!userId || !courseId) return res.status(400).json({ message: "Invalid user or course id" });
      const subjectKey =
        typeof req.body?.subjectKey === "string" && req.body.subjectKey.trim()
          ? req.body.subjectKey.trim().toLowerCase()
          : null;
      const adminId = adminUserId(req);
      await db.query(
        `UPDATE staff_course_assignments SET is_active = FALSE
         WHERE user_id = $1 AND course_id = $2 AND COALESCE(subject_key, '') = COALESCE($3::text, '') AND is_active = TRUE`,
        [userId, courseId, subjectKey],
      );
      const result = await db.query(
        `INSERT INTO staff_course_assignments (user_id, course_id, subject_key, assigned_by, assigned_at, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING *`,
        [userId, courseId, subjectKey, adminId, Date.now()],
      );
      await syncTeacherToCourseAbout(db, userId, courseId);
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("[AdminStaff] assign failed:", err);
      res.status(500).json({ message: "Failed to assign course" });
    }
  });

  app.delete("/api/admin/staff/:userId/assignments/:assignmentId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseUserId(req.params.userId);
      const assignmentId = parseUserId(req.params.assignmentId);
      if (!userId || !assignmentId) return res.status(400).json({ message: "Invalid id" });
      await db.query(
        `UPDATE staff_course_assignments SET is_active = FALSE WHERE id = $1 AND user_id = $2`,
        [assignmentId, userId],
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to remove assignment" });
    }
  });

  app.put("/api/admin/staff/:userId/permissions", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const overrides = req.body?.overrides;
      if (!Array.isArray(overrides)) return res.status(400).json({ message: "overrides array required" });
      const adminId = adminUserId(req);
      const tx = runInTransaction || (async <T>(fn: (d: DbClient) => Promise<T>) => fn(db));
      await tx(async (txDb) => {
        for (const o of overrides) {
          const key = String(o.permissionKey || o.permission_key || "");
          if (!STAFF_PERMISSION_KEYS.includes(key as any)) continue;
          await txDb.query(
            `INSERT INTO staff_permission_overrides (user_id, permission_key, allowed, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_id, permission_key) DO UPDATE SET allowed = EXCLUDED.allowed, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
            [userId, key, !!o.allowed, adminId, Date.now()],
          );
        }
      });
      const permissions = await getEffectivePermissions(
        db,
        userId,
        String((await db.query(`SELECT role FROM users WHERE id = $1`, [userId])).rows[0]?.role || "teacher"),
      );
      res.json({ permissions });
    } catch (err) {
      console.error("[AdminStaff] permissions failed:", err);
      res.status(500).json({ message: "Failed to update permissions" });
    }
  });

  app.get("/api/admin/staff/:userId/activity", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const result = await db.query(
        `SELECT * FROM staff_activity_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [userId],
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to load activity" });
    }
  });

  app.get("/api/admin/staff/requests/list", requireAdmin, async (req: Request, res: Response) => {
    try {
      const status = String(req.query.status || "").trim();
      const params: unknown[] = [];
      let where = "WHERE 1=1";
      if (status) {
        params.push(status);
        where += ` AND r.status = $${params.length}`;
      }
      const result = await db.query(
        `SELECT r.*, u.name AS user_name, u.phone AS user_phone
         FROM staff_access_requests r
         JOIN users u ON u.id = r.user_id
         ${where}
         ORDER BY r.created_at DESC
         LIMIT 300`,
        params,
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to load requests" });
    }
  });

  app.put("/api/admin/staff/requests/:requestId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const requestId = parseUserId(req.params.requestId);
      if (!requestId) return res.status(400).json({ message: "Invalid request id" });
      const status = String(req.body?.status || "").toLowerCase();
      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({ message: "status must be approved or rejected" });
      }
      const reqRow = await db.query(`SELECT * FROM staff_access_requests WHERE id = $1 LIMIT 1`, [requestId]);
      if (reqRow.rows.length === 0) return res.status(404).json({ message: "Request not found" });
      const row = reqRow.rows[0];
      const adminId = adminUserId(req);
      await db.query(
        `UPDATE staff_access_requests SET status = $1, admin_note = $2, reviewed_by = $3, reviewed_at = $4 WHERE id = $5`,
        [status, req.body?.adminNote || null, adminId, Date.now(), requestId],
      );
      if (status === "approved") {
        const type = String(row.request_type || "");
        const userId = Number(row.user_id);
        if (type === "recording_upload") {
          await db.query(
            `INSERT INTO staff_permission_overrides (user_id, permission_key, allowed, updated_by, updated_at)
             VALUES ($1, 'lectures.upload_recording', TRUE, $2, $3)
             ON CONFLICT (user_id, permission_key) DO UPDATE SET allowed = TRUE, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
            [userId, adminId, Date.now()],
          );
        } else if (type === "youtube_materials") {
          await db.query(
            `INSERT INTO staff_permission_overrides (user_id, permission_key, allowed, updated_by, updated_at)
             VALUES ($1, 'materials.youtube', TRUE, $2, $3)
             ON CONFLICT (user_id, permission_key) DO UPDATE SET allowed = TRUE, updated_by = EXCLUDED.updated_at`,
            [userId, adminId, Date.now()],
          );
        }
      }
      res.json({ success: true });
    } catch (err) {
      console.error("[AdminStaff] request review failed:", err);
      res.status(500).json({ message: "Failed to review request" });
    }
  });

  /** Phase 6: Aadhar OCR placeholder — returns empty fields until vendor is configured. */
  app.post("/api/admin/staff/ocr/aadhar", requireAdmin, async (req: Request, res: Response) => {
    try {
      const fileUrl = String(req.body?.fileUrl || "");
      if (!fileUrl) return res.status(400).json({ message: "fileUrl required" });
      const parsed = await parseAadharOcrPlaceholder(fileUrl);
      res.json({ fields: parsed, verified: false });
    } catch {
      res.status(500).json({ message: "OCR failed" });
    }
  });
}
