import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, PhoneAuthProvider, signInWithCredential, ConfirmationResult, Auth } from "firebase/auth";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required Firebase env: ${name}`);
  }
  return value;
}

const firebaseProjectId = requireEnv("EXPO_PUBLIC_FIREBASE_PROJECT_ID");

const firebaseConfig = {
  apiKey: requireEnv("EXPO_PUBLIC_FIREBASE_API_KEY"),
  projectId: firebaseProjectId,
  authDomain: `${firebaseProjectId}.firebaseapp.com`,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
auth.useDeviceLanguage();

export { auth, RecaptchaVerifier, signInWithPhoneNumber, PhoneAuthProvider, signInWithCredential };
export type { ConfirmationResult, Auth };
