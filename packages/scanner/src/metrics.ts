import {
  computeFileMetrics,
  parseStructural,
  structuralFindings,
  structuralLanguageFor,
  DEFAULT_STRUCTURAL_THRESHOLDS,
  type FileMetrics,
  type StructuralFinding,
  type StructuralThresholds,
} from "@codehero/engine";

// ---------------------------------------------------------------------------
// Passo de métricas estruturais do scanner.
//
// Separado do caminho L0 de propósito: parsear com tree-sitter custa ~13ms por
// arquivo de 25KB, contra microssegundos por regex. Quem só quer o gate de
// segurança não deve pagar por isso, então o passo é opcional (--metrics).
// ---------------------------------------------------------------------------

/** Arquivo grande é quase sempre gerado; parsear não paga o custo. */
const MAX_BYTES = 400_000;

export interface StructuralSummary {
  /** Métricas por arquivo, só das linguagens com gramática madura. */
  files: FileMetrics[];
  findings: StructuralFinding[];
  /** Arquivos que a gramática rejeitou — números seriam pela metade. */
  parseErrors: string[];
  /** Analisáveis mas fora do alcance do tree-sitter (COBOL, T-SQL, DB2, VB.NET). */
  skippedLanguages: number;
  totals: {
    functions: number;
    /** Média ponderada por função, não por arquivo — arquivo com 1 função
     *  gigante não deve pesar igual a um com 20 pequenas. */
    avgCyclomatic: number;
    avgCognitive: number;
    maxCyclomatic: number;
    maxNesting: number;
    commentDensity: number;
  };
}

export async function collectStructural(
  files: Array<{ path: string; source: string }>,
  thresholds: StructuralThresholds = DEFAULT_STRUCTURAL_THRESHOLDS,
): Promise<StructuralSummary> {
  const out: FileMetrics[] = [];
  const findings: StructuralFinding[] = [];
  const parseErrors: string[] = [];
  let skippedLanguages = 0;

  for (const f of files) {
    if (!structuralLanguageFor(f.path)) {
      skippedLanguages++;
      continue;
    }
    if (f.source.length > MAX_BYTES) continue;

    const parsed = await parseStructural(f.path, f.source);
    if (!parsed) continue;

    const m = computeFileMetrics(f.path, f.source, parsed);
    out.push(m);
    if (m.parseError) parseErrors.push(f.path);
    findings.push(...structuralFindings(m, thresholds));
  }

  const todasFuncoes = out.flatMap((m) => m.functions);
  const somaLinhas = out.reduce((a, m) => a + m.linesOfCode, 0);
  const somaComentarios = out.reduce((a, m) => a + m.commentLines, 0);
  const media = (xs: number[]) =>
    xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0;

  return {
    files: out,
    findings,
    parseErrors,
    skippedLanguages,
    totals: {
      functions: todasFuncoes.length,
      avgCyclomatic: media(todasFuncoes.map((f) => f.cyclomatic)),
      avgCognitive: media(todasFuncoes.map((f) => f.cognitive)),
      maxCyclomatic: todasFuncoes.reduce((a, f) => Math.max(a, f.cyclomatic), 0),
      maxNesting: todasFuncoes.reduce((a, f) => Math.max(a, f.maxNesting), 0),
      commentDensity: somaLinhas
        ? Math.round((somaComentarios / somaLinhas) * 1000) / 10
        : 0,
    },
  };
}
