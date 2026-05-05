import { Alert, Platform } from "react-native";
import { router } from "expo-router";

/** Shown on the profile setup screen (banner + save confirmation). */
export const PROFILE_PERMANENT_FIELDS_NOTICE =
  "Your name, date of birth, and email are permanent after you save and cannot be changed later. Please enter them carefully.";

export const PROFILE_INCOMPLETE_ALERT_TITLE = "Complete your profile first";

export const PROFILE_INCOMPLETE_ALERT_MESSAGE =
  "Before using the app, please finish your profile. The details you enter are permanent and cannot be changed later—double-check before saving.";

export const PROFILE_SAVE_CONFIRM_TITLE = "Save permanent details?";

export const PROFILE_SAVE_CONFIRM_MESSAGE =
  "You will not be able to change your name, date of birth, or email after this. Make sure everything is correct, then continue.";

/** Call after successful sign-in when profile is incomplete; then routes to profile setup. */
export function navigateToProfileSetupWithNotice(): void {
  const go = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      (window as any).__allowProfileSetupOnce = "1";
    }
    router.replace("/profile-setup");
  };
  Alert.alert(PROFILE_INCOMPLETE_ALERT_TITLE, PROFILE_INCOMPLETE_ALERT_MESSAGE, [{ text: "Continue", onPress: go }]);
}
