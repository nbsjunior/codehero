"use client";
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

// Emulators only when explicitly requested. Otherwise use env-configured
// Firebase project with CodeHero's segregated Firestore DB + storage bucket.
const USE_EMULATORS = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

/** Trim + drop accidental KEY=value / multiline pollution from CI secret sync bugs. */
function cleanEnv(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  let v = raw.replace(/^\uFEFF/, "").trim();
  if (!v) return undefined;
  // If a whole .env line leaked into the secret, keep only the value after the last "=" on first line.
  const firstLine = v.split(/\r?\n/, 1)[0]!.trim();
  if (/^[A-Z][A-Z0-9_]*=/.test(firstLine) && !firstLine.includes("\n")) {
    const eq = firstLine.indexOf("=");
    const after = firstLine.slice(eq + 1).trim();
    // Prefer the last non-empty line when stdin was "KEY=val\nval"
    const lines = v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const last = lines[lines.length - 1]!;
    if (lines.length > 1 && !/^[A-Z][A-Z0-9_]*=/.test(last)) v = last;
    else v = after || firstLine;
  } else if (v.includes("\n") || v.includes("\r")) {
    const lines = v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    v = lines[lines.length - 1] ?? v;
  }
  return v || undefined;
}

function requireClean(name: string, raw: string | undefined, fallback?: string): string | undefined {
  const v = cleanEnv(raw) ?? fallback;
  if (v && /[\r\n]/.test(v)) {
    throw new Error(`${name} contains newlines — fix the GitHub Actions secret / .env.local value.`);
  }
  return v;
}

const FIRESTORE_DATABASE_ID =
  requireClean("NEXT_PUBLIC_FIRESTORE_DATABASE_ID", process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID) ||
  (USE_EMULATORS ? "(default)" : "codehero");

const firebaseConfig = {
  apiKey: requireClean(
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    USE_EMULATORS ? "demo-api-key" : undefined,
  ),
  authDomain: requireClean("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
  projectId: requireClean(
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    USE_EMULATORS ? "codehero-dev" : undefined,
  ),
  storageBucket: requireClean(
    "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    USE_EMULATORS ? "codehero-dev.appspot.com" : undefined,
  ),
  messagingSenderId: requireClean(
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    USE_EMULATORS ? "123456789012" : undefined,
  ),
  appId: requireClean(
    "NEXT_PUBLIC_FIREBASE_APP_ID",
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    USE_EMULATORS ? "demo-app-id" : undefined,
  ),
  measurementId: requireClean(
    "NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID",
    process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  ),
};

if (!firebaseConfig.apiKey || !firebaseConfig.appId || !firebaseConfig.projectId) {
  throw new Error(
    "Missing Firebase web config. Copy apps/web/.env.local.example → .env.local " +
      "or set NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true for local emulators.",
  );
}

if (firebaseConfig.projectId.includes("=") || /VITE_|NEXT_PUBLIC_/.test(firebaseConfig.projectId)) {
  throw new Error(
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID looks polluted (contains a KEY= prefix). " +
      "Set the secret/env to the bare project id only.",
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
