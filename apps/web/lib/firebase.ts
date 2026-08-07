"use client";
/**
 * Compat barrel. Prefer:
 * - `@/lib/firebaseCore` for auth / App Check on the landing
 * - `@/lib/firebaseDb` for Firestore
 * - `@/lib/firebaseFunctions` for callables
 */
export { app, auth, ensureAppCheck, USE_EMULATORS, FIRESTORE_DATABASE_ID } from "./firebaseCore";
export { dbClient } from "./firebaseDb";
export { functions } from "./firebaseFunctions";
