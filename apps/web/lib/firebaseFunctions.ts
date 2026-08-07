"use client";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { app, USE_EMULATORS } from "./firebaseCore";

export const functions = getFunctions(app, "us-central1");

let connected = false;
if (USE_EMULATORS && typeof window !== "undefined" && !connected) {
  connected = true;
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
