// Shared async helpers used by route handlers to bound external I/O (R2, HTTP, etc.)
// so a slow upstream cannot pin a request long enough for the proxy to return its
// own 504 (which strips CORS headers and surfaces as a confusing browser error).

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isTimeoutError(err: unknown): boolean {
  return /timed out/i.test(String((err as { message?: string } | null | undefined)?.message ?? ""));
}
