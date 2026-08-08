import { readFileSync } from "node:fs";
import {
  normalizePath,
  type CoverageFormat,
  type CoverageReport,
  type FileCoverage,
} from "@codehero/contracts";

// ---------------------------------------------------------------------------
// Parsers dos formatos de cobertura do mercado.
//
// Todos são de texto e sem dependência externa: XML entra por extração dos
// atributos que interessam, não por um DOM completo. Isso é suficiente porque
// os quatro schemas são fixos e conhecidos — e mantém o scanner instalável por
// `npx` e empacotável no VSIX sem binário nativo.
// ---------------------------------------------------------------------------

function counter(covered: number, total: number) {
  return { covered, total };
}

function fileFrom(path: string, covered: number[], uncovered: number[], branches?: { covered: number; total: number }): FileCoverage {
  const uniqCovered = [...new Set(covered)].sort((a, b) => a - b);
  const uniqUncovered = [...new Set(uncovered)].sort((a, b) => a - b);
  return {
    path: normalizePath(path),
    lines: counter(uniqCovered.length, uniqCovered.length + uniqUncovered.length),
    ...(branches ? { branches } : {}),
    coveredLines: uniqCovered,
    uncoveredLines: uniqUncovered,
  };
}

function summarize(format: CoverageFormat, files: FileCoverage[]): CoverageReport {
  const lines = files.reduce(
    (acc, f) => counter(acc.covered + f.lines.covered, acc.total + f.lines.total),
    counter(0, 0),
  );
  const withBranches = files.filter((f) => f.branches);
  const branches = withBranches.length
    ? withBranches.reduce(
        (acc, f) => counter(acc.covered + (f.branches?.covered ?? 0), acc.total + (f.branches?.total ?? 0)),
        counter(0, 0),
      )
    : undefined;
  return { format, lines, branches, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}

/** lcov.info — Node (c8/nyc/jest), PHP, Rust, e o que mais exporta lcov. */
export function parseLcov(text: string): CoverageReport {
  const files: FileCoverage[] = [];
  let path = "";
  let covered: number[] = [];
  let uncovered: number[] = [];
  let brf = 0;
  let brh = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      path = line.slice(3);
      covered = [];
      uncovered = [];
      brf = 0;
      brh = 0;
    } else if (line.startsWith("DA:")) {
      // DA:<linha>,<execuções>
      const [n, hits] = line.slice(3).split(",");
      const lineNo = Number(n);
      if (!Number.isFinite(lineNo)) continue;
      if (Number(hits) > 0) covered.push(lineNo);
      else uncovered.push(lineNo);
    } else if (line.startsWith("BRF:")) {
      brf = Number(line.slice(4)) || 0;
    } else if (line.startsWith("BRH:")) {
      brh = Number(line.slice(4)) || 0;
    } else if (line === "end_of_record") {
      if (path) files.push(fileFrom(path, covered, uncovered, brf > 0 ? counter(brh, brf) : undefined));
      path = "";
    }
  }
  // Relatório truncado sem `end_of_record` final: não descarta o último bloco.
  if (path) files.push(fileFrom(path, covered, uncovered, brf > 0 ? counter(brh, brf) : undefined));

  return summarize("lcov", files);
}

/**
 * Cobertura XML — coverage.py, pytest-cov, .NET (coverlet), Jest cobertura.
 *
 * OpenCppCoverage não tem formato próprio: exporta o MESMO schema Cobertura
 * (`<coverage><packages><class filename>…<line number hits branch…`), então o
 * caminho para C++ no Windows é o que já existe aqui — detecção por conteúdo
 * cobre os dois.
 */
export function parseCobertura(text: string): CoverageReport {
  const files: FileCoverage[] = [];
  // <class filename="..."> ... <line number="N" hits="H" [branch="true" condition-coverage="x% (a/b)"]/>
  const classRe = /<class\b[^>]*\bfilename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g;
  const lineRe = /<line\b([^>]*)\/?>/g;

  for (const cls of text.matchAll(classRe)) {
    const path = cls[1] ?? "";
    const body = cls[2] ?? "";
    const covered: number[] = [];
    const uncovered: number[] = [];
    let brCovered = 0;
    let brTotal = 0;

    for (const m of body.matchAll(lineRe)) {
      const attrs = m[1] ?? "";
      const num = Number(/\bnumber="(\d+)"/.exec(attrs)?.[1]);
      if (!Number.isFinite(num)) continue;
      const hits = Number(/\bhits="(\d+)"/.exec(attrs)?.[1] ?? "0");
      if (hits > 0) covered.push(num);
      else uncovered.push(num);

      // condition-coverage="50% (1/2)"
      const cond = /condition-coverage="[^"]*\((\d+)\/(\d+)\)"/.exec(attrs);
      if (cond) {
        brCovered += Number(cond[1]) || 0;
        brTotal += Number(cond[2]) || 0;
      }
    }
    files.push(fileFrom(path, covered, uncovered, brTotal > 0 ? counter(brCovered, brTotal) : undefined));
  }

  return summarize("cobertura", files);
}

/**
 * JaCoCo XML — Java/Kotlin.
 *
 * Difere dos demais: o caminho útil é `<package name>/<sourcefile name>`, e a
 * contagem de linha vem de `<counter type="LINE">` no nível do sourcefile, não
 * de elementos `<line>` individuais (que existem mas são por instrução).
 */
export function parseJacoco(text: string): CoverageReport {
  const files: FileCoverage[] = [];
  const pkgRe = /<package\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/package>/g;
  const srcRe = /<sourcefile\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/sourcefile>/g;
  const lineRe = /<line\b([^>]*)\/?>/g;

  for (const pkg of text.matchAll(pkgRe)) {
    const pkgName = (pkg[1] ?? "").replace(/\./g, "/");
    const pkgBody = pkg[2] ?? "";

    for (const src of pkgBody.matchAll(srcRe)) {
      const fileName = src[1] ?? "";
      const body = src[2] ?? "";
      const path = pkgName ? `${pkgName}/${fileName}` : fileName;
      const covered: number[] = [];
      const uncovered: number[] = [];
      let brCovered = 0;
      let brTotal = 0;

      for (const m of body.matchAll(lineRe)) {
        const attrs = m[1] ?? "";
        const num = Number(/\bnr="(\d+)"/.exec(attrs)?.[1]);
        if (!Number.isFinite(num)) continue;
        // ci = instruções cobertas; mi = perdidas. Linha conta como coberta
        // se ao menos uma instrução dela executou.
        const ci = Number(/\bci="(\d+)"/.exec(attrs)?.[1] ?? "0");
        if (ci > 0) covered.push(num);
        else uncovered.push(num);

        const cb = Number(/\bcb="(\d+)"/.exec(attrs)?.[1] ?? "0");
        const mb = Number(/\bmb="(\d+)"/.exec(attrs)?.[1] ?? "0");
        brCovered += cb;
        brTotal += cb + mb;
      }
      files.push(fileFrom(path, covered, uncovered, brTotal > 0 ? counter(brCovered, brTotal) : undefined));
    }
  }

  return summarize("jacoco", files);
}

/**
 * JCov (OpenJDK Code Tools) — XML com `<method>…<bl s= e= c=/>` e classe com
 * `source="…"` (ou `name` como fallback de path). Cobertura de método/bloco é
 * o que o JCov instrumenta em bytecode; aqui projetamos bloco → linhas.
 */
export function parseJcov(text: string): CoverageReport {
  const byFile = new Map<string, { covered: Set<number>; uncovered: Set<number> }>();
  const blockRe = /<(?:bl|block)\b([^>]*)\/?>/g;

  const pushLine = (
    map: Map<string, { covered: Set<number>; uncovered: Set<number> }>,
    file: string,
    line: number,
    hit: boolean,
  ) => {
    const entry = map.get(file) ?? { covered: new Set<number>(), uncovered: new Set<number>() };
    if (hit) {
      entry.covered.add(line);
      entry.uncovered.delete(line);
    } else if (!entry.covered.has(line)) {
      entry.uncovered.add(line);
    }
    map.set(file, entry);
  };

  const classRe = /<class\b([^>]*)>([\s\S]*?)<\/class>/g;
  for (const cls of text.matchAll(classRe)) {
    const attrs = cls[1] ?? "";
    const src = /\bsource="([^"]+)"/.exec(attrs)?.[1];
    const name = (/\bname="([^"]+)"/.exec(attrs)?.[1] ?? "").replace(/\./g, "/");
    const file = src ? src.replace(/\\/g, "/") : name ? `${name}.java` : "";
    if (!file) continue;
    const body = cls[2] ?? "";
    for (const b of body.matchAll(blockRe)) {
      const a = b[1] ?? "";
      const s = Number(/\bs="(\d+)"/.exec(a)?.[1]);
      const e = Number(/\be="(\d+)"/.exec(a)?.[1] ?? s);
      const c = Number(/\bc="(\d+)"/.exec(a)?.[1] ?? "0");
      if (!Number.isFinite(s)) continue;
      for (let n = s; n <= e; n++) pushLine(byFile, file, n, c > 0);
    }
  }

  const files = [...byFile.entries()].map(([path, e]) =>
    fileFrom(path, [...e.covered], [...e.uncovered]),
  );
  return summarize("jcov", files);
}

/**
 * Go coverprofile (`go test -coverprofile`).
 *
 * Formato: `arquivo:linhaIni.colIni,linhaFim.colFim numStmts count`. É por
 * BLOCO, não por linha — expandimos o intervalo para as linhas que ele cobre.
 */
export function parseGoCoverProfile(text: string): CoverageReport {
  const byFile = new Map<string, { covered: Set<number>; uncovered: Set<number> }>();
  const re = /^(.+):(\d+)\.\d+,(\d+)\.\d+\s+\d+\s+(\d+)$/;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("mode:")) continue;
    const m = re.exec(line);
    if (!m) continue;
    const [, path, startStr, endStr, countStr] = m;
    const start = Number(startStr);
    const end = Number(endStr);
    const hit = Number(countStr) > 0;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    const entry = byFile.get(path!) ?? { covered: new Set<number>(), uncovered: new Set<number>() };
    for (let n = start; n <= end; n++) {
      if (hit) {
        entry.covered.add(n);
        entry.uncovered.delete(n);
      } else if (!entry.covered.has(n)) {
        entry.uncovered.add(n);
      }
    }
    byFile.set(path!, entry);
  }

  const files = [...byFile.entries()].map(([path, e]) =>
    fileFrom(path, [...e.covered], [...e.uncovered]),
  );
  return summarize("go", files);
}

/** Detecta o formato pelo conteúdo — a extensão mente com frequência. */
export function detectCoverageFormat(text: string): CoverageFormat {
  const head = text.slice(0, 4096);
  if (/^mode:\s/m.test(head)) return "go";
  if (/^SF:/m.test(head)) return "lcov";
  if (/<jcov\b|<coverage\b[^>]*\bversion="[^"]*"[^>]*\bjcov\b/i.test(head)) return "jcov";
  // OpenCppCoverage + gcov/VS exportam Cobertura; JaCoCo é o caso especial com
  // <report><package><sourcefile>. A ordem importa: jcov antes de jacoco.
  if (/<report\b[^>]*>|<\/report>/.test(head) || /<sourcefile\b/.test(text)) return "jacoco";
  if (/<coverage\b/.test(head)) return "cobertura";
  return "unknown";
}

export function parseCoverageText(text: string): CoverageReport | null {
  switch (detectCoverageFormat(text)) {
    case "lcov":
      return parseLcov(text);
    case "cobertura":
      return parseCobertura(text);
    case "jacoco":
      return parseJacoco(text);
    case "go":
      return parseGoCoverProfile(text);
    case "jcov":
      return parseJcov(text);
    default:
      return null;
  }
}

export function parseCoverageFile(path: string): CoverageReport | null {
  try {
    return parseCoverageText(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
