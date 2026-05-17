/** Coerce Postgres boolean-ish values from API rows. */
export function isTruthyDbFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}
