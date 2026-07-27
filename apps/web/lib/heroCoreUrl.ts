"use client";
import {
  CODEHERO_PUBLIC_API_BASE,
  CODEHERO_FUNCTIONS_BASE_URL,
} from "@codehero/contracts";

// Base URL for CodeHero HTTP APIs (ingest, rules, issues) — what CI, the local
// scanner, and the MCP server call. Customers always see the portal `/api`
// gateway; Cloud Functions URLs stay internal.
const USE_EMULATORS = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";
const EMULATOR_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "codehero-dev";

export const HERO_CORE_URL = USE_EMULATORS
  ? `http://127.0.0.1:5001/${EMULATOR_PROJECT_ID}/us-central1`
  : CODEHERO_PUBLIC_API_BASE;

/** @deprecated Internal only — prefer HERO_CORE_URL / CODEHERO_PUBLIC_API_BASE. */
export const HERO_FUNCTIONS_URL = CODEHERO_FUNCTIONS_BASE_URL;
