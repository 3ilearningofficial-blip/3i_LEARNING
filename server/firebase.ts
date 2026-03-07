import * as admin from "firebase-admin";

let firebaseApp: admin.app.App | null = null;

export function getFirebaseAdmin(): admin.app.App {
  if (firebaseApp) return firebaseApp;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
  }

  let serviceAccount: admin.ServiceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON format");
  }

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });

  return firebaseApp;
}

export async function verifyFirebaseToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
  const app = getFirebaseAdmin();
  return admin.auth(app).verifyIdToken(idToken);
}
