#!/usr/bin/env node
/**
 * Auditoria dos detectores L0.
 *
 * O catálogo tem 501 regras apoiadas em 140 detectores DISTINTOS — 62 deles
 * compartilhados por mais de uma regra. Auditar regra a regra é trabalho
 * repetido; auditar o detector cobre todas as regras que dependem dele.
 *
 * Auditar à mão 140 detectores é caro e, pior, não é repetível: o catálogo
 * cresce e a auditoria envelhece. Este script mede, e roda de novo quando
 * quiser.
 *
 * Duas frentes, porque uma sozinha engana:
 *
 *   FORMA    padrões cuja ESTRUTURA já provocou falha em massa neste projeto.
 *            O caso concreto: `(?i)(DES|RC4|MD5)` sem `\b` casou dentro de
 *            "MODES", "described", "candidates" e gerou 650 falsos positivos
 *            de uma vez. Não é hipótese, é histórico.
 *
 *   VOLUME   quantas vezes o detector dispara num acervo real. Um detector
 *            BLOCKER que acende em 5% das linhas não está achando 5% de
 *            defeitos graves — está quebrado. Severidade alta e volume alto
 *            são incompatíveis, e é isso que o número expõe.
 *
 * Nenhuma das duas condena sozinha: há detector legitimamente frequente
 * (INFO de TODO) e detector sem `\b` legitimamente seguro (âncora `^`). Por
 * isso o script REPORTA e ordena por risco, em vez de reprovar.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { RULES, buildLexicalMask, lexicalProfileFor, matchPattern } from "../packages/contracts/dist/index.js";
import { languageForFile } from "../packages/scanner/dist/engine.js";

// --- 1. agrupa regras por detector -----------------------------------------

const porDetector = new Map();
for (const r of RULES) {
  const re = r.pattern?.regex;
  if (!re) continue;
  if (!porDetector.has(re)) porDetector.set(re, []);
  porDetector.get(re).push(r);
}

const ORDEM_SEV = ["INFO", "MINOR", "MAJOR", "CRITICAL", "BLOCKER"];
const piorSeveridade = (rs) =>
  rs.reduce((a, r) => (ORDEM_SEV.indexOf(r.severity) > ORDEM_SEV.indexOf(a) ? r.severity : a), "INFO");

// --- 2. auditoria de FORMA --------------------------------------------------

/**
 * Alternância de palavras nuas sem delimitador.
 *
 * `(DES|RC4|MD5)` casa dentro de qualquer palavra maior. Com `\b` de um lado
 * só ainda casa em metade dos casos. O alerta só cai se NÃO houver `\b`,
 * `^`, `\s`, `[^\w]` ou similar cercando o grupo.
 */
/**
 * Delimita à ESQUERDA (o token não pode ser continuação de um identificador).
 * `\b`, início de linha, lookbehind negativo de palavra, ou classe não-palavra.
 */
const FRONTEIRA_ESQ = /(?:\\b|\^|\(\?<!\[?[.\\\w]|\\s|\\W|\[\^\w]|[\s(]\\\.)\s*$/;

/**
 * Delimita à DIREITA. O ponto sutil: `\s*\(` delimita — parêntese não faz
 * parte de identificador —, e é assim que quase todo detector de chamada é
 * escrito. Tratar isso como "sem fronteira" faria a auditoria gritar em cima
 * dos detectores CORRETOS, e uma auditoria barulhenta ninguém lê.
 */
const FRONTEIRA_DIR = /^\s*(?:\\b|\$|\\s|\\W|\[\^\w]|\\[(.[]|\\\)|[([.)\]{}=:;,])/;

function alternanciaSemFronteira(re) {
  const grupos = re.match(/\((?:\?:)?[A-Za-z][\w]*(?:\|[A-Za-z][\w]*)+\)/g) ?? [];
  const achados = [];
  let cursor = 0;
  for (const g of grupos) {
    const i = re.indexOf(g, cursor);
    if (i < 0) continue;
    cursor = i + g.length;
    const antes = re.slice(Math.max(0, i - 16), i);
    const depois = re.slice(i + g.length, i + g.length + 16);
    // Basta UM lado delimitado: `md5(` não casa dentro de `getMd5Hash` porque
    // o `(` já ancora; o perigo é o grupo solto dos DOIS lados.
    if (FRONTEIRA_ESQ.test(antes) || FRONTEIRA_DIR.test(depois)) continue;
    // Palavra curta é a que realmente aparece dentro de outra.
    const curta = g.replace(/[()?:]/g, "").split("|").some((p) => p.length <= 4);
    if (curta) achados.push(g);
  }
  return achados;
}

const REGRAS_DE_FORMA = [
  {
    id: "alternancia-sem-fronteira",
    peso: 40,
    porque: "grupo de palavras curtas sem \\b casa dentro de palavras maiores (foi assim que 650 FPs entraram)",
    testa: (re) => {
      const g = alternanciaSemFronteira(re);
      return g.length ? `grupo(s): ${g.join(" ")}` : null;
    },
  },
  {
    id: "sem-ancora-nem-fronteira",
    peso: 25,
    porque: "sem \\b, ^ ou $ o padrão casa em qualquer posição, inclusive no meio de identificador",
    testa: (re) => (/\\b|\^|\$|\\W|\[\^/.test(re) ? null : "nenhuma âncora ou fronteira no padrão"),
  },
  {
    id: "quantificador-guloso-amplo",
    peso: 15,
    porque: "`.*` sem limite atravessa a linha toda e liga tokens sem relação nenhuma",
    testa: (re) => (/\.\*(?!\?)/.test(re) ? "usa `.*` guloso" : null),
  },
  {
    id: "muito-curto",
    peso: 20,
    porque: "padrão curtíssimo casa com quase tudo",
    testa: (re) => {
      const util = re.replace(/\(\?i\)|\\b|[()?:]/g, "");
      return util.length <= 6 ? `só ${util.length} caracteres úteis` : null;
    },
  },
  {
    id: "escopo-ausente-em-severidade-alta",
    peso: 10,
    porque: "sem `scope` a regra vale em código; confirmar que é isso mesmo quando a regra é BLOCKER/CRITICAL",
    testa: null, // avaliada com as regras, não com o detector
  },
];

// --- 3. auditoria de VOLUME sobre um acervo real ---------------------------

const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".java", ".go", ".cs", ".cbl", ".sql", ".db2"]);
// Saida de build tem de ficar de fora. Bundle minificado e UMA linha gigante:
// qualquer detector "casa no meio de identificador" ali, porque nao existe
// posicao que nao esteja no meio de algo. Medir nisso produz alarme falso
// sobre detectores corretos.
const IGNORA = new Set([
  "node_modules", "dist", ".git", "out", "build", ".next", "coverage",
  "vendor", ".firebase", "_next", ".codehero-cache", "reports",
]);

function coleta(dir, out = [], limite = 900) {
  if (out.length >= limite) return out;
  let entradas;
  try {
    entradas = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entradas) {
    if (out.length >= limite) break;
    if (IGNORA.has(e)) continue;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) coleta(p, out, limite);
    else if (EXTS.has(extname(e)) && st.size < 400_000) out.push(p);
  }
  return out;
}

const raiz = process.argv[2] ?? ".";
const arquivos = coleta(raiz);
console.log(`acervo: ${arquivos.length} arquivo(s) sob ${raiz}\n`);

const fontes = [];
let totalLinhas = 0;
for (const f of arquivos) {
  try {
    const src = readFileSync(f, "utf8");
    totalLinhas += src.split("\n").length;
    fontes.push({
      file: f,
      src,
      linhas: src.split(/\r?\n/),
      lang: languageForFile(f),
      mask: buildLexicalMask(src, lexicalProfileFor(f)),
    });
  } catch {
    /* arquivo ilegível não invalida a auditoria */
  }
}

/**
 * Decisoes ja tomadas: apontamento revisado a mao e ACEITO, com o porque.
 *
 * Sem isto a auditoria repete o mesmo alarme toda vez que roda, e alarme que
 * se repete sem resolucao e alarme que se aprende a ignorar. Chave = id da
 * regra + tipo do apontamento.
 */
const ACEITOS = {
  'HERO-SEC-0798-hardcoded-secret|casou-dentro-de-identificador':
    "Verdadeiro positivo. O casamento cai no meio de `ingestToken` porque o " +
    "nome e camelCase — e o valor atribuido E mesmo um segredo embutido. " +
    "Exigir \\b aqui perderia todo segredo declarado em camelCase, que e a " +
    "maioria em JS/TS. O apontamento e do auditor, nao da regra.",
};

// --- 4. avalia cada detector ------------------------------------------------

const relatorio = [];
for (const [re, regras] of porDetector) {
  const sev = piorSeveridade(regras);
  const problemas = [];
  let risco = 0;

  for (const rf of REGRAS_DE_FORMA) {
    if (!rf.testa) continue;
    const d = rf.testa(re);
    if (d) {
      problemas.push({ tipo: rf.id, detalhe: d, porque: rf.porque });
      risco += rf.peso;
    }
  }

  // Volume: usa o `pattern` da primeira regra para respeitar `scope`/`unless`.
  const padrao = regras[0].pattern;

  // So mede nos arquivos das linguagens que a regra declara. Sem este filtro
  // um detector de C# era medido contra TypeScript e acusava 984 acertos num
  // repositorio sem um unico .cs — numero que condenaria a regra por um
  // defeito da auditoria, nao dela.
  const langs = new Set(regras.flatMap((r) => r.languages));
  const universal = langs.has('any');
  const alvo = universal ? fontes : fontes.filter((f) => langs.has(f.lang));
  if (alvo.length === 0) {
    relatorio.push({
      regex: re, severidade: sev, regras: regras.map((r) => r.id),
      acertos: 0, arquivosAtingidos: 0, porMilLinhas: 0, risco,
      naoMedido: 'acervo nao tem arquivo das linguagens da regra: ' + [...langs].join(', '),
      problemas,
    });
    continue;
  }
  let acertos = 0;
  let arquivosAtingidos = 0;
  let dentroDeIdentificador = 0;
  const exemplosRuins = [];
  for (const f of alvo) {
    let n = 0;
    try {
      for (const m of matchPattern(padrao, f.src, { mask: f.mask })) {
        n++;
        // EVIDÊNCIA DIRETA, não heurística sobre a sintaxe da regex: se o
        // caractere colado no início do trecho casado é de palavra, o detector
        // entrou no MEIO de um identificador. Foi exatamente assim que
        // `(DES|RC4|MD5)` acendeu dentro de "MODES" e "candidates".
        //
        // Tem de ser a linha CRUA: `snippet` vem aparado (`crua.trim()`) e
        // `column` é relativo à linha original. Cruzar os dois desloca o
        // índice pelo tamanho da indentação e faz o contador acusar detector
        // que tem lookbehind e não pode errar.
        const linha = f.linhas[(m.line ?? 1) - 1] ?? "";
        const ini = (m.column ?? 1) - 1;
        const antes = ini > 0 ? linha[ini - 1] : "";
        if (/\w/.test(antes)) {
          dentroDeIdentificador++;
          if (exemplosRuins.length < 3) exemplosRuins.push(`${f.file}: ${linha.trim().slice(0, 80)}`);
        }
      }
    } catch {
      continue;
    }
    if (n > 0) arquivosAtingidos++;
    acertos += n;
  }

  if (dentroDeIdentificador > 0) {
    problemas.push({
      tipo: "casou-dentro-de-identificador",
      detalhe: `${dentroDeIdentificador} de ${acertos} acerto(s) começam colados a um caractere de palavra`,
      porque: "o detector entrou no meio de um nome maior — falta \\b ou delimitador à esquerda",
      exemplos: exemplosRuins,
    });
    risco += 30 + Math.min(40, dentroDeIdentificador);
  }
  const linhasAlvo = alvo.reduce((a, f) => a + f.linhas.length, 0);
  const porMilLinhas = linhasAlvo ? (acertos / linhasAlvo) * 1000 : 0;

  // Severidade alta com volume alto é o sinal mais forte de detector quebrado.
  const grave = sev === "BLOCKER" || sev === "CRITICAL";
  // Amostra minima antes de acusar por volume. Um acerto num arquivo de 47
  // linhas da 21/1000 e nao significa nada — taxa sobre amostra pequena e
  // ruido, e uma auditoria que grita por ruido perde a autoridade que so
  // serve quando ela aponta algo de verdade.
  const LINHAS_MIN = 2000;
  if (grave && porMilLinhas > 1 && linhasAlvo >= LINHAS_MIN) {
    problemas.push({
      tipo: "volume-incompativel-com-severidade",
      detalhe: `${acertos} acerto(s) em ${arquivosAtingidos} arquivo(s) = ${porMilLinhas.toFixed(2)}/1000 linhas, sendo ${sev}`,
      porque: "defeito BLOCKER/CRITICAL genuíno é raro; volume alto quase sempre significa detector amplo demais",
    });
    risco += Math.min(50, Math.round(porMilLinhas * 10));
  }

  // Aplica as decisoes ja revisadas antes de reportar.
  const aceitos = [];
  for (let i = problemas.length - 1; i >= 0; i--) {
    const chave = regras.map((r) => r.id + '|' + problemas[i].tipo).find((k) => ACEITOS[k]);
    if (!chave) continue;
    aceitos.push({ ...problemas[i], aceitoPorque: ACEITOS[chave] });
    problemas.splice(i, 1);
    risco = Math.max(0, risco - 30);
  }

  relatorio.push({
    regex: re,
    severidade: sev,
    aceitos,
    regras: regras.map((r) => r.id),
    acertos,
    arquivosAtingidos,
    porMilLinhas: Number(porMilLinhas.toFixed(3)),
    risco,
    problemas,
  });
}

relatorio.sort((a, b) => b.risco - a.risco || b.acertos - a.acertos);

// --- 5. saída ---------------------------------------------------------------

const comProblema = relatorio.filter((d) => d.problemas.length > 0);
console.log(`detectores distintos: ${relatorio.length}`);
console.log(`  sem apontamento: ${relatorio.length - comProblema.length}`);
console.log(`  com apontamento: ${comProblema.length}`);
console.log(`  nunca dispararam no acervo: ${relatorio.filter((d) => d.acertos === 0).length}\n`);

const TOPO = Number(process.env.TOPO ?? 15);
console.log(`— ${Math.min(TOPO, comProblema.length)} de maior risco —\n`);
for (const d of comProblema.slice(0, TOPO)) {
  console.log(`risco ${String(d.risco).padStart(3)}  [${d.severidade}]  ${d.acertos} acerto(s)`);
  console.log(`  ${d.regex.length > 110 ? d.regex.slice(0, 110) + "…" : d.regex}`);
  console.log(`  regras: ${d.regras.slice(0, 3).join(", ")}${d.regras.length > 3 ? ` (+${d.regras.length - 3})` : ""}`);
  for (const p of d.problemas) console.log(`    - ${p.tipo}: ${p.detalhe}`);
  console.log();
}

mkdirSync("reports", { recursive: true });
const saida = "reports/audit-detectors.json";
writeFileSync(saida, JSON.stringify({ geradoEm: new Date().toISOString(), raiz, arquivos: fontes.length, totalLinhas, detectores: relatorio }, null, 2));
console.log(`relatório completo: ${saida}`);
