import { FirebaseError } from "firebase/app";

export function friendlyFirebaseError(error: unknown): string {
  if (!(error instanceof FirebaseError)) {
    return error instanceof Error ? error.message : "An unexpected error occurred.";
  }

  switch (error.code) {
    case "auth/invalid-api-key":
    case "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
      return "The Firebase Web API key in Vercel is incorrect.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/operation-not-allowed":
      return "Enable Email/Password and Anonymous sign-in in Firebase Authentication.";
    case "auth/unauthorized-domain":
      return "Add this Vercel domain to Firebase Authentication authorized domains.";
    case "auth/too-many-requests":
      return "Too many login attempts. Wait a few minutes and try again.";
    case "permission-denied":
    case "firestore/permission-denied":
      return "Firestore blocked this request. Publish the included firestore.rules file.";
    case "unavailable":
    case "firestore/unavailable":
      return "Firebase is temporarily unavailable. Try again shortly.";
    default:
      return `${error.code}: ${error.message}`;
  }
}
