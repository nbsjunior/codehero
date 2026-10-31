"use client";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { app, USE_EMULATORS } from "./firebaseCore";

/** Functions pesadas / HTTP / ingest — perto do Firestore (us-central1). */
export const functions = getFunctions(app, "us-central1");

/** Callables leves do portal (login, admin check, flags) — perto do usuário BR. */
export const functionsBr = getFunctions(app, "southamerica-east1");

let connected = false;
if (USE_EMULATORS && typeof window !== "undefined" && !connected) {
  connected = true;
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectFunctionsEmulator(functionsBr, "127.0.0.1", 5001);
}
