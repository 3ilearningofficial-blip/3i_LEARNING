import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerLiveStreamRoutes } from "./live-stream-routes";

type RouteHandler = (req: any, res: any, next?: () => void) => any;

class FakeApp {
  public routes = new Map<string, RouteHandler[]>();
  post(path: string, ...handlers: RouteHandler[]) {
    this.routes.set(`POST ${path}`, handlers);
  }
  get(path: string, ...handlers: RouteHandler[]) {
    this.routes.set(`GET ${path}`, handlers);
  }
}

function createFakeDb(initial: { liveClasses: any[]; lectures?: any[]; courses?: any[] }) {
  const state = {
    liveClasses: [...initial.liveClasses],
    lectures: [...(initial.lectures || [])],
    courses: [...(initial.courses || [])],
    lectureId: 1000,
  };

  const query = async (text: string, params: unknown[] = []) => {
    const sql = text.replace(/\s+/g, " ").trim();
    if (sql.includes("SELECT id, title, cf_stream_uid") && sql.includes("FROM live_classes WHERE id = $1")) {
      const row = state.liveClasses.find((r) => String(r.id) === String(params[0]));
      return { rows: row ? [{ id: row.id, title: row.title, cf_stream_uid: row.cf_stream_uid }] : [] };
    }
    if (sql.includes("UPDATE live_classes SET is_live = FALSE, ended_at = COALESCE(ended_at, $1), is_completed = TRUE WHERE id = $2")) {
      const row = state.liveClasses.find((r) => String(r.id) === String(params[1]));
      if (row) {
        row.is_live = false;
        row.is_completed = true;
        row.ended_at = row.ended_at || Number(params[0]);
      }
      return { rows: [] };
    }
    if (sql.includes("SELECT * FROM live_classes WHERE id = $1")) {
      const row = state.liveClasses.find((r) => String(r.id) === String(params[0]));
      return { rows: row ? [row] : [] };
    }
    if (sql.includes("SELECT * FROM live_classes WHERE title = $1 ORDER BY id")) {
      return { rows: state.liveClasses.filter((r) => String(r.title) === String(params[0])) };
    }
    if (sql.includes("UPDATE live_classes SET recording_url = $1, is_completed = TRUE, is_live = FALSE, ended_at = $2")) {
      const row = state.liveClasses.find((r) => String(r.id) === String(params[2]));
      if (row) {
        const endedAt = Number(params[1]);
        row.recording_url = String(params[0]);
        row.is_completed = true;
        row.is_live = false;
        row.ended_at = endedAt;
        row.duration_minutes = row.started_at ? Math.max(1, Math.round((endedAt - Number(row.started_at)) / 60000)) : 0;
      }
      return { rows: [] };
    }
    if (sql.includes("SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1")) {
      const courseId = Number(params[0]);
      const rows = state.lectures.filter((l) => Number(l.course_id) === courseId);
      const maxOrder = rows.length ? Math.max(...rows.map((l) => Number(l.order_index) || 0)) : 0;
      return { rows: [{ next_order: maxOrder + 1 }] };
    }
    if (sql.includes("INSERT INTO lectures (course_id, title, description, video_url, video_type, duration_minutes, order_index, is_free_preview, section_title, created_at)")) {
      const [course_id, title, description, video_url, video_type, duration_minutes, order_index, is_free_preview, section_title, created_at] = params as any[];
      state.lectureId += 1;
      state.lectures.push({
        id: state.lectureId, course_id, title, description, video_url, video_type, duration_minutes, order_index, is_free_preview, section_title, created_at,
      });
      return { rows: [{ id: state.lectureId }] };
    }
    if (sql.includes("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1")) {
      const courseId = Number(params[0]);
      const course = state.courses.find((c) => Number(c.id) === courseId);
      if (course) course.total_lectures = state.lectures.filter((l) => Number(l.course_id) === courseId).length;
      return { rows: [] };
    }
    return { rows: [] };
  };

  return { query, state };
}

async function runRoute(fakeApp: FakeApp, method: "POST" | "GET", pathTemplate: string, req: any) {
  const handlers = fakeApp.routes.get(`${method} ${pathTemplate}`);
  if (!handlers) throw new Error(`Route not found: ${method} ${pathTemplate}`);

  let statusCode = 200;
  let jsonBody: any = null;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(payload: any) { jsonBody = payload; return this; },
  };

  let i = 0;
  const next = async () => {
    i += 1;
    if (handlers[i]) await handlers[i](req, res, next);
  };
  await handlers[0](req, res, next);
  return { statusCode, body: jsonBody };
}

describe("Cloudflare stream end auto-save", () => {
  beforeEach(() => {
    process.env.RUN_BACKGROUND_SCHEDULERS = "false";
    process.env.CF_STREAM_ACCOUNT_ID = "acct_123";
    process.env.CF_STREAM_API_TOKEN = "token_123";
    process.env.R2_BUCKET_NAME = "bucket_123";
  });

  it("creates lecture entry when stream ends", async () => {
    const app = new FakeApp();
    const db = createFakeDb({
      liveClasses: [{
        id: 7,
        title: "Physics Live",
        description: "Kinematics",
        course_id: 21,
        is_live: true,
        is_completed: false,
        started_at: Date.now() - 30 * 60 * 1000,
        cf_stream_uid: "live_input_uid_1",
      }],
      courses: [{ id: 21, total_lectures: 0 }],
    });

    const fetchMock = vi.fn(async (url: any, options?: any) => {
      const s = String(url);
      if (s.includes("/live_inputs/live_input_uid_1/videos")) {
        return new Response(JSON.stringify({ result: [{ uid: "recording_uid_1", status: "ready" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (s.includes("/downloads/default.mp4")) {
        return new Response("", { status: 404 });
      }
      if (s.includes("/live_inputs/live_input_uid_1") && options?.method === "DELETE") {
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    registerLiveStreamRoutes({
      app: app as any,
      db: db as any,
      requireAdmin: (_req: any, _res: any, next: () => void) => next(),
      recomputeAllEnrollmentsProgressForCourse: async () => {},
      getR2Client: async () => ({ send: async () => ({}) }),
    });

    const result = await runRoute(app, "POST", "/api/admin/live-classes/:id/stream/end", {
      params: { id: "7" },
      body: {},
    });

    expect(result.statusCode).toBe(200);
    expect(result.body?.success).toBe(true);
    expect(String(result.body?.recordingUrl || "")).toContain("videodelivery.net/recording_uid_1/manifest/video.m3u8");

    const updatedLive = db.state.liveClasses.find((r: any) => r.id === 7);
    expect(updatedLive.is_completed).toBe(true);
    expect(updatedLive.is_live).toBe(false);
    expect(String(updatedLive.recording_url || "")).toContain("videodelivery.net/recording_uid_1/manifest/video.m3u8");

    expect(db.state.lectures.length).toBe(1);
    expect(db.state.lectures[0].course_id).toBe(21);
    expect(String(db.state.lectures[0].video_url || "")).toContain("videodelivery.net/recording_uid_1/manifest/video.m3u8");
    expect(db.state.courses[0].total_lectures).toBe(1);

    vi.unstubAllGlobals();
  });
});

