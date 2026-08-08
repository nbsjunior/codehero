import { RULES } from "@codehero/contracts";
import { analyzeFile } from "@codehero/engine";

const samples = [
  { id: "SONAR-js-S1134", code: "// TODO: fix", file: "t.ts" },
  { id: "SONAR-js-S1442", code: 'alert("x")', file: "t.ts" },
  { id: "SONAR-py-S1134", code: "# TODO: fix", file: "t.py" },
  { id: "SONAR-java-S1134", code: "// TODO: fix", file: "t.java" },
  { id: "SONAR-cs-S1134", code: "// TODO: fix", file: "t.cs" },
  { id: "SONAR-cobol-S1134", code: "      *> TODO: fix", file: "t.cbl" },
];

for (const s of samples) {
  const rule = RULES.find((r) => r.id === s.id);
  if (!rule) {
    console.log("❌", s.id, "não encontrada");
    continue;
  }
  const f = analyzeFile({ file: s.file, source: s.code, rules: [rule] });
  console.log(f.length > 0 ? "✅" : "❌", s.id, f.length);
}
