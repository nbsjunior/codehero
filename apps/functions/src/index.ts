import { setGlobalOptions } from "firebase-functions/v2";

// Pin segregated resources before any Admin SDK import side-effects.
process.env.FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID?.trim() || "codehero";
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET?.trim() || "apponti-codehero";
process.env.GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

export { ingestAnalysis } from "./ingest.ts";
export { generateSddSpec } from "./sdd.ts";
export { provisionProject } from "./provision.ts";
export { listIssues, sddSpec } from "./query.ts";
export { flagIssueFeedback, submitFixResult } from "./feedback.ts";
export { adminListAllProjects, checkPlatformAdmin } from "./admin.ts";
export { ruleforgeDaily, runRuleforgeDaily } from "./ruleforgeDaily.ts";
export { submitDressCode, listDressCodes } from "./dressCode.ts";
export { previewRepoScan } from "./previewScan.ts";
export { registerAccount } from "./registerAccount.ts";
export { rotateIngestToken } from "./tokens.ts";
export { getActiveRules, getActiveRulesCallable } from "./rulesApi.ts";
