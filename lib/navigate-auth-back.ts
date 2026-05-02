import { router } from "expo-router";

/** Prefer history back; if stack is empty (e.g. opened login via replace), go to welcome. */
export function navigateBackFromAuth() {
  if (router.canGoBack()) router.back();
  else router.replace("/welcome");
}
