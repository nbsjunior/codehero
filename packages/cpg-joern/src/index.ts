/**
 * Movimento 2 — Code Property Graph via Joern (opt-in).
 *
 * Joern materializa AST + CFG + DFG num grafo consultável. O CodeHero NÃO
 * embute a JVM: este pacote só orquestra (CLI local ou Docker) e devolve SARIF
 * para o caminho `--import` já existente (procedência EXT:joern:…).
 *
 * Requisito: JDK 11+ com `joern`/`joern-scan` no PATH, ou Docker com a imagem
 * `ghcr.io/joernio/joern`. Sem isso, `runJoernScan` falha com mensagem clara —
 * o scan L0/estrutural continua normalmente.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

export type JoernBackend = "cli" | "docker" | "none";

export interface JoernScanOptions {
  /** Root do código a analisar (absoluto ou relativo). */
  sourceRoot: string;
  /** Onde escrever o SARIF. Default: `<tmpdir>/codehero-joern-<hash>.sarif` */
  outSarif?: string;
  /** Imagem Docker se backend=docker. */
  dockerImage?: string;
  /** Timeout ms (default 10 min). */
  timeoutMs?: number;
}

export interface JoernScanResult {
  ok: boolean;
  backend: JoernBackend;
  sarifPath: string | null;
  findingsApprox: number;
  stderr: string;
  /** Mensagem acionável quando ok=false. */
  hint?: string;
}

function spawnText(v: string | Buffer | null | undefined): string {
  if (v == null) return "";
  return typeof v === "string" ? v : v.toString("utf8");
}

const DEFAULT_IMAGE = process.env.CODEHERO_JOERN_IMAGE || "ghcr.io/joernio/joern:latest";

export function detectJoernBackend(): JoernBackend {
  if (hasCmd("joern-scan") || hasCmd("joern")) return "cli";
  if (hasCmd("docker")) return "docker";
  return "none";
}

function hasCmd(bin: string): boolean {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], {
    encoding: "utf8",
  });
  return r.status === 0;
}

function queriesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/ → ../queries
  return join(here, "..", "queries");
}

/**
 * Roda Joern e produz um SARIF 2.1 mínimo.
 *
 * Estratégia:
 * 1. Preferir `joern-scan --output <sarif>` se existir.
 * 2. Senão Docker com o mesmo binário.
 * 3. Se a ferramenta só emitir JSON/CSV próprio, convertemos via
 *    `normalizeJoernJsonToSarif` (fallback).
 */
export function runJoernScan(opts: JoernScanOptions): JoernScanResult {
  const root = resolve(opts.sourceRoot);
  if (!existsSync(root)) {
    return {
      ok: false,
      backend: "none",
      sarifPath: null,
      findingsApprox: 0,
      stderr: `source root not found: ${root}`,
      hint: "Passe um diretório existente a --joern / runJoernScan.",
    };
  }

  const backend = detectJoernBackend();
  if (backend === "none") {
    return {
      ok: false,
      backend,
      sarifPath: null,
      findingsApprox: 0,
      stderr: "joern/joern-scan and docker not found",
      hint:
        "Instale Joern (https://joern.io) com JDK 11+, ou Docker, e reexecute com --joern. " +
        "Sem CPG o CodeHero segue no L0/estrutural; profundidade interprocedural fica opt-in.",
    };
  }

  const hash = createHash("sha1").update(root).digest("hex").slice(0, 10);
  const outSarif = opts.outSarif ?? join(tmpdir(), `codehero-joern-${hash}.sarif`);
  mkdirSync(dirname(outSarif), { recursive: true });

  const timeout = opts.timeoutMs ?? 600_000;
  const image = opts.dockerImage ?? DEFAULT_IMAGE;

  let run: ReturnType<typeof spawnSync>;
  if (backend === "cli") {
    const bin = hasCmd("joern-scan") ? "joern-scan" : "joern";
    // joern-scan: common flags vary by version; try SARIF output then JSON.
    run = spawnSync(bin, [root, "--output", outSarif], {
      encoding: "utf8",
      timeout,
      shell: process.platform === "win32",
    });
    if (run.status !== 0 && !existsSync(outSarif)) {
      const jsonOut = outSarif.replace(/\.sarif$/i, ".json");
      run = spawnSync(bin, [root, "-o", jsonOut], {
        encoding: "utf8",
        timeout,
        shell: process.platform === "win32",
      });
      if (existsSync(jsonOut)) {
        const sarif = normalizeJoernJsonToSarif(readFileSync(jsonOut, "utf8"));
        writeFileSync(outSarif, JSON.stringify(sarif, null, 2));
      }
    }
  } else {
    // Docker: mount source read-only, write SARIF to a sibling out dir.
    const outDir = dirname(outSarif);
    const outName = outSarif.split(/[/\\]/).pop()!;
    run = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${root}:/src:ro`,
        "-v",
        `${outDir}:/out`,
        image,
        "joern-scan",
        "/src",
        "--output",
        `/out/${outName}`,
      ],
      { encoding: "utf8", timeout },
    );
  }

  if (!existsSync(outSarif)) {
    // Last resort: emit empty SARIF shell so --import does not crash; mark failed.
    return {
      ok: false,
      backend,
      sarifPath: null,
      findingsApprox: 0,
      stderr: spawnText(run.stderr || run.stdout).slice(0, 2000),
      hint:
        "Joern rodou mas não produziu SARIF. Confira a versão (joern-scan --help) ou use " +
        "`--import` com um SARIF gerado manualmente a partir do Joern.",
    };
  }

  let findingsApprox = 0;
  try {
    const log = JSON.parse(readFileSync(outSarif, "utf8")) as {
      runs?: Array<{ results?: unknown[] }>;
    };
    findingsApprox = log.runs?.[0]?.results?.length ?? 0;
    // Stamp tool name so importSarif tags EXT:joern:…
    stampJoernDriver(outSarif);
  } catch {
    /* keep file as-is */
  }

  return {
    ok: true,
    backend,
    sarifPath: outSarif,
    findingsApprox,
    stderr: spawnText(run.stderr).slice(0, 500),
  };
}

/** Garante driver.name = Joern para a proveniência EXT:joern:*. */
export function stampJoernDriver(sarifPath: string): void {
  const log = JSON.parse(readFileSync(sarifPath, "utf8")) as {
    runs?: Array<{ tool?: { driver?: { name?: string; version?: string } } }>;
  };
  if (!log.runs?.[0]) return;
  log.runs[0].tool = log.runs[0].tool ?? { driver: { name: "Joern" } };
  log.runs[0].tool.driver = log.runs[0].tool.driver ?? { name: "Joern" };
  log.runs[0].tool.driver.name = "Joern";
  writeFileSync(sarifPath, JSON.stringify(log, null, 2));
}

/**
 * Converte um dump JSON típico do Joern (lista de findings) em SARIF 2.1.
 * Formatos variam; aceitamos `{ findings: [...] }` ou array raiz.
 */
export function normalizeJoernJsonToSarif(text: string): object {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = [];
  }
  const rows: Array<Record<string, unknown>> = Array.isArray(data)
    ? (data as Array<Record<string, unknown>>)
    : Array.isArray((data as { findings?: unknown }).findings)
      ? ((data as { findings: Array<Record<string, unknown>> }).findings)
      : [];

  const results = rows.map((r) => {
    const ruleId = String(r.name ?? r.title ?? r.rule ?? "joern-finding");
    const file = String(r.filename ?? r.file ?? r.path ?? "unknown");
    const line = Number(r.lineNumber ?? r.line ?? r.startLine ?? 1) || 1;
    const msg = String(r.description ?? r.message ?? ruleId);
    return {
      ruleId,
      level: "error",
      message: { text: msg },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: file.replace(/\\/g, "/") },
            region: { startLine: line },
          },
        },
      ],
      properties: {
        severity: "CRITICAL",
        issueType: "VULNERABILITY",
        source: "imported",
        tool: "Joern",
        originalRuleId: ruleId,
        engine: "cpg",
      },
    };
  });

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Joern",
            informationUri: "https://joern.io",
            rules: [],
          },
        },
        results,
      },
    ],
  };
}

export { queriesDir };
