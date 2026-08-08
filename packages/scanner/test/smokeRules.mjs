import { RULES } from "@codehero/contracts";
import { analyzeFile } from "@codehero/engine";

const r = RULES.find((r) => r.id === "HERO-SEC-0798-hardcoded-secret");

const cases = [
  { code: 'const password = "senha123";', expected: 0, note: "9 chars, regex pede 12+" },
  { code: 'const password = "senha12345678";', expected: 1, note: "12+ chars" },
  { code: 'const apiKey = "sk_live_1234567890abcdef";', expected: 1, note: "api_key pattern" },
  { code: 'const secret = process.env.SECRET;', expected: 0, note: "env var excluded" },
  { code: 'const password = "example123456";', expected: 0, note: "example excluded" },
];

let pass = 0;
for (const c of cases) {
  const findings = analyzeFile({ file: "t.ts", source: c.code, rules: [r] });
  const ok = findings.length === c.expected;
  if (ok) pass++;
  console.log(ok ? "✅" : "❌", c.note, `(${findings.length}/${c.expected})`);
}
console.log(`\n${pass}/${cases.length} passaram`);
