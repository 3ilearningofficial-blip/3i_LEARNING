import { REQUIRED_COLUMNS, REQUIRED_TABLES } from "./schema-readiness-contract";

type Queryable = {
  query: (
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: Array<Record<string, any>> }>;
};

export async function checkDatabaseReadiness(db: Queryable): Promise<{
  ok: boolean;
  checks: Record<string, boolean>;
  missingTables: string[];
  missingColumns: string[];
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

  return {
    ok: missingTables.length === 0 && missingColumns.length === 0,
    checks: {
      db: true,
      tables: missingTables.length === 0,
      columns: missingColumns.length === 0,
    },
    missingTables,
    missingColumns,
  };
}

