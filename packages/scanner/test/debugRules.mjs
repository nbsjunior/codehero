import { RULES } from "@codehero/contracts";
import { analyzeFile } from "@codehero/engine";

const tests = [
  {
    id: "HERO-SEC-0918-ssrf",
    code: "fetch(`https://${userProvidedUrl}/api`)",
    file: "t.ts",
  },
  {
    id: "HERO-SEC-0601-open-redirect",
    code: "res.redirect(`https://${userUrl}`)",
    file: "t.ts",
  },
  {
    id: "HERO-SEC-0330-insecure-random",
    code: "const token = Math.random().toString(36)",
    file: "t.ts",
  },
  {
    id: "HERO-SEC-0089-dynamic-sql-tsql",
    code: "SET @sql = 'SELECT * FROM ' + @table",
    file: "t.sql",
  },
];

for (const t of tests) {
  const rule = RULES.find((r) => r.id === t.id);
  const f = analyzeFile({ file: t.file, source: t.code, rules: [rule] });
  console.log(f.length > 0 ? "✅" : "❌", t.id, f.length);
}
