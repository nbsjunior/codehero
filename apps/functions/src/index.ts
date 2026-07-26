import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

export { ingestAnalysis } from "./ingest.ts";
export { generateSddSpec } from "./sdd.ts";
export { provisionProject } from "./provision.ts";
export { listIssues, sddSpec } from "./query.ts";
