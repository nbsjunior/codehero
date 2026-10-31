/**
 * Shared CORS / App Check toggles for HTTP + callable surfaces.
 */
export const PORTAL_ORIGINS = [
  "https://codehero.web.app",
  "https://codehero.firebaseapp.com",
  "http://localhost:3000",
  "http://localhost:5000",
  "http://127.0.0.1:3000",
];

/** Restrict browser CORS; CI/server clients are unaffected (no Origin). */
export const httpCors = PORTAL_ORIGINS;

/**
 * When true, callables with `enforceAppCheck: true` reject missing App Check tokens.
 * Set ENFORCE_APP_CHECK=true in Functions runtime (and NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY on web).
 */
export const enforceAppCheck = process.env.ENFORCE_APP_CHECK === "true";

/** Default options for browser-facing mutating callables. */
export const portalCallableOpts = {
  cors: httpCors,
  enforceAppCheck,
} as const;

/**
 * Callables leves do portal (auth, flags, resumo). Região perto do usuário BR;
 * minInstances evita cold start no primeiro clique. Functions que fazem fan-out
 * no Firestore ficam em us-central1 (perto dos dados).
 */
export const PORTAL_WARM_REGION = "southamerica-east1" as const;

export const portalWarmOpts = {
  cors: httpCors,
  enforceAppCheck,
  region: PORTAL_WARM_REGION,
  minInstances: 1,
  memory: "256MiB",
} as const;
