// ---------------------------------------------------------------------------
// Cobertura de testes.
//
// O CodeHero NÃO calcula cobertura — nenhuma ferramenta de análise estática
// calcula. Quem instrumenta é o test runner; o que fazemos é ingerir o
// relatório que ele já produziu (lcov, JaCoCo, Cobertura, coverage.py, Go).
//
// Este arquivo tem só os tipos e a agregação pura: roda no browser, nas
// Functions e no scanner. Os parsers de formato vivem em @codehero/scanner,
// onde a leitura de arquivo já acontece.
// ---------------------------------------------------------------------------

export type CoverageFormat = "lcov" | "cobertura" | "jacoco" | "go" | "unknown";

export interface CoverageCounter {
  covered: number;
  total: number;
}

export interface FileCoverage {
  /** Caminho relativo à raiz do scan, sempre com separador POSIX. */
  path: string;
  lines: CoverageCounter;
  branches?: CoverageCounter;
  /**
   * Linhas executáveis não cobertas e cobertas. As duas listas juntas definem
   * o que é executável no arquivo — o que permite excluir comentário e linha
   * em branco do denominador da cobertura de código novo.
   */
  uncoveredLines: number[];
  coveredLines: number[];
}

export interface CoverageReport {
  format: CoverageFormat;
  lines: CoverageCounter;
  branches?: CoverageCounter;
  files: FileCoverage[];
}

/** Percentual 0–100 com uma casa. Denominador zero → 100 (nada a cobrir). */
export function coveragePercent(counter: CoverageCounter | undefined): number {
  if (!counter || counter.total <= 0) return 100;
  return Math.round((counter.covered / counter.total) * 1000) / 10;
}

/** Soma vários relatórios (monorepo com um lcov por pacote, por exemplo). */
export function mergeCoverageReports(reports: CoverageReport[]): CoverageReport | null {
  if (reports.length === 0) return null;

  const byPath = new Map<string, FileCoverage>();
  for (const report of reports) {
    for (const file of report.files) {
      const prev = byPath.get(file.path);
      if (!prev) {
        byPath.set(file.path, {
          ...file,
          uncoveredLines: [...file.uncoveredLines],
          coveredLines: [...file.coveredLines],
        });
        continue;
      }
      // Mesmo arquivo em dois relatórios: fica a MAIOR cobertura. Suites
      // diferentes cobrem partes diferentes; somar contaria linhas em dobro.
      if (coveragePercent(file.lines) > coveragePercent(prev.lines)) {
        byPath.set(file.path, {
          ...file,
          uncoveredLines: [...file.uncoveredLines],
          coveredLines: [...file.coveredLines],
        });
      }
    }
  }

  const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  const lines = files.reduce<CoverageCounter>(
    (acc, f) => ({ covered: acc.covered + f.lines.covered, total: acc.total + f.lines.total }),
    { covered: 0, total: 0 },
  );
  const hasBranches = files.some((f) => f.branches);
  const branches = hasBranches
    ? files.reduce<CoverageCounter>(
        (acc, f) => ({
          covered: acc.covered + (f.branches?.covered ?? 0),
          total: acc.total + (f.branches?.total ?? 0),
        }),
        { covered: 0, total: 0 },
      )
    : undefined;

  return {
    format: reports.length === 1 ? (reports[0]?.format ?? "unknown") : "unknown",
    lines,
    branches,
    files,
  };
}

/** Linhas tocadas por arquivo no diff — o que define "código novo". */
export type ChangedLines = Record<string, number[]>;

export interface NewCodeCoverage {
  lines: CoverageCounter;
  percent: number;
  /** Arquivos do diff sem nenhum dado de cobertura (não instrumentados). */
  filesWithoutData: string[];
  /**
   * `false` quando nenhum relatório foi enviado. O gate PULA a condição nesse
   * caso, em vez de reprovar: quem ainda não configurou cobertura não pode ter
   * o build quebrado por isso. Já um relatório presente mas que não menciona
   * um arquivo alterado é outra coisa — aí conta como não coberto.
   */
  applicable: boolean;
}

/**
 * Cobertura restrita às linhas alteradas.
 *
 * É a métrica que muda comportamento de time: cobrir 100% do que se acabou de
 * escrever é exigível, subir a cobertura global de um legado não é. Um arquivo
 * alterado que o relatório não menciona conta como SEM cobertura — o contrário
 * deixaria passar código novo simplesmente por não estar instrumentado.
 */
export function coverageOnNewCode(
  report: CoverageReport | null,
  changed: ChangedLines,
): NewCodeCoverage {
  const paths = Object.keys(changed);
  // Sem relatório, a condição não se aplica — não há como distinguir "não
  // coberto" de "não medido", e reprovar por isso quebraria todo projeto que
  // ainda não configurou cobertura.
  if (!report) {
    return { lines: { covered: 0, total: 0 }, percent: 100, filesWithoutData: [], applicable: false };
  }
  if (paths.length === 0) {
    return { lines: { covered: 0, total: 0 }, percent: 100, filesWithoutData: [], applicable: true };
  }

  const byPath = new Map(report.files.map((f) => [normalizePath(f.path), f]));
  let covered = 0;
  let total = 0;
  const filesWithoutData: string[] = [];

  for (const rawPath of paths) {
    const path = normalizePath(rawPath);
    const file = byPath.get(path);
    const touched = changed[rawPath] ?? [];
    if (!file) {
      // Há relatório, mas ele não conhece este arquivo: código novo entrou
      // sem instrumentação. Conta como não coberto — pular aqui é justamente
      // o buraco que esta métrica existe para fechar. Sem saber quais linhas
      // são executáveis, todas as alteradas entram no denominador; o erro
      // pende para exigir cobertura, que é o lado seguro.
      if (touched.length > 0) {
        filesWithoutData.push(path);
        total += touched.length;
      }
      continue;
    }
    const uncovered = new Set(file.uncoveredLines);
    // Só linhas que o relatório conhece como executáveis entram no
    // denominador — comentário e linha em branco alterados não contam.
    const executable = new Set([...file.uncoveredLines, ...file.coveredLines]);
    for (const line of touched) {
      if (!executable.has(line)) continue;
      total += 1;
      if (!uncovered.has(line)) covered += 1;
    }
  }

  return {
    lines: { covered, total },
    percent: coveragePercent({ covered, total }),
    filesWithoutData: filesWithoutData.sort(),
    applicable: true,
  };
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}
