import { describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { registerStudentMissionMaterialRoutes } from "./student-mission-material-routes";

vi.mock("./standalone-entitlement-service", () => ({
  hasActiveStandaloneEntitlement: vi.fn(async () => false),
}));

const standaloneFree = {
  id: 1,
  title: "NDA Notes",
  course_id: null,
  is_free: true,
  file_type: "pdf",
  section_title: null,
};

const boardPdf = {
  id: 2,
  title: "Algebra Live — Board notes",
  course_id: 42,
  is_free: false,
  file_type: "pdf",
  section_title: null,
};

const misconfiguredCourseFree = {
  id: 3,
  title: "Misconfigured course free row",
  course_id: 99,
  is_free: true,
  file_type: "pdf",
  section_title: null,
};

const paidStandalone = {
  id: 4,
  title: "Paid standalone pack",
  course_id: null,
  is_free: false,
  file_type: "pdf",
  section_title: null,
};

const ALL_MATERIALS = [standaloneFree, boardPdf, misconfiguredCourseFree, paidStandalone];

function createMockDb() {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("folder_tree") || sql.includes("standalone_folders")) {
        return { rows: [] };
      }
      if (sql.includes("EXISTS") && sql.includes("enrollments")) {
        return { rows: ALL_MATERIALS };
      }
      if (sql.includes("course_id IS NULL") && sql.includes("is_free = TRUE")) {
        return {
          rows: ALL_MATERIALS.filter((m) => m.course_id == null && m.is_free),
        };
      }
      if (sql.includes("course_id IS NULL")) {
        return { rows: ALL_MATERIALS.filter((m) => m.course_id == null) };
      }
      return { rows: [] };
    }),
  };
}

async function withStudyMaterialsServer(
  getAuthUser: (req: express.Request) => Promise<any>,
  run: (port: number) => Promise<void>
) {
  const app = express();
  app.use(express.json());
  const db = createMockDb();
  registerStudentMissionMaterialRoutes({
    app,
    db: db as any,
    getAuthUser,
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(port);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe("GET /api/study-materials?free=true", () => {
  it("excludes enrolled course board PDF for logged-in students", async () => {
    await withStudyMaterialsServer(async () => ({ id: 7, role: "student" }), async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/study-materials?free=true`);
      expect(res.status).toBe(200);
      const body = await res.json();
      const ids = (body.materials || []).map((m: { id: number }) => m.id);
      expect(ids).toContain(standaloneFree.id);
      expect(ids).not.toContain(boardPdf.id);
      expect(ids).not.toContain(misconfiguredCourseFree.id);
    });
  });

  it("returns only standalone free materials for guests", async () => {
    await withStudyMaterialsServer(async () => null, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/study-materials?free=true`);
      expect(res.status).toBe(200);
      const body = await res.json();
      const ids = (body.materials || []).map((m: { id: number }) => m.id);
      expect(ids).toEqual([standaloneFree.id]);
    });
  });

  it("excludes course-linked rows for admin even when is_free is true", async () => {
    await withStudyMaterialsServer(async () => ({ id: 1, role: "admin" }), async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/study-materials?free=true`);
      expect(res.status).toBe(200);
      const body = await res.json();
      const ids = (body.materials || []).map((m: { id: number }) => m.id);
      expect(ids).toContain(standaloneFree.id);
      expect(ids).not.toContain(boardPdf.id);
      expect(ids).not.toContain(misconfiguredCourseFree.id);
    });
  });

  it("excludes paid standalone materials for logged-in students on home feed", async () => {
    await withStudyMaterialsServer(async () => ({ id: 7, role: "student" }), async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/study-materials?free=true`);
      expect(res.status).toBe(200);
      const body = await res.json();
      const ids = (body.materials || []).map((m: { id: number }) => m.id);
      expect(ids).not.toContain(paidStandalone.id);
    });
  });
});

describe("GET /api/study-materials without free=true", () => {
  it("still returns enrolled course materials for backward compatibility", async () => {
    await withStudyMaterialsServer(async () => ({ id: 7, role: "student" }), async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/study-materials`);
      expect(res.status).toBe(200);
      const body = await res.json();
      const ids = (body.materials || []).map((m: { id: number }) => m.id);
      expect(ids).toContain(boardPdf.id);
    });
  });
});
