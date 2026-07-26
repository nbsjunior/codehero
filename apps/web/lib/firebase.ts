"use client";
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

// Emulators only when explicitly requested. Otherwise use env-configured
// Firebase project with CodeHero's segregated Firestore DB + storage bucket.
const USE_EMULATORS = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

const FIRESTORE_DATABASE_ID =
  process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID?.trim() || (USE_EMULATORS ? "(default)" : "codehero");

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? (USE_EMULATORS ? "demo-api-key" : undefined),
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? (USE_EMULATORS ? "codehero-dev" : undefined),
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? (USE_EMULATORS ? "codehero-dev.appspot.com" : undefined),
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? (USE_EMULATORS ? "123456789012" : undefined),
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? (USE_EMULATORS ? "demo-app-id" : undefined),
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.appId || !firebaseConfig.projectId) {
  throw new Error(
    "Missing Firebase web config. Copy apps/web/.env.local.example → .env.local " +
      "or set NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true for local emulators.",
  );
}

const app: FirebaseApp = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const dbClient =
  FIRESTORE_DATABASE_ID && FIRESTORE_DATABASE_ID !== "(default)"
    ? getFirestore(app, FIRESTORE_DATABASE_ID)
    : getFirestore(app);
export const functions = getFunctions(app, "us-central1");

let emulatorsConnected = false;
if (USE_EMULATORS && typeof window !== "undefined" && !emulatorsConnected) {
  emulatorsConnected = true;
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(dbClient, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
