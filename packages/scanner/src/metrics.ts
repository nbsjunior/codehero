import { STRUCTURAL_RULES, COBOL_ANALYSES, type StructuralRule, type CobolAnalysis } from "@codehero/contracts";
import {
  matchStructural,
  sqlcodeNaoChecado,
  camposMortos,
  candidatesFor,
  findDuplicates,
  summarizeDuplication,
  computeFileMetrics,
  parseStructural,
  structuralFindings,
  structuralLanguageFor,
  DEFAULT_STRUCTURAL_THRESHOLDS,
  EMPTY_SEMANTIC_INDEX,
  type SemanticIndex,
  type FileMetrics,
  type StructuralFinding,
  type DuplicateCandidate,
  type DuplicationSummary,
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
  /** Apontamentos das regras que avaliam a ARVORE (nao a linha). */
  ruleFindings: StructuralRuleFinding[];
  /** Apontamentos das analises COBOL (SQLCODE, dado morto). */
  cobolFindings: CobolFinding[];
  duplication: DuplicationSummary;
  /** Arquivos que a gramática rejeitou — números seriam pela metade. */
  parseErrors: string[];
  /** Analisáveis mas fora do alcance estrutural (DB2 SQL dedicado, VB.NET). */
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

/** Achado de analise COBOL algoritmica (ver cobolAnalyses.ts). */
export interface CobolFinding {
  analysis: CobolAnalysis;
  file: string;
  startLine: number;
  /** Campo/verbo envolvido — o relatorio precisa dizer QUAL. */
  detail: string;
  snippet: string;
}

export interface StructuralRuleFinding {
  rule: StructuralRule;
  file: string;
  startLine: number;
  startColumn: number;
  endColumn: number;
  snippet: string;
}

export async function collectStructural(
  files: Array<{ path: string; source: string }>,
  thresholds: StructuralThresholds = DEFAULT_STRUCTURAL_THRESHOLDS,
  // Sem índice as regras com `semantic` degradam sozinhas: as que exigem tipo
  // calam, as demais seguem pela árvore. Nenhum `if` aqui.
  semantic: SemanticIndex = EMPTY_SEMANTIC_INDEX,
): Promise<StructuralSummary> {
  const out: FileMetrics[] = [];
  const findings: StructuralFinding[] = [];
  const dupCandidatos: DuplicateCandidate[] = [];
  const ruleFindings: StructuralRuleFinding[] = [];
  const cobolFindings: CobolFinding[] = [];
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
    dupCandidatos.push(...candidatesFor(f.path, parsed));

    // Regras estruturais: mesmo parse, sem custo extra de parsing.
    for (const rule of STRUCTURAL_RULES) {
      for (const hit of matchStructural(parsed, rule.spec, { semantic, file: m.file })) {
        ruleFindings.push({ rule, file: m.file, ...hit });
      }
    }

    // Análises COBOL algorítmicas: percorrem a árvore INTEIRA do programa e
    // não cabem numa spec declarativa (ver cobolAnalyses.ts). Só rodam em
    // COBOL, então não custam nada nas outras linguagens.
    if (parsed.language === "cobol") {
      for (const c of sqlcodeNaoChecado(parsed.root as never)) {
        cobolFindings.push({
          analysis: COBOL_ANALYSES["HERO-CBL-0252-sqlcode-nao-checado"]!,
          file: m.file,
          startLine: c.linha + 1,
          detail: `${c.verbo}${c.paragrafo ? ` em ${c.paragrafo}` : ""}`,
          snippet: c.trecho,
        });
      }
      for (const d of camposMortos(parsed.root as never)) {
        cobolFindings.push({
          analysis: COBOL_ANALYSES["HERO-CBL-1164-dado-morto"]!,
          file: m.file,
          startLine: d.linha + 1,
          detail: `${d.nome}${d.picture ? ` PIC ${d.picture}` : ""}`,
          snippet: `${String(d.nivel).padStart(2, "0")}  ${d.nome}`,
        });
      }
    }
  }

  const todasFuncoes = out.flatMap((m) => m.functions);
  const somaLinhas = out.reduce((a, m) => a + m.linesOfCode, 0);
  const somaComentarios = out.reduce((a, m) => a + m.commentLines, 0);
  const media = (xs: number[]) =>
    xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0;

  const duplication = summarizeDuplication(
    findDuplicates(dupCandidatos),
    out.reduce((a, m) => a + m.linesOfCode, 0),
  );

  return {
    files: out,
    findings,
    ruleFindings,
    cobolFindings,
    duplication,
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
