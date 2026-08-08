// Testa se regras de TODO/comentário têm scope adequado.
// Usa matchPattern direto (sem tree-sitter) para ficar rápido.
import { RULES, matchPattern, lexicalProfileFor } from "@codehero/contracts";

const suspeitas = RULES.filter((r) => {
  const re = r.pattern?.regex ?? "";
  const miraComentario = /TODO|FIXME|HACK|XXX/.test(re);
  const scope = r.pattern?.scope ?? "code";
  return miraComentario && scope === "code";
});

console.log(`Regras de TODO/FIXME com scope "code" (bug): ${suspeitas.length}`);
for (const r of suspeitas.slice(0, 12)) console.log(" ", r.id);

const casos = [
  { id: "SONAR-js-S1134", code: "// TODO: fix", file: "t.ts" },
  { id: "SONAR-cobol-S1134", code: "      *> TODO: fix", file: "t.cbl" },
  { id: "SONAR-py-S1134", code: "# TODO: fix", file: "t.py" },
];
console.log("");
for (const c of casos) {
  const rule = RULES.find((r) => r.id === c.id);
  // Perfil por EXTENSÃO, como o scanner faz de verdade — "clike" não
  // reconhece comentário COBOL (*>) nem Python (#).
  const m = matchPattern(rule.pattern, c.code, { profile: lexicalProfileFor(c.file) });
  console.log(m.length > 0 ? "✅" : "❌", c.id, "scope:", rule.pattern?.scope ?? "code(default)", "profile:", lexicalProfileFor(c.file));
}
