/**
 * Shared course content import (lectures, tests, materials, missions + folder metadata).
 * Used by bulk import-content API and legacy per-item import endpoints.
 */

export type DbExec = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export type ImportContentOptions = {
  lectures: boolean;
  tests: boolean;
  materials: boolean;
  missions: boolean;
};

export type ImportContentResult = {
  lectures: number;
  tests: number;
  materials: number;
  missions: number;
  foldersSynced: number;
};

export type ContentImportPreview = {
  lectures: number;
  tests: number;
  materials: number;
  missions: number;
};

function parseCourseId(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function fetchContentImportPreview(db: DbExec, sourceCourseId: number): Promise<ContentImportPreview> {
  const [lec, tst, mat, mis] = await Promise.all([
    db.query("SELECT COUNT(*)::int AS c FROM lectures WHERE course_id = $1", [sourceCourseId]),
    db.query("SELECT COUNT(*)::int AS c FROM tests WHERE course_id = $1", [sourceCourseId]),
    db.query("SELECT COUNT(*)::int AS c FROM study_materials WHERE course_id = $1", [sourceCourseId]),
    db.query("SELECT COUNT(*)::int AS c FROM daily_missions WHERE course_id = $1", [sourceCourseId]),
  ]);
  return {
    lectures: Number(lec.rows[0]?.c || 0),
    tests: Number(tst.rows[0]?.c || 0),
    materials: Number(mat.rows[0]?.c || 0),
    missions: Number(mis.rows[0]?.c || 0),
  };
}

/** Merge source course_folders into target (lecture / test / material types). */
export async function syncCourseFoldersFromSource(
  db: DbExec,
  targetCourseId: number,
  sourceCourseId: number
): Promise<number> {
  const countRes = await db.query(
    `SELECT COUNT(*)::int AS c FROM course_folders
     WHERE course_id = $1 AND type IN ('lecture', 'test', 'material')`,
    [sourceCourseId]
  );
  const folderCount = Number(countRes.rows[0]?.c || 0);
  if (folderCount === 0) return 0;

  const now = Date.now();
  await db.query(
    `INSERT INTO course_folders (course_id, name, type, is_hidden, created_at)
     SELECT $1::int, cf.name, cf.type, cf.is_hidden, $2::bigint
     FROM course_folders cf
     WHERE cf.course_id = $3::int
       AND cf.type IN ('lecture', 'test', 'material')
     ON CONFLICT (course_id, name, type)
     DO UPDATE SET is_hidden = EXCLUDED.is_hidden`,
    [targetCourseId, now, sourceCourseId]
  );
  return folderCount;
}

async function nextLectureOrderBase(db: DbExec, targetCourseId: number): Promise<number> {
  const maxRow = await db.query(
    `SELECT COALESCE(MAX(order_index), -1)::int AS m FROM lectures WHERE course_id = $1`,
    [targetCourseId]
  );
  return Number(maxRow.rows[0]?.m ?? -1) + 1;
}

async function nextTestOrderBase(db: DbExec, targetCourseId: number): Promise<number> {
  const maxRow = await db.query(
    `SELECT COALESCE(MAX(order_index), -1)::int AS m FROM tests WHERE course_id = $1`,
    [targetCourseId]
  );
  return Number(maxRow.rows[0]?.m ?? -1) + 1;
}

async function nextMaterialOrderBase(db: DbExec, targetCourseId: number): Promise<number> {
  const maxRow = await db.query(
    `SELECT COALESCE(MAX(order_index), -1)::int AS m FROM study_materials WHERE course_id = $1`,
    [targetCourseId]
  );
  return Number(maxRow.rows[0]?.m ?? -1) + 1;
}

export async function importLectureRow(db: DbExec, targetCourseId: number, l: any, orderIndex: number): Promise<void> {
  const now = Date.now();
  await db.query(
    `INSERT INTO lectures (
       course_id, title, description, transcript, video_url, video_type, pdf_url,
       duration_minutes, order_index, is_free_preview, section_title, download_allowed, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      targetCourseId,
      l.title,
      l.description || "",
      l.transcript || "",
      l.video_url,
      l.video_type || "youtube",
      l.pdf_url || null,
      l.duration_minutes || 0,
      orderIndex,
      !!l.is_free_preview,
      l.section_title || null,
      !!l.download_allowed,
      l.created_at || now,
    ]
  );
}

export async function importLecturesByIds(db: DbExec, targetCourseId: number, lectureIds: number[]): Promise<number> {
  if (lectureIds.length === 0) return 0;
  const rows = await db.query(
    `SELECT * FROM lectures WHERE id = ANY($1::int[]) ORDER BY COALESCE(order_index, 0) ASC, id ASC`,
    [lectureIds]
  );
  let orderBase = await nextLectureOrderBase(db, targetCourseId);
  const srcMin = rows.rows.length
    ? Math.min(...rows.rows.map((r: any) => Number(r.order_index ?? 0)))
    : 0;
  let count = 0;
  for (const l of rows.rows) {
    const relOrder = Number(l.order_index ?? 0) - srcMin;
    await importLectureRow(db, targetCourseId, l, orderBase + relOrder);
    count++;
  }
  return count;
}

export async function importAllLecturesFromCourse(
  db: DbExec,
  targetCourseId: number,
  sourceCourseId: number
): Promise<number> {
  const rows = await db.query(
    `SELECT * FROM lectures WHERE course_id = $1 ORDER BY COALESCE(order_index, 0) ASC, id ASC`,
    [sourceCourseId]
  );
  let orderBase = await nextLectureOrderBase(db, targetCourseId);
  const srcMin = rows.rows.length
    ? Math.min(...rows.rows.map((r: any) => Number(r.order_index ?? 0)))
    : 0;
  let count = 0;
  for (const l of rows.rows) {
    const relOrder = Number(l.order_index ?? 0) - srcMin;
    await importLectureRow(db, targetCourseId, l, orderBase + relOrder);
    count++;
  }
  return count;
}

export async function importTestRow(db: DbExec, targetCourseId: number, t: any, orderIndex: number): Promise<number> {
  const now = Date.now();
  const newTest = await db.query(
    `INSERT INTO tests (
       title, description, course_id, duration_minutes, total_marks, passing_marks,
       test_type, folder_name, total_questions, difficulty, order_index, is_published, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      t.title,
      t.description,
      targetCourseId,
      t.duration_minutes,
      t.total_marks,
      t.passing_marks ?? 35,
      t.test_type,
      t.folder_name || null,
      t.total_questions || 0,
      t.difficulty || "moderate",
      orderIndex,
      t.is_published !== false,
      t.created_at || now,
    ]
  );
  const newTestId = newTest.rows[0].id;
  const questions = await db.query(
    `SELECT * FROM questions WHERE test_id = $1 ORDER BY COALESCE(order_index, 0) ASC, id ASC`,
    [t.id]
  );
  for (const q of questions.rows) {
    await db.query(
      `INSERT INTO questions (
         test_id, question_text, option_a, option_b, option_c, option_d, correct_option,
         explanation, topic, difficulty, marks, negative_marks, order_index, image_url, solution_image_url
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        newTestId,
        q.question_text,
        q.option_a,
        q.option_b,
        q.option_c,
        q.option_d,
        q.correct_option,
        q.explanation,
        q.topic,
        q.difficulty,
        q.marks,
        q.negative_marks,
        q.order_index,
        q.image_url || null,
        q.solution_image_url || null,
      ]
    );
  }
  return 1;
}

export async function importTestsByIds(db: DbExec, targetCourseId: number, testIds: number[]): Promise<number> {
  if (testIds.length === 0) return 0;
  const rows = await db.query(
    `SELECT * FROM tests WHERE id = ANY($1::int[]) ORDER BY COALESCE(order_index, 0) ASC, id ASC`,
    [testIds]
  );
  let orderBase = await nextTestOrderBase(db, targetCourseId);
  const srcMin = rows.rows.length
    ? Math.min(...rows.rows.map((r: any) => Number(r.order_index ?? 0)))
    : 0;
  let count = 0;
  for (const t of rows.rows) {
    const relOrder = Number(t.order_index ?? 0) - srcMin;
    await importTestRow(db, targetCourseId, t, orderBase + relOrder);
    count++;
  }
  return count;
}

export async function importAllTestsFromCourse(
  db: DbExec,
  targetCourseId: number,
  sourceCourseId: number
): Promise<number> {
  const rows = await db.query(
    `SELECT * FROM tests WHERE course_id = $1 ORDER BY COALESCE(order_index, 0) ASC, id ASC`,
    [sourceCourseId]
  );
  let orderBase = await nextTestOrderBase(db, targetCourseId);
  const srcMin = rows.rows.length
    ? Math.min(...rows.rows.map((r: any) => Number(r.order_index ?? 0)))
    : 0;
  let count = 0;
  for (const t of rows.rows) {
    const relOrder = Number(t.order_index ?? 0) - srcMin;
    await importTestRow(db, targetCourseId, t, orderBase + relOrder);
    count++;
  }
  return count;
}

export async function importMaterialRow(db: DbExec, targetCourseId: number, m: any, orderIndex: number): Promise<void> {
  const now = Date.now();
  await db.query(
    `INSERT INTO study_materials (
       title, description, file_url, file_type, course_id, is_free, section_title, download_allowed, order_index, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      m.title,
      m.description || "",
      m.file_url,
      m.file_type || "pdf",
      targetCourseId,
      !!m.is_free,
      m.section_title || null,
      !!m.download_allowed,
      orderIndex,
      m.created_at || now,
    ]
  );
}

export async function importMaterialsByIds(db: DbExec, targetCourseId: number, materialIds: number[]): Promise<number> {
  if (materialIds.length === 0) return 0;
  const rows = await db.query(
    `SELECT * FROM study_materials WHERE id = ANY($1::int[]) ORDER BY COALESCE(order_index, 0) ASC, id ASC`,
    [materialIds]
  );
  let orderBase = await nextMaterialOrderBase(db, targetCourseId);
  const srcMin = rows.rows.length
    ? Math.min(...rows.rows.map((r: any) => Number(r.order_index ?? 0)))
    : 0;
  let count = 0;
  for (const m of rows.rows) {
    const relOrder = Number(m.order_index ?? 0) - srcMin;
    await importMaterialRow(db, targetCourseId, m, orderBase + relOrder);
    count++;
  }
  return count;
}

export async function importAllMaterialsFromCourse(
  db: DbExec,
  targetCourseId: number,
  sourceCourseId: number
): Promise<number> {
  const rows = await db.query(
    `SELECT * FROM study_materials WHERE course_id = $1 ORDER BY COALESCE(order_index, 0) ASC, id ASC`,
    [sourceCourseId]
  );
  let orderBase = await nextMaterialOrderBase(db, targetCourseId);
  const srcMin = rows.rows.length
    ? Math.min(...rows.rows.map((r: any) => Number(r.order_index ?? 0)))
    : 0;
  let count = 0;
  for (const m of rows.rows) {
    const relOrder = Number(m.order_index ?? 0) - srcMin;
    await importMaterialRow(db, targetCourseId, m, orderBase + relOrder);
    count++;
  }
  return count;
}

export async function importAllMissionsFromCourse(
  db: DbExec,
  targetCourseId: number,
  sourceCourseId: number
): Promise<number> {
  const rows = await db.query(
    `SELECT * FROM daily_missions WHERE course_id = $1 ORDER BY mission_date DESC, id ASC`,
    [sourceCourseId]
  );
  let count = 0;
  for (const m of rows.rows) {
    const questionsPayload =
      typeof m.questions === "string" ? m.questions : JSON.stringify(m.questions ?? []);
    await db.query(
      `INSERT INTO daily_missions (title, description, questions, mission_date, xp_reward, mission_type, course_id, folder_name)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)`,
      [
        m.title,
        m.description || "",
        questionsPayload,
        m.mission_date,
        m.xp_reward ?? 50,
        m.mission_type || "daily_drill",
        targetCourseId,
        m.folder_name || null,
      ]
    );
    count++;
  }
  return count;
}

export async function importCourseContent(
  db: DbExec,
  targetCourseId: number,
  sourceCourseId: number,
  options: ImportContentOptions
): Promise<ImportContentResult> {
  if (targetCourseId === sourceCourseId) {
    throw new Error("Source and target course must be different");
  }

  const targetExists = await db.query("SELECT id FROM courses WHERE id = $1 LIMIT 1", [targetCourseId]);
  if (targetExists.rows.length === 0) throw new Error("Target course not found");
  const sourceExists = await db.query("SELECT id FROM courses WHERE id = $1 LIMIT 1", [sourceCourseId]);
  if (sourceExists.rows.length === 0) throw new Error("Source course not found");

  const needsFolders = options.lectures || options.tests || options.materials;
  let foldersSynced = 0;
  if (needsFolders) {
    foldersSynced = await syncCourseFoldersFromSource(db, targetCourseId, sourceCourseId);
  }

  const result: ImportContentResult = {
    lectures: 0,
    tests: 0,
    materials: 0,
    missions: 0,
    foldersSynced,
  };

  if (options.lectures) {
    result.lectures = await importAllLecturesFromCourse(db, targetCourseId, sourceCourseId);
  }
  if (options.tests) {
    result.tests = await importAllTestsFromCourse(db, targetCourseId, sourceCourseId);
  }
  if (options.materials) {
    result.materials = await importAllMaterialsFromCourse(db, targetCourseId, sourceCourseId);
  }
  if (options.missions) {
    result.missions = await importAllMissionsFromCourse(db, targetCourseId, sourceCourseId);
  }

  return result;
}

export function parseImportContentOptions(body: any): ImportContentOptions | null {
  const o = body?.options ?? body;
  const lectures = o?.lectures === true;
  const tests = o?.tests === true;
  const materials = o?.materials === true;
  const missions = o?.missions === true;
  if (!lectures && !tests && !materials && !missions) return null;
  return { lectures, tests, materials, missions };
}

export { parseCourseId };
