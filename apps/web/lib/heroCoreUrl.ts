// Base URL for CodeHero's Cloud Functions HTTP endpoints (listIssues, sddSpec,
// ingestAnalysis, submitFixResult) — what CI, the local scanner, and the MCP
// server all call. Mirrors the emulator-vs-production branch in lib/firebase.ts.
const USE_EMULATORS = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";
const EMULATOR_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "codehero-dev";

export const HERO_CORE_URL = USE_EMULATORS
  ? `http://127.0.0.1:5001/${EMULATOR_PROJECT_ID}/us-central1`
  : "https://us-central1-apponti.cloudfunctions.net";
