/** Shared enums for L2 taint rules — kept in contracts so rules.ts stays typed. */

/** Categories aligned with GitHub AI-powered security detections (complementary to CodeQL). */
export type SecurityCategory =
  | "string-injection"
  | "weak-crypto"
  | "broken-access-control"
  | "sensitive-data-exposure"
  | "security-misconfiguration"
  | "authentication-failures"
  | "data-integrity"
  | "ssrf"
  | "supply-chain"
  | "code-smell";

export type TaintSourceKind =
  | "http.param"
  | "http.body"
  | "http.header"
  | "process.argv"
  | "process.env"
  | "filesystem.read"
  | "user.input";

export type TaintSinkKind =
  | "eval"
  | "function_ctor"
  | "sql.execute"
  | "html.innerHTML"
  | "html.documentWrite"
  | "child_process"
  | "network.request"
  | "fs.path"
  | "http.redirect"
  | "object.merge"
  | "log.write";
