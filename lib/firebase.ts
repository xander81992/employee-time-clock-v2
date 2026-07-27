import { FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import {
  Auth,
  browserLocalPersistence,
  getAuth,
  setPersistence
} from "firebase/auth";
import { Firestore, getFirestore } from "firebase/firestore";

type FirebaseServices = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
};

let cachedServices: FirebaseServices | null = null;
let persistenceConfigured = false;

function readFirebaseConfig() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
  };

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase web configuration: ${missing.join(", ")}`
    );
  }

  return config as Record<keyof typeof config, string>;
}

export function getFirebaseServices(): FirebaseServices {
  if (typeof window === "undefined") {
    throw new Error("Firebase client services are only available in the browser.");
  }

  if (cachedServices) {
    return cachedServices;
  }

  const app = getApps().length > 0
    ? getApp()
    : initializeApp(readFirebaseConfig());

  const auth = getAuth(app);
  const db = getFirestore(app);

  cachedServices = { app, auth, db };
  return cachedServices;
}

export async function configureAuthPersistence(): Promise<void> {
  if (persistenceConfigured) {
    return;
  }

  const { auth } = getFirebaseServices();
  await setPersistence(auth, browserLocalPersistence);
  persistenceConfigured = true;
}
