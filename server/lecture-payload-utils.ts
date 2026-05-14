/** Remove internal-only fields before sending lecture rows to clients. */
export function sanitizeLectureRowForClient<T extends Record<string, unknown>>(row: T): Omit<T, "transcript"> & { transcript?: never } {
  if (!row || typeof row !== "object") return row as any;
  const { transcript: _omit, ...rest } = row as T & { transcript?: unknown };
  return rest as any;
}
