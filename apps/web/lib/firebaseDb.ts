"use client";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { app, FIRESTORE_DATABASE_ID, USE_EMULATORS } from "./firebaseCore";

export const dbClient =
  FIRESTORE_DATABASE_ID && FIRESTORE_DATABASE_ID !== "(default)"
    ? getFirestore(app, FIRESTORE_DATABASE_ID)
    : getFirestore(app);

let connected = false;
if (USE_EMULATORS && typeof window !== "undefined" && !connected) {
  connected = true;
  connectFirestoreEmulator(dbClient, "127.0.0.1", 8080);
}
