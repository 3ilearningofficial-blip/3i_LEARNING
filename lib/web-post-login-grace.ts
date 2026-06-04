export const WEB_POST_LOGIN_HOME_GRACE_KEY = "__3i_post_login_home_grace_until";

export function markWebPostLoginHomeGrace(durationMs = 15_000): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(WEB_POST_LOGIN_HOME_GRACE_KEY, String(Date.now() + durationMs));
  } catch {
    /* ignore */
  }
}

export function getWebPostLoginHomeGraceRemainingMs(): number {
  if (typeof window === "undefined") return 0;
  try {
    const until = Number(window.sessionStorage.getItem(WEB_POST_LOGIN_HOME_GRACE_KEY) || "0");
    if (!Number.isFinite(until) || until <= Date.now()) {
      window.sessionStorage.removeItem(WEB_POST_LOGIN_HOME_GRACE_KEY);
      return 0;
    }
    return until - Date.now();
  } catch {
    return 0;
  }
}

export function clearWebPostLoginHomeGrace(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(WEB_POST_LOGIN_HOME_GRACE_KEY);
  } catch {
    /* ignore */
  }
}
