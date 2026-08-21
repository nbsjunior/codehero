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
  // Criptografia que resiste a computador quantico. Categoria propria, e nao
  // um subconjunto de `weak-crypto`, porque o risco e de outra natureza: o
  // algoritmo nao esta quebrado HOJE. RSA e ECDH continuam corretos contra
  // qualquer atacante atual. O que muda e que o trafego capturado agora pode
  // ser decifrado depois, quando existir maquina para isso — o chamado
  // "colher agora, decifrar depois". Misturar as duas categorias esconderia
  // isso: um time que ja corrigiu MD5 acha que resolveu criptografia.
  | "quantum-safe"
  | "code-smell"
  /** Instruções de agente / LLM (OWASP LLM01 e higiene AIDLC/SKILL). */
  | "prompt-injection";

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
  | "log.write"
  | "ldap.search"
  | "xpath.evaluate"
  | "session.setAttribute";
