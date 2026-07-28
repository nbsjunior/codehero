/**
 * Self-test for AST + taint engines. Run: npm run test -w @codehero/engine
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HeroRule } from "@codehero/contracts";
import { analyzeFile, analyzeFileCached } from "./analyze.ts";
import { ScanCache } from "./cache.ts";

const base = {
  languages: ["javascript"] as HeroRule["languages"],
  severity: "CRITICAL" as const,
  type: "VULNERABILITY" as const,
  remediationEffortMin: 20,
  cwe: ["CWE-89"],
  owasp: ["A03:2021-Injection"],
  message: "test",
  sddTemplateId: "sdd.sqli.parametrize",
  pattern: { regex: "a^" }, // never matches — force deep engines
};

const taintSqli: HeroRule = {
  ...base,
  id: "TEST-TAINT-SQLI",
  name: "TaintSqli",
  taint: {
    sources: ["http.param", "http.body"],
    sinks: ["sql.execute"],
    sanitizers: ["escape"],
  },
};

const taintXss: HeroRule = {
  ...base,
  id: "TEST-TAINT-XSS",
  name: "TaintXss",
  cwe: ["CWE-79"],
  taint: {
    sources: ["http.param"],
    sinks: ["html.innerHTML", "html.documentWrite"],
  },
};

const astEval: HeroRule = {
  ...base,
  id: "TEST-AST-EVAL",
  name: "AstEval",
  cwe: ["CWE-95"],
  pattern: { regex: "a^" },
  ast: {
    kind: "call",
    callees: ["eval", "Function"],
    requiresNonLiteralArg: true,
  },
};

function run(name: string, source: string, rules: HeroRule[], expectIds: string[]) {
  const findings = analyzeFile({
    file: "t.js",
    source,
    language: "javascript",
    rules,
  });
  const ids = [...new Set(findings.map((f) => f.ruleId))];
  assert.deepEqual(ids.sort(), [...expectIds].sort(), `${name}: got ${ids.join(",") || "(none)"}`);
  console.log(`  ✓ ${name}`);
}

console.log("engine selftest");

run(
  "taint SQL injection cross-statement",
  `
    const q = req.query.id;
    db.query("SELECT * FROM users WHERE id = " + q);
  `,
  [taintSqli],
  ["TEST-TAINT-SQLI"],
);

run(
  "taint XSS innerHTML",
  `
    const name = req.params.name;
    el.innerHTML = "<h1>" + name + "</h1>";
  `,
  [taintXss],
  ["TEST-TAINT-XSS"],
);

run(
  "taint inter-procedural same file",
  `
    function run(sql) {
      connection.execute(sql);
    }
    const id = req.body.id;
    run("SELECT " + id);
  `,
  [taintSqli],
  ["TEST-TAINT-SQLI"],
);

// Fonte usada INLINE no sink, sem passar por variável — a forma mais comum
// em código real, e que antes passava batido: exprTaint só reconhecia
// variáveis já contaminadas, nunca a expressão de fonte em si.
run(
  "taint fonte inline no sink",
  `db.query(req.query.id);`,
  [taintSqli],
  ["TEST-TAINT-SQLI"],
);

run(
  "taint fonte inline em template literal",
  "db.query(`SELECT * FROM t WHERE id = ${req.query.id}`);",
  [taintSqli],
  ["TEST-TAINT-SQLI"],
);

// Contrapartida do teste acima: reconhecer a fonte inline não pode custar o
// sanitizador. Antes, exprTaint propagava taint dos argumentos de qualquer
// chamada sem olhar o callee.
run("taint sanitizador inline limpa", `db.query(escape(req.query.id));`, [taintSqli], []);

// Cadeia de 2 saltos: o taint precisa atravessar DUAS fronteiras de função.
// Com seeding de um passo só, o parâmetro de `outer` era semeado a partir do
// escopo de módulo, mas `inner` nunca recebia nada — o sink passava batido.
run(
  "taint inter-procedural 2 hops",
  `
    function inner(sql) {
      connection.execute(sql);
    }
    function outer(v) {
      inner("SELECT " + v);
    }
    const id = req.body.id;
    outer(id);
  `,
  [taintSqli],
  ["TEST-TAINT-SQLI"],
);

// 3 saltos + ordem de declaração invertida (o chamador aparece antes do
// chamado), para garantir que a convergência não depende da ordem do arquivo.
run(
  "taint inter-procedural 3 hops, ordem invertida",
  `
    function a(x) { b(x); }
    function b(y) { c(y); }
    function c(z) { db.query(z); }
    a(req.query.q);
  `,
  [taintSqli],
  ["TEST-TAINT-SQLI"],
);

// Recursão não pode fazer o ponto-fixo divergir.
run(
  "taint inter-procedural recursivo termina",
  `
    function walk(node) {
      if (node) walk(node);
      db.query(node);
    }
    walk(req.query.n);
  `,
  [taintSqli],
  ["TEST-TAINT-SQLI"],
);

run(
  "ast eval non-literal",
  `
    const code = userInput;
    eval(code);
  `,
  [astEval],
  ["TEST-AST-EVAL"],
);

run(
  "ast eval literal is clean",
  `eval("1+1");`,
  [astEval],
  [],
);

run(
  "safe parameterized — no finding",
  `
    const id = req.query.id;
    db.query("SELECT * FROM users WHERE id = ?", [id]);
  `,
  [taintSqli],
  [],
);

const taintPath: HeroRule = {
  ...base,
  id: "TEST-TAINT-PATH",
  name: "TaintPath",
  cwe: ["CWE-22"],
  taint: {
    sources: ["http.param"],
    sinks: ["fs.path"],
  },
};

run(
  "taint path traversal via CFG",
  `
    const file = req.params.file;
    fs.readFile(file);
  `,
  [taintPath],
  ["TEST-TAINT-PATH"],
);

run(
  "taint open redirect",
  `
    const url = req.query.next;
    res.redirect(url);
  `,
  [
    {
      ...base,
      id: "TEST-TAINT-REDIR",
      name: "TaintRedir",
      cwe: ["CWE-601"],
      taint: { sources: ["http.param"], sinks: ["http.redirect"] },
    },
  ],
  ["TEST-TAINT-REDIR"],
);

{
  const dir = mkdtempSync(join(tmpdir(), "codehero-cache-"));
  try {
    const cache = new ScanCache(dir);
    const opts = {
      file: "cache.js",
      source: `const q = req.query.id; db.query("SELECT " + q);`,
      language: "javascript" as const,
      rules: [taintSqli],
    };
    const first = analyzeFileCached(opts, cache);
    assert.equal(first.cacheHit, false);
    assert.equal(first.findings.length, 1);
    const second = analyzeFileCached(opts, cache);
    assert.equal(second.cacheHit, true);
    assert.equal(second.findings.length, 1);
    const third = analyzeFileCached(
      { ...opts, rules: [{ ...taintSqli, id: "TEST-TAINT-SQLI-V2" }] },
      cache,
    );
    assert.equal(third.cacheHit, false, "ruleset change must miss cache");
    console.log("  ✓ incremental cache hit + ruleset invalidation");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("all engine selftests passed");
