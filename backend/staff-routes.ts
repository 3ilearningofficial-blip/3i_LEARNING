import type { Express, Request, Response } from "express";
import {
  assertCourseAssignment,
  assertLiveStartAllowed,
  filterRowsBySubjectKey,
  findAssignmentForCourse,
  getEffectivePermissions,
  getStaffAssignments,
  logStaffActivity,
  resolveSubjectKeyForWrite,
  StaffAccessError,
  type DbClient,
} from "./staff-access-utils";
import { ensureStaffProfile, loadStaffProfileBundle } from "./staff-profile-utils";
import { createRequireStaffPermission } from "./require-staff-permission";
import { syncLiveClassReminderJob } from "./scheduled-jobs";

type RegisterStaffRoutesDeps = {
  app: Express;
  db: DbClient;
  requireStaff: (req: Request, res: Response, next: () => void) => any;
  updateCourseTestCounts?: (courseId: string) => Promise<void>;
  recomputeAllEnrollmentsProgressForCourse?: (courseId: number | string) => Promise<void>;
};

function staffUser(req: Request): { id: number; role: string } {
  return (req as Request & { user: { id: number; role: string } }).user;
}

function handleStaffError(res: Response, err: unknown): void {
  if (err instanceof StaffAccessError) {
    res.status(err.status).json({ message: err.message, code: err.code });
    return;
  }
  console.error("[Staff]", err);
  res.status(500).json({ message: "Internal error" });
}

function parseId(raw: unknown): number | null {
  const id = parseInt(String(raw), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function registerStaffRoutes({
  app,
  db,
  requireStaff,
  updateCourseTestCounts,
  recomputeAllEnrollmentsProgressForCourse,
}: RegisterStaffRoutesDeps): void {
  const requireStaffPermission = createRequireStaffPermission(db);

  app.get("/api/staff/me", requireStaff, async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const assignments = await getStaffAssignments(db, user.id);
      const permissions = await getEffectivePermissions(db, user.id, user.role);
      const profileRes = await db.query(`SELECT * FROM staff_profiles WHERE user_id = $1 LIMIT 1`, [user.id]);
      res.json({ user, assignments, permissions, profile: profileRes.rows[0] || null });
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.get("/api/staff/assignments", requireStaff, async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const result = await db.query(
        `SELECT a.*, c.title, c.course_type, c.multi_subject_config
         FROM staff_course_assignments a
         JOIN courses c ON c.id = a.course_id
         WHERE a.user_id = $1 AND a.is_active = TRUE
         ORDER BY c.title ASC`,
        [user.id],
      );
      res.json(result.rows);
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.get("/api/staff/dashboard", requireStaff, async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const assignments = await getStaffAssignments(db, user.id);
      const courseIds = [...new Set(assignments.map((a) => a.course_id))];
      if (courseIds.length === 0) {
        return res.json({ todayClasses: [], upcomingClasses: [], courses: [], pendingRequests: [], recentActivity: [] });
      }
      const now = Date.now();
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = dayStart.getTime() + 86400000;
      const liveRes = await db.query(
        `SELECT lc.*, c.title AS course_title
         FROM live_classes lc
         LEFT JOIN courses c ON c.id = lc.course_id
         WHERE lc.course_id = ANY($1::int[])
           AND COALESCE(lc.is_completed, FALSE) = FALSE
         ORDER BY lc.scheduled_at ASC NULLS LAST
         LIMIT 50`,
        [courseIds],
      );
      const filteredLive = liveRes.rows.filter((lc: any) => {
        const a = findAssignmentForCourse(assignments, Number(lc.course_id), lc.subject_key);
        return !!a;
      });
      const todayClasses = filteredLive.filter(
        (lc: any) => lc.scheduled_at >= dayStart.getTime() && lc.scheduled_at < dayEnd,
      );
      const upcomingClasses = filteredLive.filter((lc: any) => Number(lc.scheduled_at || 0) >= now).slice(0, 10);
      const coursesRes = await db.query(
        `SELECT id, title, course_type, thumbnail FROM courses WHERE id = ANY($1::int[])`,
        [courseIds],
      );
      const pendingRes = await db.query(
        `SELECT * FROM staff_access_requests WHERE user_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 20`,
        [user.id],
      );
      const activityRes = await db.query(
        `SELECT * FROM staff_activity_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 15`,
        [user.id],
      );
      res.json({
        todayClasses,
        upcomingClasses,
        courses: coursesRes.rows,
        pendingRequests: pendingRes.rows,
        recentActivity: activityRes.rows,
      });
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.get("/api/staff/profile", requireStaff, async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const bundle = await loadStaffProfileBundle(db, user.id);
      res.json(bundle);
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.put("/api/staff/profile", requireStaff, async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      await ensureStaffProfile(db, user.id);
      const b = req.body || {};
      if (b.name != null) await db.query(`UPDATE users SET name = $1 WHERE id = $2`, [String(b.name).trim(), user.id]);
      await db.query(
        `UPDATE staff_profiles SET
           personal_json = COALESCE($2, personal_json),
           bank_json = COALESCE($3, bank_json),
           photo_url = COALESCE($4, photo_url),
           resume_url = COALESCE($5, resume_url),
           aadhar_number = COALESCE($6, aadhar_number),
           aadhar_front_url = COALESCE($7, aadhar_front_url),
           aadhar_back_url = COALESCE($8, aadhar_back_url),
           updated_at = $9
         WHERE user_id = $1`,
        [
          user.id,
          b.personalJson != null ? JSON.stringify(b.personalJson) : null,
          b.bankJson != null ? JSON.stringify(b.bankJson) : null,
          b.photoUrl ?? null,
          b.resumeUrl ?? null,
          b.aadharNumber ?? null,
          b.aadharFrontUrl ?? null,
          b.aadharBackUrl ?? null,
          Date.now(),
        ],
      );
      await logStaffActivity(db, { userId: user.id, action: "profile.updated", req });
      res.json({ success: true });
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.get("/api/staff/profile/education", requireStaff, async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const result = await db.query(
        `SELECT * FROM staff_education WHERE user_id = $1 ORDER BY sort_order ASC, id ASC`,
        [user.id],
      );
      res.json(result.rows);
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.put("/api/staff/profile/education", requireStaff, async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      await db.query(`DELETE FROM staff_education WHERE user_id = $1`, [user.id]);
      for (let i = 0; i < items.length; i++) {
        const e = items[i] || {};
        await db.query(
          `INSERT INTO staff_education (user_id, degree, institute, board, university, passing_year, percentage, certificate_url, sort_order, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            user.id,
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
      await logStaffActivity(db, { userId: user.id, action: "education.updated", req });
      res.json({ success: true });
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.get("/api/staff/courses", requireStaff, async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const assignments = await getStaffAssignments(db, user.id);
      const courseIds = [...new Set(assignments.map((a) => a.course_id))];
      if (courseIds.length === 0) return res.json([]);
      const result = await db.query(`SELECT * FROM courses WHERE id = ANY($1::int[]) ORDER BY title ASC`, [courseIds]);
      res.json(
        result.rows.map((c: any) => ({
          ...c,
          assignments: assignments.filter((a) => a.course_id === c.id),
        })),
      );
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.get("/api/staff/courses/:id", requireStaff, async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const courseId = parseId(req.params.id);
      if (!courseId) return res.status(400).json({ message: "Invalid course id" });
      const assignment = await assertCourseAssignment(db, user.id, courseId);
      const courseRes = await db.query(`SELECT * FROM courses WHERE id = $1 LIMIT 1`, [courseId]);
      if (courseRes.rows.length === 0) return res.status(404).json({ message: "Course not found" });
      const [lectures, tests, materials, liveClasses, missions, foldersRes] = await Promise.all([
        db.query(`SELECT * FROM lectures WHERE course_id = $1 ORDER BY order_index ASC, id ASC`, [courseId]),
        db.query(`SELECT * FROM tests WHERE course_id = $1 ORDER BY order_index ASC, id ASC`, [courseId]),
        db.query(`SELECT * FROM study_materials WHERE course_id = $1 ORDER BY order_index ASC, id ASC`, [courseId]),
        db.query(`SELECT * FROM live_classes WHERE course_id = $1 ORDER BY scheduled_at DESC NULLS LAST`, [courseId]),
        db.query(`SELECT * FROM daily_missions WHERE course_id = $1 ORDER BY id DESC`, [courseId]),
        db.query(
          `SELECT id, course_id, name, full_name, type, parent_id, order_index, subject_key
           FROM course_folders WHERE course_id = $1 ORDER BY order_index ASC NULLS LAST, id ASC`,
          [courseId],
        ),
      ]);
      res.json({
        course: courseRes.rows[0],
        assignment,
        lectures: filterRowsBySubjectKey(lectures.rows, assignment),
        tests: filterRowsBySubjectKey(tests.rows, assignment),
        materials: filterRowsBySubjectKey(materials.rows, assignment),
        liveClasses: filterRowsBySubjectKey(liveClasses.rows, assignment),
        missions: filterRowsBySubjectKey(missions.rows, assignment),
        folders: filterRowsBySubjectKey(foldersRes.rows, assignment),
      });
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.post("/api/staff/live-classes", requireStaff, requireStaffPermission("live.schedule"), async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const courseId = parseId(req.body?.courseId);
      if (!courseId) return res.status(400).json({ message: "courseId required" });
      const assignment = await assertCourseAssignment(db, user.id, courseId, { permission: "live.schedule" });
      const subjectKey = resolveSubjectKeyForWrite(assignment, req.body?.subjectKey);
      const { title, description, scheduledAt, isLive, streamType, chatMode, showViewerCount, lectureSectionTitle, lectureSubfolderTitle } =
        req.body || {};
      if (req.body?.isRecordingMode === true) {
        return res.status(403).json({ message: "Recording sessions require admin approval" });
      }
      const result = await db.query(
        `INSERT INTO live_classes (title, description, course_id, scheduled_at, is_live, is_public, notify_email, notify_bell, is_free_preview, stream_type, chat_mode, show_viewer_count, lecture_section_title, lecture_subfolder_title, is_recording_mode, subject_key, created_at)
         VALUES ($1, $2, $3, $4, $5, FALSE, FALSE, FALSE, FALSE, $6, $7, $8, $9, $10, FALSE, $11, $12) RETURNING *`,
        [
          title,
          description || "",
          courseId,
          scheduledAt,
          isLive || false,
          streamType || "rtmp",
          chatMode || "public",
          showViewerCount !== false,
          lectureSectionTitle || null,
          lectureSubfolderTitle || null,
          subjectKey,
          Date.now(),
        ],
      );
      await logStaffActivity(db, {
        userId: user.id,
        action: "live.scheduled",
        entityType: "live_class",
        entityId: result.rows[0]?.id,
        courseId,
        subjectKey,
        req,
      });
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.put("/api/staff/live-classes/:id", requireStaff, requireStaffPermission("live.schedule"), async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const liveId = parseId(req.params.id);
      if (!liveId) return res.status(400).json({ message: "Invalid id" });
      const lc = await db.query(`SELECT * FROM live_classes WHERE id = $1 LIMIT 1`, [liveId]);
      if (lc.rows.length === 0) return res.status(404).json({ message: "Not found" });
      const courseId = Number(lc.rows[0].course_id);
      await assertCourseAssignment(db, user.id, courseId, {
        subjectKey: lc.rows[0].subject_key,
        permission: "live.schedule",
      });
      const b = req.body || {};
      const result = await db.query(
        `UPDATE live_classes SET title = COALESCE($2, title), description = COALESCE($3, description), scheduled_at = COALESCE($4, scheduled_at)
         WHERE id = $1 RETURNING *`,
        [liveId, b.title, b.description, b.scheduledAt],
      );
      await logStaffActivity(db, { userId: user.id, action: "live.updated", entityType: "live_class", entityId: liveId, courseId, req });
      await syncLiveClassReminderJob(db, liveId).catch((err) =>
        console.error("[StaffLiveClass] reminder job sync failed:", err)
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.post("/api/staff/live-classes/:id/stream/create", requireStaff, async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      await assertLiveStartAllowed(db, user.id, user.role, req);
      const liveId = parseId(req.params.id);
      if (!liveId) return res.status(400).json({ message: "Invalid id" });
      const lcResult = await db.query(`SELECT * FROM live_classes WHERE id = $1`, [liveId]);
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      const liveClass = lcResult.rows[0];
      await assertCourseAssignment(db, user.id, Number(liveClass.course_id), {
        subjectKey: liveClass.subject_key,
        permission: "live.start",
      });
      const accountId = process.env.CF_STREAM_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
      const apiToken = process.env.CF_STREAM_API_TOKEN;
      if (!accountId || !apiToken) {
        return res.status(500).json({ message: "Cloudflare Stream credentials not configured" });
      }
      if (liveClass.cf_stream_uid) {
        return res.json({
          uid: liveClass.cf_stream_uid,
          rtmpUrl: liveClass.cf_stream_rtmp_url,
          streamKey: liveClass.cf_stream_key,
          playbackHls: liveClass.cf_playback_hls,
        });
      }
      const cfRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ meta: { name: liveClass.title }, recording: { mode: "automatic", timeoutSeconds: 20 } }),
      });
      if (!cfRes.ok) {
        const errBody = await cfRes.text();
        return res.status(502).json({ message: "Cloudflare Stream API error: " + errBody });
      }
      const cfData = (await cfRes.json()) as any;
      const input = cfData.result;
      const uid = input.uid;
      const rtmpUrl = input.rtmps?.url || "rtmps://live.cloudflare.com:443/live/";
      const streamKey = input.rtmps?.streamKey || uid;
      const playbackHls = `https://videodelivery.net/${uid}/manifest/video.m3u8`;
      await db.query(
        "UPDATE live_classes SET cf_stream_uid = $1, cf_stream_key = $2, cf_stream_rtmp_url = $3, cf_playback_hls = $4 WHERE id = $5",
        [uid, streamKey, rtmpUrl, playbackHls, liveId],
      );
      await logStaffActivity(db, {
        userId: user.id,
        action: "live.stream_created",
        entityType: "live_class",
        entityId: liveId,
        courseId: Number(liveClass.course_id),
        req,
      });
      res.json({ uid, rtmpUrl, streamKey, playbackHls });
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.post("/api/staff/tests", requireStaff, requireStaffPermission("tests.create"), async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const { title, description, courseId, durationMinutes, totalMarks, passingMarks, testType, folderName, difficulty, scheduledAt, subjectKey } =
        req.body || {};
      const cid = courseId != null ? parseId(courseId) : null;
      let normalizedSubjectKey: string | null = null;
      if (cid) {
        const assignment = await assertCourseAssignment(db, user.id, cid, { permission: "tests.create" });
        normalizedSubjectKey = resolveSubjectKeyForWrite(assignment, subjectKey);
      }
      const result = await db.query(
        `INSERT INTO tests (title, description, course_id, duration_minutes, total_marks, passing_marks, test_type, folder_name, difficulty, scheduled_at, subject_key, is_published, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, $12) RETURNING *`,
        [
          title,
          description,
          cid,
          durationMinutes || 60,
          totalMarks || 100,
          passingMarks || 35,
          testType || "practice",
          folderName || null,
          difficulty || "moderate",
          scheduledAt ? new Date(scheduledAt).getTime() : null,
          normalizedSubjectKey,
          Date.now(),
        ],
      );
      if (cid && updateCourseTestCounts) await updateCourseTestCounts(String(cid));
      await logStaffActivity(db, {
        userId: user.id,
        action: "test.created",
        entityType: "test",
        entityId: result.rows[0]?.id,
        courseId: cid,
        subjectKey: normalizedSubjectKey,
        req,
      });
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.put("/api/staff/tests/:id", requireStaff, requireStaffPermission("tests.edit"), async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const testId = parseId(req.params.id);
      if (!testId) return res.status(400).json({ message: "Invalid test id" });
      const testRes = await db.query(`SELECT * FROM tests WHERE id = $1 LIMIT 1`, [testId]);
      if (testRes.rows.length === 0) return res.status(404).json({ message: "Test not found" });
      const test = testRes.rows[0];
      if (test.course_id) {
        await assertCourseAssignment(db, user.id, Number(test.course_id), {
          subjectKey: test.subject_key,
          permission: "tests.edit",
        });
      }
      const b = req.body || {};
      const result = await db.query(
        `UPDATE tests SET title = COALESCE($2, title), description = COALESCE($3, description), duration_minutes = COALESCE($4, duration_minutes),
         total_marks = COALESCE($5, total_marks), passing_marks = COALESCE($6, passing_marks), folder_name = COALESCE($7, folder_name)
         WHERE id = $1 RETURNING *`,
        [testId, b.title, b.description, b.durationMinutes, b.totalMarks, b.passingMarks, b.folderName],
      );
      await logStaffActivity(db, { userId: user.id, action: "test.updated", entityType: "test", entityId: testId, req });
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.get("/api/staff/tests", requireStaff, async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const assignments = await getStaffAssignments(db, user.id);
      const courseIds = [...new Set(assignments.map((a) => a.course_id))];
      const standalone = await db.query(
        `SELECT t.*, NULL AS course_title FROM tests t WHERE t.course_id IS NULL ORDER BY t.created_at DESC LIMIT 200`,
      );
      let courseTests: any[] = [];
      if (courseIds.length > 0) {
        const ct = await db.query(
          `SELECT t.*, c.title AS course_title FROM tests t JOIN courses c ON c.id = t.course_id WHERE t.course_id = ANY($1::int[])`,
          [courseIds],
        );
        courseTests = ct.rows.filter((t: any) => {
          const a = findAssignmentForCourse(assignments, Number(t.course_id), t.subject_key);
          return !!a;
        });
      }
      res.json([...standalone.rows, ...courseTests]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.post("/api/staff/study-materials", requireStaff, requireStaffPermission("materials.course.create"), async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const courseId = parseId(req.body?.courseId);
      if (!courseId) return res.status(400).json({ message: "courseId required" });
      const assignment = await assertCourseAssignment(db, user.id, courseId, { permission: "materials.course.create" });
      const subjectKey = resolveSubjectKeyForWrite(assignment, req.body?.subjectKey);
      const { title, description, fileUrl, fileType, sectionTitle, downloadAllowed } = req.body || {};
      const result = await db.query(
        `INSERT INTO study_materials (course_id, title, description, file_url, file_type, section_title, subject_key, download_allowed, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [courseId, title, description || "", fileUrl, fileType || "pdf", sectionTitle || null, subjectKey, downloadAllowed || false, Date.now()],
      );
      await logStaffActivity(db, {
        userId: user.id,
        action: "material.created",
        entityType: "material",
        entityId: result.rows[0]?.id,
        courseId,
        subjectKey,
        req,
      });
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.put("/api/staff/study-materials/:id", requireStaff, requireStaffPermission("materials.course.edit"), async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const materialId = parseId(req.params.id);
      if (!materialId) return res.status(400).json({ message: "Invalid id" });
      const mRes = await db.query(`SELECT * FROM study_materials WHERE id = $1`, [materialId]);
      if (mRes.rows.length === 0) return res.status(404).json({ message: "Not found" });
      const m = mRes.rows[0];
      await assertCourseAssignment(db, user.id, Number(m.course_id), {
        subjectKey: m.subject_key,
        permission: "materials.course.edit",
      });
      const b = req.body || {};
      const result = await db.query(
        `UPDATE study_materials SET title = COALESCE($2, title), description = COALESCE($3, description) WHERE id = $1 RETURNING *`,
        [materialId, b.title, b.description],
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.post("/api/staff/daily-missions", requireStaff, requireStaffPermission("missions.create"), async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const { title, description, questions, missionDate, xpReward, missionType, courseId, folderName, subjectKey } = req.body || {};
      const parsedCourseId = parseId(courseId);
      if (!parsedCourseId) return res.status(400).json({ message: "courseId required" });
      const assignment = await assertCourseAssignment(db, user.id, parsedCourseId, { permission: "missions.create" });
      const normalizedSubjectKey = resolveSubjectKeyForWrite(assignment, subjectKey);
      const folderNameNorm = typeof folderName === "string" && folderName.trim() ? folderName.trim() : null;
      const result = await db.query(
        `INSERT INTO daily_missions (title, description, questions, mission_date, xp_reward, mission_type, course_id, folder_name, subject_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          title,
          description || "",
          JSON.stringify(questions || []),
          missionDate || new Date().toISOString().split("T")[0],
          xpReward || 50,
          missionType || "daily_drill",
          parsedCourseId,
          folderNameNorm,
          normalizedSubjectKey,
        ],
      );
      if (recomputeAllEnrollmentsProgressForCourse) await recomputeAllEnrollmentsProgressForCourse(parsedCourseId).catch(() => {});
      await logStaffActivity(db, {
        userId: user.id,
        action: "mission.created",
        entityType: "mission",
        entityId: result.rows[0]?.id,
        courseId: parsedCourseId,
        subjectKey: normalizedSubjectKey,
        req,
      });
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.put("/api/staff/daily-missions/:id", requireStaff, requireStaffPermission("missions.edit"), async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const missionId = parseId(req.params.id);
      if (!missionId) return res.status(400).json({ message: "Invalid id" });
      const mRes = await db.query(`SELECT * FROM daily_missions WHERE id = $1`, [missionId]);
      if (mRes.rows.length === 0) return res.status(404).json({ message: "Not found" });
      const m = mRes.rows[0];
      await assertCourseAssignment(db, user.id, Number(m.course_id), {
        subjectKey: m.subject_key,
        permission: "missions.edit",
      });
      const b = req.body || {};
      const result = await db.query(
        `UPDATE daily_missions SET title = COALESCE($2, title), description = COALESCE($3, description),
         questions = COALESCE($4, questions) WHERE id = $1 RETURNING *`,
        [missionId, b.title, b.description, b.questions ? JSON.stringify(b.questions) : null],
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.get("/api/staff/daily-missions", requireStaff, async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const assignments = await getStaffAssignments(db, user.id);
      const courseIds = [...new Set(assignments.map((a) => a.course_id))];
      if (courseIds.length === 0) return res.json([]);
      const result = await db.query(`SELECT * FROM daily_missions WHERE course_id = ANY($1::int[]) ORDER BY id DESC`, [courseIds]);
      const filtered = result.rows.filter((m: any) => {
        const a = findAssignmentForCourse(assignments, Number(m.course_id), m.subject_key);
        return !!a;
      });
      res.json(filtered);
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.get("/api/staff/materials/folders", requireStaff, async (req: Request, res: Response) => {
    try {
      const result = await db.query(
        `SELECT * FROM standalone_folders WHERE type = 'material' ORDER BY order_index ASC, id ASC`,
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to load folders" });
    }
  });

  app.get("/api/staff/materials", requireStaff, async (req: Request, res: Response) => {
    try {
      const result = await db.query(
        `SELECT * FROM study_materials WHERE course_id IS NULL ORDER BY order_index ASC, id DESC LIMIT 500`,
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to load materials" });
    }
  });

  app.post("/api/staff/materials", requireStaff, requireStaffPermission("materials.free.create"), async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const { title, description, fileUrl, fileType, folderName } = req.body || {};
      const fileTypeNorm = String(fileType || "pdf").toLowerCase();
      if (fileTypeNorm === "youtube") {
        const ok = await db.query(`SELECT 1 FROM staff_permission_overrides WHERE user_id = $1 AND permission_key = 'materials.youtube' AND allowed = TRUE LIMIT 1`, [
          user.id,
        ]);
        const perms = await getEffectivePermissions(db, user.id, user.role);
        if (!perms["materials.youtube"] && ok.rows.length === 0) {
          return res.status(403).json({ message: "YouTube upload requires approval" });
        }
      }
      const result = await db.query(
        `INSERT INTO study_materials (title, description, file_url, file_type, section_title, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [title, description || "", fileUrl, fileTypeNorm, folderName || null, Date.now()],
      );
      await logStaffActivity(db, { userId: user.id, action: "free_material.created", entityType: "material", entityId: result.rows[0]?.id, req });
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.put("/api/staff/materials/:id", requireStaff, requireStaffPermission("materials.free.edit"), async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const materialId = parseId(req.params.id);
      if (!materialId) return res.status(400).json({ message: "Invalid id" });
      const b = req.body || {};
      const result = await db.query(
        `UPDATE study_materials SET title = COALESCE($2, title), description = COALESCE($3, description)
         WHERE id = $1 AND course_id IS NULL RETURNING *`,
        [materialId, b.title, b.description],
      );
      if (result.rows.length === 0) return res.status(404).json({ message: "Not found" });
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.delete("/api/staff/materials/:id", requireStaff, requireStaffPermission("materials.free.delete"), async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const materialId = parseId(req.params.id);
      if (!materialId) return res.status(400).json({ message: "Invalid id" });
      await db.query(`DELETE FROM study_materials WHERE id = $1 AND course_id IS NULL`, [materialId]);
      await logStaffActivity(db, { userId: user.id, action: "free_material.deleted", entityType: "material", entityId: materialId, req });
      res.json({ success: true });
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.get("/api/staff/requests", requireStaff, async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const result = await db.query(
        `SELECT * FROM staff_access_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [user.id],
      );
      res.json(result.rows);
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.post("/api/staff/requests", requireStaff, async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const requestType = String(req.body?.requestType || req.body?.type || "").trim();
      const allowed = ["recording_upload", "youtube_materials", "student_course_access", "new_subject"];
      if (!allowed.includes(requestType)) {
        return res.status(400).json({ message: "Invalid request type" });
      }
      const result = await db.query(
        `INSERT INTO staff_access_requests (user_id, request_type, payload, status, created_at)
         VALUES ($1, $2, $3, 'pending', $4) RETURNING *`,
        [user.id, requestType, JSON.stringify(req.body?.payload || {}), Date.now()],
      );
      await logStaffActivity(db, { userId: user.id, action: "request.submitted", entityType: "request", entityId: result.rows[0]?.id, req });
      res.status(201).json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });

  app.post("/api/staff/course-folders", requireStaff, requireStaffPermission("folders.create"), async (req: Request, res: Response) => {
    try {
      const user = staffUser(req);
      const courseId = parseId(req.body?.courseId);
      const type = String(req.body?.type || "material");
      const name = String(req.body?.name || "").trim();
      if (!courseId || !name) return res.status(400).json({ message: "courseId and name required" });
      const assignment = await assertCourseAssignment(db, user.id, courseId, { permission: "folders.create" });
      const subjectKey = resolveSubjectKeyForWrite(assignment, req.body?.subjectKey);
      const parentId = parseId(req.body?.parentId);
      const result = await db.query(
        `INSERT INTO course_folders (course_id, type, name, parent_id, subject_key, order_index, created_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), $7) RETURNING *`,
        [courseId, type, name, parentId, subjectKey, req.body?.orderIndex ?? 0, Date.now()],
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
}
