import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Severity } from "@codehero/contracts";

// ---------------------------------------------------------------------------
// Ingestão de SARIF de terceiros.
//
// É o caminho de maior salto em segurança pelo menor esforço: CodeQL e Semgrep
// fazem taint entre arquivos, que o motor L0 não alcança; os linters nativos
// fazem smell estrutural por linguagem; e osv-scanner/trivy cobrem o eixo de
// dependências (SCA), que a análise estática de código não vê.
//
// PROCEDÊNCIA É REQUISITO, NÃO ENFEITE: um achado importado carrega o nome da
// ferramenta e o id de regra ORIGINAL. Apresentá-lo como achado do CodeHero
// seria o mesmo erro do catálogo do Sonar way — assinar com autoridade que não
// é nossa. Quem lê o relatório precisa saber quem afirmou o quê.
// ---------------------------------------------------------------------------

export interface ImportedFinding {
  /** Id no formato `EXT:<ferramenta>:<regra original>` — nunca colide com HERO-*. */
  ruleId: string;
  /** Nome da ferramenta, do driver do SARIF. */
  tool: string;
  /** Id da regra como a ferramenta o emitiu, sem prefixo. */
  originalRuleId: string;
  severity: Severity;
  message: string;
  file: string;
  startLine: number;
  startColumn: number;
  endColumn: number;
  snippet: string;
  fingerprint: string;
  /** CWE quando a ferramenta informa (tags do SARIF ou properties). */
  cwe: string[];
  /** SCA: vulnerabilidade de dependência, não de código escrito aqui. */
  isDependency: boolean;
  helpUri?: string;
}

export interface ImportSummary {
  findings: ImportedFinding[];
  /** Quantos achados por ferramenta — o relatório precisa atribuir. */
  byTool: Record<string, number>;
  /** Arquivos que não eram SARIF válido. */
  failed: string[];
}

/**
 * `security-severity` é a convenção do GitHub Code Scanning: CVSS 0–10. Quando
 * presente, ela é MAIS informativa que o `level`, porque `level: "error"` cobre
 * tudo de 4.0 a 10.0 — colapsar isso perderia a distinção entre um problema
 * incômodo e um crítico.
 */
function severityFromCvss(cvss: number): Severity {
  if (cvss >= 9.0) return "BLOCKER";
  if (cvss >= 7.0) return "CRITICAL";
  if (cvss >= 4.0) return "MAJOR";
  if (cvss > 0) return "MINOR";
  return "INFO";
}

function severityFromLevel(level: string | undefined): Severity {
  switch (level) {
    case "error":
      return "CRITICAL";
    case "warning":
      return "MAJOR";
    case "note":
      return "MINOR";
    default:
      return "INFO";
  }
}

/** Ferramentas de SCA reportam contra o manifesto, não contra código autoral. */
const FERRAMENTAS_SCA = /osv-?scanner|trivy|grype|snyk|dependency-?check|npm-?audit/i;

const MANIFESTOS =
  /(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|requirements.*\.txt|Pipfile(\.lock)?|poetry\.lock|go\.(mod|sum)|pom\.xml|build\.gradle|.*\.csproj|Gemfile(\.lock)?|composer\.(json|lock)|Cargo\.(toml|lock))$/i;

interface RawRule {
  id?: string;
  name?: string;
  shortDescription?: { text?: string };
  fullDescription?: { text?: string };
  helpUri?: string;
  defaultConfiguration?: { level?: string };
  properties?: { "security-severity"?: string; tags?: string[]; cwe?: string[] };
}

interface RawResult {
  ruleId?: string;
  rule?: { id?: string; index?: number };
  level?: string;
  message?: { text?: string };
  locations?: Array<{
    physicalLocation?: {
      artifactLocation?: { uri?: string };
      region?: {
        startLine?: number;
        startColumn?: number;
        endColumn?: number;
        snippet?: { text?: string };
      };
    };
  }>;
  partialFingerprints?: Record<string, string>;
  properties?: { "security-severity"?: string; tags?: string[] };
}

function normalizarCaminho(uri: string): string {
  return uri
    .replace(/^file:\/\/\//, "")
    .split("\\")
    .join("/")
    .replace(/^\.\//, "");
}

function extrairCwe(rule: RawRule | undefined, res: RawResult): string[] {
  const tags = [...(rule?.properties?.tags ?? []), ...(res.properties?.tags ?? [])];
  const deTags = tags
    .map((t) => /(?:^|\/)(CWE-\d+)/i.exec(t)?.[1])
    .filter((x): x is string => Boolean(x))
    .map((x) => x.toUpperCase());
  return [...new Set([...(rule?.properties?.cwe ?? []), ...deTags])];
}

/**
 * Converte um SARIF de terceiro em achados com procedência.
 *
 * Tolerante de propósito: SARIF real vem com campo faltando, `ruleId` ausente
 * (só `rule.index`), caminho `file:///`. Perder o arquivo inteiro por um
 * resultado malformado seria pior que ignorar aquele resultado.
 */
export function importSarifText(text: string): ImportedFinding[] | null {
  let doc: { runs?: Array<{ tool?: { driver?: { name?: string; rules?: RawRule[] } }; results?: RawResult[] }> };
  try {
    doc = JSON.parse(text);
  } catch {
    return null; // não é JSON
  }
  // `null` = não é SARIF. Array vazio = SARIF válido e LIMPO, que é o objetivo
  // de um scan — tratar isso como falha confundiria o usuário no melhor caso.
  if (!Array.isArray(doc.runs)) return null;

  const out: ImportedFinding[] = [];

  for (const run of doc.runs) {
    const tool = run.tool?.driver?.name?.trim() || "desconhecido";
    const rules = run.tool?.driver?.rules ?? [];
    const ehSca = FERRAMENTAS_SCA.test(tool);

    for (const res of run.results ?? []) {
      // `ruleId` pode faltar; nesse caso a regra vem por índice no array.
      const porIndice =
        typeof res.rule?.index === "number" ? rules[res.rule.index] : undefined;
      const originalRuleId = res.ruleId ?? res.rule?.id ?? porIndice?.id ?? "sem-id";
      const rule = rules.find((r) => r.id === originalRuleId) ?? porIndice;

      const loc = res.locations?.[0]?.physicalLocation;
      const file = normalizarCaminho(loc?.artifactLocation?.uri ?? "");
      if (!file) continue; // sem local não há o que mostrar no diff nem no editor

      const cvssRaw =
        res.properties?.["security-severity"] ?? rule?.properties?.["security-severity"];
      const cvss = cvssRaw !== undefined ? Number(cvssRaw) : NaN;
      const severity = Number.isFinite(cvss)
        ? severityFromCvss(cvss)
        : severityFromLevel(res.level ?? rule?.defaultConfiguration?.level);

      const startLine = loc?.region?.startLine ?? 1;
      const message =
        res.message?.text?.trim() ||
        rule?.shortDescription?.text?.trim() ||
        rule?.fullDescription?.text?.trim() ||
        originalRuleId;

      // Fingerprint próprio: o da ferramenta, quando existe, não é comparável
      // entre ferramentas, e precisamos deduplicar reimportação do mesmo run.
      const fingerprint = createHash("sha1")
        .update(`${tool}|${originalRuleId}|${file}|${startLine}`)
        .digest("hex")
        .slice(0, 24);

      out.push({
        ruleId: `EXT:${tool}:${originalRuleId}`,
        tool,
        originalRuleId,
        severity,
        message,
        file,
        startLine,
        startColumn: loc?.region?.startColumn ?? 1,
        endColumn: loc?.region?.endColumn ?? (loc?.region?.startColumn ?? 1) + 1,
        snippet: loc?.region?.snippet?.text?.trim() ?? "",
        fingerprint,
        cwe: extrairCwe(rule, res),
        // SCA pela ferramenta OU pelo alvo: um achado contra package-lock.json
        // é de dependência mesmo que a ferramenta não se anuncie como SCA.
        isDependency: ehSca || MANIFESTOS.test(file),
        ...(rule?.helpUri ? { helpUri: rule.helpUri } : {}),
      });
    }
  }

  return out;
}

export function importSarifFiles(paths: string[]): ImportSummary {
  const findings: ImportedFinding[] = [];
  const failed: string[] = [];
  const vistos = new Set<string>();

  for (const p of paths) {
    let lidos: ImportedFinding[] | null;
    try {
      lidos = importSarifText(readFileSync(p, "utf8"));
    } catch {
      failed.push(p); // não existe ou não é legível
      continue;
    }
    if (lidos === null) {
      failed.push(p); // existe mas não é SARIF
      continue;
    }
    for (const f of lidos) {
      if (vistos.has(f.fingerprint)) continue;
      vistos.add(f.fingerprint);
      findings.push(f);
    }
  }

  const byTool: Record<string, number> = {};
  for (const f of findings) byTool[f.tool] = (byTool[f.tool] ?? 0) + 1;

  return { findings, byTool, failed };
}
