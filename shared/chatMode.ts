export type ChatMode = "public" | "private" | "disabled";

/** Coerce API/UI values to a known chat mode (default public). */
export function normalizeChatMode(raw: unknown): ChatMode {
  const v = String(raw || "")
    .toLowerCase()
    .trim();
  if (v === "private") return "private";
  if (v === "disabled") return "disabled";
  return "public";
}

/** Reject unknown modes on write; returns null when invalid. */
export function parseChatModeInput(raw: unknown): ChatMode | null {
  if (raw === undefined || raw === null) return null;
  const v = String(raw).toLowerCase().trim();
  if (v === "public" || v === "private" || v === "disabled") return v;
  return null;
}
