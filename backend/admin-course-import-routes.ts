import type { Express, Request, Response } from "express";
import {
  fetchContentImportPreview,
  importCourseContent,
  importLecturesByIds,
  importMaterialsByIds,
  importTestsByIds,
  parseCourseId,
  parseImportContentOptions,
  type DbExec,
} from "./course-content-transfer";

type DbClient = DbExec;

type RegisterAdminCourseImportRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  updateCourseTestCounts: (courseId: string) => Promise<void>;
  recomputeAllEnrollmentsProgressForCourse: (courseId: number | string) => Promise<void>;
  runInTransaction: <T>(fn: (client: DbClient) => Promise<T>) => Promise<T>;
};

async function finalizeTargetCourseStats(
  db: DbClient,
  targetCourseId: string,
  opts: { lectures: boolean; tests: boolean },
  updateCourseTestCounts: (courseId: string) => Promise<void>,
  recomputeAllEnrollmentsProgressForCourse: (courseId: number | string) => Promise<void>
): Promise<void> {
  if (opts.lectures) {
    await db.query(
      "UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1",
      [targetCourseId]
    );
    await recomputeAllEnrollmentsProgressForCourse(targetCourseId);
  }
  if (opts.tests) {
    await updateCourseTestCounts(targetCourseId);
  }
}

export function registerAdminCourseImportRoutes({
  app,
  db,
  requireAdmin,
  updateCourseTestCounts,
  recomputeAllEnrollmentsProgressForCourse,
  runInTransaction,
}: RegisterAdminCourseImportRoutesDeps): void {
  /** Preview counts for import modal */
  app.get("/api/admin/courses/:id/import-content-preview", requireAdmin, async (req: Request, res: Response) => {
    try {
      const sourceCourseId = parseCourseId(req.query.sourceCourseId);
      if (!sourceCourseId) {
        return res.status(400).json({ message: "sourceCourseId query param is required" });
      }
      const preview = await fetchContentImportPreview(db, sourceCourseId);
      res.json(preview);
    } catch (err) {
      console.error("[Import] preview error:", err);
      res.status(500).json({ message: "Failed to load import preview" });
    }
  });

  /** Bulk import lectures / tests / materials / missions from another course (transactional) */
  app.post("/api/admin/courses/:id/import-content", requireAdmin, async (req: Request, res: Response) => {
    try {
      const targetCourseId = parseCourseId(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const sourceCourseId = parseCourseId(req.body?.sourceCourseId);
      const options = parseImportContentOptions(req.body);

      if (!targetCourseId) return res.status(400).json({ message: "Invalid target course id" });
      if (!sourceCourseId) return res.status(400).json({ message: "sourceCourseId is required" });
      if (!options) {
        return res.status(400).json({ message: "Select at least one content type to import" });
      }

      const result = await runInTransaction((tx) =>
        importCourseContent(tx, targetCourseId, sourceCourseId, options)
      );

      await finalizeTargetCourseStats(
        db,
        String(targetCourseId),
        { lectures: options.lectures, tests: options.tests },
        updateCourseTestCounts,
        recomputeAllEnrollmentsProgressForCourse
      );

      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("[Import] import-content error:", err);
      const msg = err?.message || "Failed to import course content";
      const status = msg.includes("not found") || msg.includes("different") ? 400 : 500;
      res.status(status).json({ message: msg });
    }
  });

  app.post("/api/admin/courses/:id/import-lectures", requireAdmin, async (req: Request, res: Response) => {
    try {
      const targetCourseId = parseCourseId(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const { lectureIds } = req.body;
      if (!targetCourseId) return res.status(400).json({ message: "Invalid course id" });
      if (!lectureIds || !Array.isArray(lectureIds) || lectureIds.length === 0) {
        return res.status(400).json({ message: "No lectures selected" });
      }

      const imported = await runInTransaction((tx) =>
        importLecturesByIds(tx, targetCourseId, lectureIds.map((id: unknown) => Number(id)).filter((id) => Number.isFinite(id)))
      );

      await finalizeTargetCourseStats(
        db,
        String(targetCourseId),
        { lectures: true, tests: false },
        updateCourseTestCounts,
        recomputeAllEnrollmentsProgressForCourse
      );

      res.json({ success: true, imported });
    } catch (err) {
      console.error("Import lectures error:", err);
      res.status(500).json({ message: "Failed to import lectures" });
    }
  });

  app.post("/api/admin/courses/:id/import-tests", requireAdmin, async (req: Request, res: Response) => {
    try {
      const targetCourseId = parseCourseId(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const { testIds } = req.body;
      if (!targetCourseId) return res.status(400).json({ message: "Invalid course id" });
      if (!testIds || !Array.isArray(testIds) || testIds.length === 0) {
        return res.status(400).json({ message: "No tests selected" });
      }

      const imported = await runInTransaction((tx) =>
        importTestsByIds(tx, targetCourseId, testIds.map((id: unknown) => Number(id)).filter((id) => Number.isFinite(id)))
      );

      await finalizeTargetCourseStats(
        db,
        String(targetCourseId),
        { lectures: false, tests: true },
        updateCourseTestCounts,
        recomputeAllEnrollmentsProgressForCourse
      );

      res.json({ success: true, imported });
    } catch (err) {
      console.error("Import tests error:", err);
      res.status(500).json({ message: "Failed to import tests" });
    }
  });

  app.post("/api/admin/courses/:id/import-materials", requireAdmin, async (req: Request, res: Response) => {
    try {
      const targetCourseId = parseCourseId(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const { materialIds } = req.body;
      if (!targetCourseId) return res.status(400).json({ message: "Invalid course id" });
      if (!materialIds || !Array.isArray(materialIds) || materialIds.length === 0) {
        return res.status(400).json({ message: "No materials selected" });
      }

      const imported = await runInTransaction((tx) =>
        importMaterialsByIds(
          tx,
          targetCourseId,
          materialIds.map((id: unknown) => Number(id)).filter((id) => Number.isFinite(id))
        )
      );

      res.json({ success: true, imported });
    } catch (err) {
      console.error("Import materials error:", err);
      res.status(500).json({ message: "Failed to import materials" });
    }
  });
}
