// Avaliação em massa das regras SONAR-port.
//
// Estratégia: para cada regra, gerar um snippet a partir do PRÓPRIO regex
// (pegar as alternativas literais do padrão e montar uma linha que case).
// Regra que não casa com o próprio padrão está quebrada por construção:
// regex inválido, âncora impossível, ou `unless` que anula o match.
//
// Não mede recall real (isso exige corpus); mede sanidade estrutural.
import { RULES, matchPattern, lexicalProfileFor } from "@codehero/contracts";

const FILE_BY_LANG = {
  javascript: "t.js",
  typescript: "t.ts",
  python: "t.py",
  java: "t.java",
  csharp: "t.cs",
  vbnet: "t.vb",
  cobol: "t.cbl",
  tsql: "t.sql",
  db2sql: "t.sql",
  go: "t.go",
  plsql: "t.sql",
  any: "t.ts",
};

// Extrai literais utilizáveis de um regex: pedaços sem metacaracteres,
// com pelo menos 3 chars, que pareçam código (letra no meio).
function literaisDo(regex) {
  const semGrupos = regex.replace(/\(\?[^)]*\)/g, " "); // remove (?i) etc
  const partes = semGrupos.split(/[|()]/);
  const literais = [];
  for (const p of partes) {
    const limpo = p
      .replace(/\\[sSdDwWbB]/g, " ")
      .replace(/\\([.^$*+?{}\[\]\\|/])/g, "$1")
      .replace(/\[[^\]]*\]/g, "x")
      .replace(/[{}]\d*,?\d*\}/g, "")
      .replace(/[*+?]/g, "")
      .replace(/\^|\$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (limpo.length >= 3 && /[a-zA-Z]/.test(limpo) && limpo.length < 60) {
      literais.push(limpo);
    }
  }
  return literais;
}

function snippetPara(rule) {
  const lits = literaisDo(rule.pattern?.regex ?? "");
  if (lits.length === 0) return null;
  const lang = rule.languages[0] ?? "any";
  const scope = rule.pattern?.scope ?? "code";
  // Snippet sintaticamente plausível por escopo: comentário vai num comentário
  // da linguagem certa; string vai dentro de aspas; código fica cru.
  const corpo = lits.slice(0, 3).join(" ");
  if (scope === "comments") {
    if (lang === "cobol") return "      *> " + corpo;
    if (lang === "python") return "# " + corpo;
    return "// " + corpo;
  }
  if (scope === "strings") return 'const x = "' + corpo + '";';
  return corpo + ";";
}

const sonar = RULES.filter((r) => r.id.startsWith("SONAR-"));
console.log(`Avaliando ${sonar.length} regras SONAR-port...\n`);

const falhas = [];
let semSnippet = 0;
let astBacked = 0;

for (const rule of sonar) {
  // Regra com AST mas regex vazio é avaliada no L1 — não é bug o pattern não
  // casar; contar à parte para não inflar "falhas".
  if (rule.ast && !(rule.pattern?.regex && rule.pattern.regex !== "(?!x)x")) {
    astBacked++;
    continue;
  }
  const lang = rule.languages[0] ?? "any";
  const file = FILE_BY_LANG[lang] ?? "t.ts";
  const snippet = snippetPara(rule);
  if (!snippet) {
    semSnippet++;
    falhas.push({ id: rule.id, motivo: "sem literal extraível", regex: (rule.pattern?.regex ?? "").slice(0, 90) });
    continue;
  }
  // matchPattern com o perfil CERTO por extensão (bug do V1: usava clike p/ tudo)
  let findings;
  try {
    findings = matchPattern(rule.pattern, snippet, { profile: lexicalProfileFor(file) });
  } catch (e) {
    falhas.push({ id: rule.id, motivo: "exceção: " + String(e).slice(0, 60), regex: rule.pattern?.regex?.slice(0, 90) });
    continue;
  }
  if (findings.length === 0) {
    falhas.push({ id: rule.id, motivo: "snippet não disparou", snippet: snippet.slice(0, 60), regex: rule.pattern?.regex?.slice(0, 90) });
  }
}

console.log(`OK (casa com o próprio padrão): ${sonar.length - falhas.length - astBacked}/${sonar.length - astBacked}`);
console.log(`AST-backed (avaliadas no L1, não no regex): ${astBacked}`);
console.log(`Sem snippet extraível: ${semSnippet}`);
console.log(`Falhas: ${falhas.length}`);

// Agrupa por motivo para priorizar correção
const porMotivo = {};
for (const f of falhas) {
  const k = f.motivo.split(":")[0];
  porMotivo[k] = (porMotivo[k] ?? 0) + 1;
}
console.log("Por motivo:", porMotivo);
console.log("\nPrimeiras 30 falhas:");
for (const f of falhas.slice(0, 30)) {
  console.log(`  ${f.id} :: ${f.motivo}`);
  if (f.snippet) console.log(`    snippet: ${f.snippet}`);
  console.log(`    regex:   ${f.regex}`);
}
