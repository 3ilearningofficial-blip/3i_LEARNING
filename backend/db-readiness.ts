import { REQUIRED_COLUMNS, REQUIRED_TABLES, REQUIRED_UNIQUE_INDEX_SPECS } from "./schema-readiness-contract";

type Queryable = {
  query: (
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: Array<Record<string, any>> }>;
};

function parseIndexColumns(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((c) => String(c));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    // pg can return array_agg(name) as "{col1,col2}" string depending on type parser
    // setup. Normalize both "{a,b}" and "a,b" formats.
    const inner =
      trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed.slice(1, -1) : trimmed;
    if (!inner) return [];
    return inner
      .split(",")
      .map((part) => part.replace(/^"+|"+$/g, "").trim())
      .filter(Boolean);
  }
  return [];
}

export async function checkDatabaseReadiness(db: Queryable): Promise<{
  ok: boolean;
  checks: Record<string, boolean>;
  missingTables: string[];
  missingColumns: string[];
  missingIndexes: string[];
}> {
  await db.query("SELECT 1");

  const tableRows = await db.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'`
  );
  const presentTables = new Set(tableRows.rows.map((row) => String(row.table_name)));
  const missingTables = REQUIRED_TABLES.filter((table) => !presentTables.has(table));

  const columnRows = await db.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
    [Object.keys(REQUIRED_COLUMNS)]
  );

  const presentColumns = new Map<string, Set<string>>();
  for (const row of columnRows.rows) {
    const tableName = String(row.table_name);
    const columnName = String(row.column_name);
    if (!presentColumns.has(tableName)) presentColumns.set(tableName, new Set());
    presentColumns.get(tableName)!.add(columnName);
  }

  const missingColumns: string[] = [];
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const set = presentColumns.get(table) ?? new Set<string>();
    for (const column of columns) {
      if (!set.has(column)) {
        missingColumns.push(`${table}.${column}`);
      }
    }
  }

  const indexRows = await db.query(
    `SELECT
       t.relname AS table_name,
       i.indisunique AS is_unique,
       ARRAY_AGG(a.attname ORDER BY k.ordinality) AS cols
     FROM pg_index i
     JOIN pg_class t ON t.oid = i.indrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
     WHERE n.nspname = 'public'
     GROUP BY t.relname, i.indisunique, i.indexrelid`
  );
  const presentUniqueKeys = new Set<string>();
  for (const row of indexRows.rows) {
    if (!row.is_unique) continue;
    const table = String(row.table_name);
    const cols = parseIndexColumns(row.cols);
    presentUniqueKeys.add(`${table}|${cols.join(",")}`);
  }
  const missingIndexes = REQUIRED_UNIQUE_INDEX_SPECS
    .map((s) => `${s.table}|${s.columns.join(",")}`)
    .filter((sig) => !presentUniqueKeys.has(sig));

  return {
    ok: missingTables.length === 0 && missingColumns.length === 0 && missingIndexes.length === 0,
    checks: {
      db: true,
      tables: missingTables.length === 0,
      columns: missingColumns.length === 0,
      indexes: missingIndexes.length === 0,
    },
    missingTables,
    missingColumns,
    missingIndexes,
  };
}

