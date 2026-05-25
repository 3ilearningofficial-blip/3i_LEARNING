/** Counts active SSE handlers that hold a dedicated LISTEN client (live chat + support). */

let activeListenStreams = 0;

export function sseListenCapFromPoolMax(poolMax: number): number {
  const poolClamp = Math.max(5, poolMax);
  const fromEnv = parseInt(process.env.PG_LISTEN_SSE_MAX_CONCURRENT || "", 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.min(fromEnv, poolClamp);
  }
  return poolClamp;
}

export function tryAcquireSseListen(poolMax: number): boolean {
  const cap = sseListenCapFromPoolMax(poolMax);
  if (activeListenStreams >= cap) return false;
  activeListenStreams += 1;
  return true;
}

export function releaseSseListen(): void {
  activeListenStreams = Math.max(0, activeListenStreams - 1);
}
