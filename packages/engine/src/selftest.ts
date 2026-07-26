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
