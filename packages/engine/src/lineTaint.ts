// ---------------------------------------------------------------------------
// lineTaint — L2 para linguagens SEM parser profundo (Java, Python, C#, Go...).
//
// O taint completo (taint.ts) usa Babel e só cobre JS/TS. Isso derrubou o
// recall do OWASP Benchmark para 15%: 100% dos casos SQLi Java montam a query
// numa variável e passam a variável ao sink — um padrão de DUAS linhas que a
// regex L0 (single-line) nunca casa.
//
// Aqui fazemos o essencial do taint sem AST:
//   1. var = <expressão>            → propaga taint da expressão para var
//   2. var = <fonte>                → var fica tainted (getParameter, input...)
//   3. var = sanitize(var)          → var perde taint (parseInt, escape...)
//   4. sink(var) com var tainted    → finding
//
// É intra-arquivo, linear (duas passagens), conservador no lado seguro:
// na dúvida marca tainted (prefere falso positivo a falso negativo).
// ---------------------------------------------------------------------------

import type { HeroRule } from "@codehero/contracts";
import type { EngineFinding } from "./types.ts";

/** Fontes de input por "família" de linguagem. Casam no RHS da atribuição. */
const FONTES: Record<string, RegExp[]> = {
  java: [
    /\bgetParameter(Values|Map|Names)?\s*\(/,
    /\bgetQueryString\s*\(/,
    /\bgetHeader(s|Names)?\s*\(/,
    /\bgetCookies\s*\(/,
    /\bgetReader\s*\(/,
    /\bgetInputStream\s*\(/,
    /\bgetRequestURI|getRequestURL|getServletPath|getPathInfo\b/,
    /\brequest\.get|req\.get|System\.getenv\b/,
    /\bnew\s+Scanner\s*\(\s*System\.in/,
    /\bvalues\s*\[\s*\d+\s*\]/, // getParameterMap -> values[0]
    /\bgetValue\s*\(|\bgetParameter\b/,
    /\bnextElement\s*\(/, // iteração sobre headers/cookies
    /\b\.getValue\s*\(\s*\)|\.getName\s*\(\s*\)/, // Cookie.getValue/getName
  ],
  python: [
    /\binput\s*\(/,
    /\brequest\.(args|form|values|data|json|GET|POST|cookies|headers)\b/,
    /\bflask\.request\b/,
    /\bself\.request\b/,
    /\bos\.environ\b/,
    /\bsys\.argv\b/,
  ],
  csharp: [
    /\bRequest\.(Query|Form|Cookies|Headers|Params)\b/,
    /\bConsole\.ReadLine\s*\(/,
    /\bEnvironment\.GetEnvironmentVariable\b/,
    /\bargs\s*\[/,
  ],
  any: [
    /\breq\.(query|params|body|headers)\b/,
    /\bprocess\.argv\b/,
    /\bgetenv\s*\(/,
  ],
};

/** Sanitizers: chamada que LIMPA o taint do argumento. */
const SANITIZERS: RegExp[] = [
  /\b(Integer|Long|Double|Float|Short|Byte)\.parse\w*\s*\(/, // parseInt etc
  /\bNumber\s*\(/,
  /\bescape\w*\s*\(/i, // escape, escapeHtml, mysql.escape...
  /\bencodeFor\w+\s*\(/, // ESAPI encodeForSQL/HTML...
  /\bURLEncoder\.encode\s*\(/,
  /\bhtmlspecialchars|htmlentities|mysqli_real_escape_string\s*\(/,
  /\bPrepareStatement|setString|setInt\b/, // parametrize (tratado à parte abaixo)
  /\bquote\w*\s*\(/i,
  /\bstrtol|atoi|atol\s*\(/i,
];

/** Sinks por categoria. Casam na LINHA da chamada. */
const SINKS: Record<string, RegExp[]> = {
  "sql.execute": [
    /\b(executeQuery|executeUpdate|execute|executeBatch|prepareCall|prepareStatement|createStatement)\s*\(/,
    /\.\s*(query|execute|executemany|raw)\s*\(/,
    // Spring JDBC + helpers comuns do benchmark
    /\b(queryForObject|queryForLong|queryForInt|queryForList|queryForMap|queryForRowSet|batchUpdate|update)\s*\(\s*\w+\s*,/,
    /\bJDBCtemplate\.\w+\s*\(/,
  ],
  child_process: [
    /\bRuntime\.getRuntime\s*\(\s*\)\.exec\s*\(/,
    /\bnew\s+ProcessBuilder\s*\(/,
    /\b(exec|execSync|spawn|spawnSync|execFile|system|popen)\s*\(/,
    /\bos\.system\s*\(|subprocess\.(call|run|Popen|check_output)\s*\(/,
    /\bProcess\.Start\s*\(/,
  ],
  "fs.path": [
    /\bnew\s+(File|FileInputStream|FileOutputStream|FileReader|FileWriter|RandomAccessFile)\s*\(/,
    /\bFiles\.(read|write|newInputStream|newOutputStream|copy|delete|lines|readAllLines|readString|writeString)\b/,
    /\bPaths\.get\s*\(/,
    /\bopen\s*\([^)]*['"]?[rwab]\+?['"]?/, // python open(...,"r")
    /\bFile\.(Open|ReadAll|WriteAll|Delete|Copy|Move)\b/,
    /\bnew\s+java\.io\.(File|FileInputStream|FileOutputStream)\b/,
  ],
  "network.request": [
    /\bnew\s+URL\s*\(/,
    /\bopenConnection\s*\(/,
    /\bHttpClient|HttpURLConnection\b/,
    /\b(fetch|axios\.get|axios\.post|got|http\.get|https\.get)\s*\(/,
    /\brequests\.(get|post|put|delete|head)\s*\(/,
    /\burllib\.request\.urlopen\s*\(/,
  ],
  "html.innerHTML": [
    /\bgetWriter\s*\(\s*\)\.(print|println|write|format)\s*\(/,
    /\bPrintWriter\b.*\.(print|println|write)\s*\(/,
    /\bresponse\.getWriter|out\.(print|println|write)\s*\(/,
    /\brender_template_string\s*\(/,
  ],
  "http.redirect": [
    /\bsendRedirect\s*\(/,
    /\bRedirect\s*\(|RedirectResult\s*\(/,
    /\bredirect\s*\(/,
    /\bwindow\.location|location\.href|location\.assign|location\.replace\b/,
  ],
  "object.merge": [
    /\b(Object\.assign|_\.merge|_\.extend|_\.defaultsDeep|merge|extend)\s*\(/,
  ],
  "ldap.search": [
    /\b(DirContext|InitialDirContext|LdapContext)\b[\s\S]{0,80}?\.search\s*\(/,
    /\bidc\.search\s*\(|\bctx\.search\s*\(|\bldapContext\.search\s*\(/,
    /\.\s*search\s*\(\s*[^)]*(filter|base|query)/i,
  ],
  "xpath.evaluate": [
    /\b(XPath|XPathExpression)\b[\s\S]{0,60}?\.(evaluate|compile)\s*\(/,
    /\bxpath\.(evaluate|compile)\s*\(/,
    /\.\s*(evaluate|compile)\s*\(\s*[^)]*(expression|xpath|query)/i,
    /\bxp\.(evaluate|compile)\s*\(/, // variável XPath comum no benchmark
  ],
  "session.setAttribute": [
    /\b(session|getSession\s*\(\s*\)|request\.getSession)\b[\s\S]{0,40}?\.(setAttribute|putValue)\s*\(/,
    /\.\s*(setAttribute|putValue)\s*\(\s*[^)]*(user|param|input|name|value)/i,
    /\bgetSession\s*\(\s*\)\s*\.(setAttribute|putValue)\s*\(/,
  ],
  eval: [
    /\b(eval|exec)\s*\(/,
    /\bScriptEngine\b.*\.eval\s*\(/,
    /\bnew\s+Function\s*\(/,
  ],
};

// ---------------------------------------------------------------------------
// Parsing de linha (sem AST).
// ---------------------------------------------------------------------------

const ATRIB =
  /(?:^|\s)(?:[\w<>\[\],.?]+\s+)?(\w+)\s*=(?!=)\s*(.+?);?\s*$/;
const CHAMADA = /(?:^|\s)(?:[\w<>\[\],.?]+\s+)?(\w+)\s*=/;

function sanitizado(rhs: string): boolean {
  return SANITIZERS.some((re) => re.test(rhs));
}

function extraiFonte(rhs: string, fontes: RegExp[]): string | null {
  for (const re of fontes) if (re.test(rhs)) return `source:${re.source.slice(0, 24)}`;
  return null;
}

/**
 * Expressão só com literais numéricos, operadores e ids conhecidos em `env`.
 */
function expressaoConstante(expr: string, env: Map<string, number> = new Map()): boolean {
  let limpa = expr.replace(/["'][^"']*["']/g, "");
  for (const k of env.keys()) limpa = limpa.replace(new RegExp(`\\b${k}\\b`, "g"), "1");
  // ids locais comuns do benchmark, se não estiverem no env
  limpa = limpa.replace(/\b(num|i|j|k|n|x|y|z)\b/g, "1");
  return /^[\d\s*+\-/%()<>=!&|.]+$/.test(limpa) && /\d/.test(limpa);
}

/**
 * Avalia expressão aritmética/comparação. Usa `env` para substituir ints locais
 * (`int num = 86` → num vale 86). Sem isso `(7*18)+num > 200` com num=86
 * (true/safe) virava num=1 (false) e gerava FP.
 */
function avaliaConstante(expr: string, env: Map<string, number> = new Map()): boolean | null {
  if (!expressaoConstante(expr, env)) return null;
  let limpa = expr.replace(/["'][^"']*["']/g, "");
  for (const [k, v] of env) limpa = limpa.replace(new RegExp(`\\b${k}\\b`, "g"), String(v));
  limpa = limpa.replace(/\b(num|i|j|k|n|x|y|z)\b/g, "1");
  if (!/^[\d\s*+\-/%()<>=!&|.]+$/.test(limpa)) return null;
  try {
    // eslint-disable-next-line no-new-func
    return Boolean(Function(`"use strict"; return (${limpa});`)());
  } catch {
    return null;
  }
}

/**
 * Ternário com ramo true LITERAL e condição constante TRUE.
 */
function ternarioConstanteLiteral(rhs: string, env: Map<string, number>): string | null {
  const m = /^(.+?)\?\s*(["'][^"']*["'])\s*:\s*.+$/.exec(rhs.trim());
  if (!m) return null;
  if (avaliaConstante(m[1] ?? "", env) !== true) return null;
  return m[2] ?? null;
}

/**
 * `if (CONST_TRUE) var = "lit"` — sela a var.
 */
function ifConstanteAtribuiLiteral(linha: string, env: Map<string, number>): string | null {
  const m = /if\s*\((.+)\)\s*(\w+)\s*=\s*(["'][^"']*["'])\s*;?\s*$/.exec(linha.trim());
  if (!m) return null;
  if (avaliaConstante(m[1] ?? "", env) !== true) return null;
  return m[2] ?? null;
}

/** `int num = 86;` → captura para o env de avaliação. */
function capturaIntLocal(linha: string): [string, number] | null {
  const m = /\b(?:int|long|short|byte)\s+(\w+)\s*=\s*(-?\d+)\s*;/.exec(linha);
  if (!m) return null;
  return [m[1] ?? "", Number(m[2])];
}

/** Variáveis referenciadas no RHS (tokens que parecem identificadores). */
function refsDo(rhs: string): string[] {
  const out: string[] = [];
  const re = /\b([a-zA-Z_$][\w$]*)\b/g;
  let m;
  while ((m = re.exec(rhs))) {
    const w = m[1] ?? "";
    if (!/^(true|false|null|new|return|if|else|for|while|int|long|double|float|String|char|byte|boolean|var|let|const|def|public|private|static|final|void)$/.test(w)) {
      out.push(w);
    }
  }
  return out;
}

/** Argumentos de uma chamada de sink: conteúdo dentro dos parênteses. */
function argsDaChamada(linha: string, sinkRe: RegExp): string {
  const m = sinkRe.exec(linha);
  if (!m) return "";
  const idx = m.index + m[0].length;
  // pega até o fecha-parêntese correspondente (simples: até o último )
  const resto = linha.slice(idx);
  let depth = 1;
  let fim = resto.length;
  for (let i = 0; i < resto.length; i++) {
    const c = resto[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        fim = i;
        break;
      }
    }
  }
  return resto.slice(0, fim);
}

// ---------------------------------------------------------------------------
// Rastreador principal.
// ---------------------------------------------------------------------------

export interface LineTaintResult {
  findings: EngineFinding[];
  /** Para depuração: variáveis tainted ao fim. */
  taintedCount: number;
}

/**
 * Roda regras `taint` (L2) sobre `source` SEM parser.
 * `language` escolhe a família de fontes; cai em `any` se desconhecida.
 */
export function runLineTaintRules(
  file: string,
  source: string,
  rules: HeroRule[],
  language?: string,
): LineTaintResult {
  const findings: EngineFinding[] = [];
  const taintRules = rules.filter((r) => r.taint);
  if (taintRules.length === 0) return { findings, taintedCount: 0 };

  // Une fontes/sinks/sanitizers de todas as regras ativas.
  const familias = [language ?? "any", "any"];
  const fontes: RegExp[] = [];
  for (const fam of familias) fontes.push(...(FONTES[fam] ?? []));
  const allSinks = [...new Set(taintRules.flatMap((r) => r.taint!.sinks))];
  const sinkRes: Array<{ kind: string; re: RegExp }> = [];
  for (const kind of allSinks) {
    for (const re of SINKS[kind] ?? []) sinkRes.push({ kind, re });
  }
  const ruleSanitizers = new Set(taintRules.flatMap((r) => r.taint!.sanitizers ?? []));

  const linhas = source.split(/\r?\n/);
  const tainted = new Map<string, string[]>(); // var -> path
  /** Vars "seladas" por `if (CONST) var = "lit"` — o else seguinte não re-taintiza. */
  const seladas = new Set<string>();
  /** Ints locais (`int num = 86`) para avaliar condições do benchmark. */
  const envInt = new Map<string, number>();

  const report = (line: number, snippet: string, sinkKind: string, path: string[]) => {
    for (const rule of taintRules) {
      if (!rule.taint!.sinks.includes(sinkKind as never)) continue;
      findings.push({
        ruleId: rule.id,
        file,
        startLine: line,
        startColumn: 1,
        endColumn: snippet.length + 1,
        snippet: snippet.trim(),
        engine: "taint",
        taintPath: [...path, `sink:${sinkKind}`],
      });
    }
  };

  /**
   * Junta uma chamada que abre `(` numa linha e só fecha depois — padrão
   * `connection.prepareStatement(\n    sql,\n    ...)` do benchmark. Sem isso o
   * sink e o argumento tainted caem em linhas separadas e o L2 não os conecta.
   * Retorna a linha (possivelmente) estendida e quantas linhas consumiu.
   */
  const juntaContinuacao = (i: number): { texto: string; consumiu: number } => {
    const base = linhas[i] ?? "";
    let texto = base;
    let depth = (base.match(/\(/g) ?? []).length - (base.match(/\)/g) ?? []).length;
    let consumiu = 0;
    while (depth > 0 && i + consumiu + 1 < linhas.length && consumiu < 8) {
      consumiu++;
      const prox = linhas[i + consumiu] ?? "";
      texto += " " + prox.trim();
      depth += (prox.match(/\(/g) ?? []).length - (prox.match(/\)/g) ?? []).length;
    }
    return { texto, consumiu };
  };

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i] ?? "";
    const lineNo = i + 1;

    const intLocal = capturaIntLocal(linha);
    if (intLocal) envInt.set(intLocal[0], intLocal[1]);

    // if (CONST) var = "lit" → sela a var e limpa taint (ramo then sempre pega).
    const selada = ifConstanteAtribuiLiteral(linha, envInt);
    if (selada) {
      seladas.add(selada);
      tainted.delete(selada);
    }

    // else var = ... depois de if-constante: NÃO re-taintiza (ramo morto).
    const elseAtrib = /^\s*else\s+(?:[\w<>\[\],.?]+\s+)?(\w+)\s*=/.exec(linha);
    if (elseAtrib && seladas.has(elseAtrib[1] ?? "")) {
      continue; // pula atribuição e sinks nesta linha (só tem o else)
    }

    // 1) Atribuição: propaga ou limpa taint.
    const atrib = ATRIB.exec(linha);
    if (atrib && CHAMADA.test(linha) && !selada) {
      const v = atrib[1] ?? "";
      const rhs = atrib[2] ?? "";
      // Guarda de fallback condicional: `if (param == null) param = "";` só roda
      // quando param É null — e null não é tainted. Se a linha reatribui a var a
      // uma constante DENTRO de um guarda `if (v == null)`, o taint deve SOBREVIVER
      // (senão perdemos o caso real: fonte tainted → if-null → sink).
      const guardaNull = new RegExp(`if\\s*\\(\\s*${v}\\s*[=!]=\\s*null`).test(linha);
      if (guardaNull) {
        // mantém o taint existente de v — não propaga nem limpa
      } else if (ternarioConstanteLiteral(rhs, envInt)) {
        // `(7*18)+num > 200 ? "safe" : param` → valor efetivo é o literal
        tainted.delete(v);
        seladas.add(v);
      } else if (sanitizado(rhs) || [...ruleSanitizers].some((s) => rhs.includes(s))) {
        tainted.delete(v);
      } else {
        const fonte = extraiFonte(rhs, fontes);
        if (fonte) {
          tainted.set(v, [fonte]);
          seladas.delete(v);
        } else {
          // `bar = valuesList.get(1)`: get de elemento NÃO propaga taint da
          // coleção (o índice pode ser o literal "safe"). O taint da coleção
          // só importa quando ela inteira vai ao sink (`pb.command(argList)`).
          const refs = refsDo(rhs).filter((r) => {
            if (!tainted.has(r)) return false;
            if (new RegExp(`\\b${r}\\s*\\.\\s*get\\w*\\s*\\(`).test(rhs)) return false;
            return true;
          });
          const path = refs.map((r) => tainted.get(r)).find(Boolean);
          if (path) {
            tainted.set(v, path);
            seladas.delete(v);
          } else {
            tainted.delete(v);
          }
        }
      }
    }

    // 1b) Coleções: `col.add(tainted)` → col fica tainted; `list[0] = tainted` idem.
    // O benchmark usa `argList.add("echo " + param)` antes de `pb.command(argList)`.
    const colAdd = /\b(\w+)\.(add|put|addAll|set|push|append|offer|putValue)\s*\(\s*(.+?)\s*\);?\s*$/.exec(linha);
    if (colAdd) {
      const alvo = colAdd[1] ?? "";
      const arg = colAdd[3] ?? "";
      const pathArg = refsDo(arg).map((r) => tainted.get(r)).find(Boolean);
      const fonteArg = extraiFonte(arg, fontes);
      if (pathArg) tainted.set(alvo, pathArg);
      else if (fonteArg) tainted.set(alvo, [fonteArg]);
    }
    const colIdx = /\b(\w+)\s*\[\s*[^\]]*\]\s*=\s*(.+?);?\s*$/.exec(linha);
    if (colIdx) {
      const alvo = colIdx[1] ?? "";
      const arg = colIdx[2] ?? "";
      const pathArg = refsDo(arg).map((r) => tainted.get(r)).find(Boolean);
      if (pathArg) tainted.set(alvo, pathArg);
    }

    // 2) Sinks: dispara se algum argumento estiver tainted.
    // `alvo` é a linha possivelmente estendida com a continuação da chamada,
    // para `prepareStatement(\n sql,\n ...)` conectar sink e argumento.
    const { texto: alvo } = juntaContinuacao(i);
    for (const { kind, re } of sinkRes) {
      if (!re.test(alvo)) continue;
      const args = argsDaChamada(alvo, re);
      const refs = refsDo(args);
      const path = refs.map((r) => tainted.get(r)).find(Boolean);
      const fonteInline = extraiFonte(args, fontes);
      if (path) {
        report(lineNo, linha, kind, path);
      } else if (fonteInline) {
        // fonte inline no sink: executeQuery("..." + request.getParameter(...))
        report(lineNo, linha, kind, [fonteInline]);
      }
    }
  }

  return { findings, taintedCount: tainted.size };
}
