/**
 * External tool adapters — Presence Pack (Fase 2).
 *
 * Soft-fail: missing binary → hint, empty list (same spirit as Joern).
 * Output SARIF paths for importSarifFiles → EXT:<tool>:<rule>.
 */
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export interface ExternalRunResult {
  tool: string;
  ok: boolean;
  sarifPath: string | null;
  hint?: string;
  stderr?: string;
}

function runCapture(
  command: string,
  args: string[],
  opts?: { shell?: boolean },
): { status: number | null; stdout: string; stderr: string; error?: Error } {
  const r = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: opts?.shell ?? process.platform === "win32",
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    error: r.error,
  };
}

/** Oxlint — JS/TS fast lint with native SARIF. */
export function runOxlint(cwd = process.cwd()): ExternalRunResult {
  const dir = mkdtempSync(join(tmpdir(), "hero-oxlint-"));
  const out = join(dir, "oxlint.sarif");
  // Prefer npx so CI/dev don't need a global install.
  const r = runCapture("npx", ["--yes", "oxlint@latest", cwd, "-f", "sarif", "-o", out]);
  if (r.error) {
    return {
      tool: "oxlint",
      ok: false,
      sarifPath: null,
      hint: "Instale Node e rode: npx oxlint@latest . -f sarif -o oxlint.sarif",
      stderr: r.error.message,
    };
  }
  if (!existsSync(out)) {
    return {
      tool: "oxlint",
      ok: false,
      sarifPath: null,
      hint: "oxlint não gerou SARIF (exit " + String(r.status) + ")",
      stderr: (r.stderr || r.stdout).slice(0, 800),
    };
  }
  return { tool: "oxlint", ok: true, sarifPath: out };
}

/** Semgrep CE — multi-lang pattern / light dataflow. */
export function runSemgrep(cwd = process.cwd()): ExternalRunResult {
  const dir = mkdtempSync(join(tmpdir(), "hero-semgrep-"));
  const out = join(dir, "semgrep.sarif");
  const tryBin = (bin: string, args: string[]) => runCapture(bin, args);
  let r = tryBin("semgrep", ["scan", "--config", "auto", "--sarif", "--output", out, cwd]);
  if (r.error || (r.status !== 0 && !existsSync(out))) {
    r = tryBin("npx", ["--yes", "semgrep", "scan", "--config", "auto", "--sarif", "--output", out, cwd]);
  }
  if (!existsSync(out)) {
    return {
      tool: "semgrep",
      ok: false,
      sarifPath: null,
      hint: "Instale Semgrep (pip install semgrep) ou use CodeQL no CI e --import",
      stderr: (r.stderr || r.stdout || r.error?.message || "").slice(0, 800),
    };
  }
  return { tool: "semgrep", ok: true, sarifPath: out };
}

export type ScaTool = "trivy" | "osv";

/** SCA — dependency vulns (Trivy or osv-scanner). */
export function runSca(cwd = process.cwd(), tool: ScaTool = "trivy"): ExternalRunResult {
  const dir = mkdtempSync(join(tmpdir(), "hero-sca-"));
  const out = join(dir, `${tool}.sarif`);
  if (tool === "osv") {
    const r = runCapture("osv-scanner", ["--format", "sarif", "-o", out, cwd]);
    if (!existsSync(out)) {
      return {
        tool: "osv-scanner",
        ok: false,
        sarifPath: null,
        hint: "Instale osv-scanner (https://google.github.io/osv-scanner/) ou use trivy",
        stderr: (r.stderr || r.error?.message || "").slice(0, 800),
      };
    }
    return { tool: "osv-scanner", ok: true, sarifPath: out };
  }
  const r = runCapture("trivy", ["fs", "--format", "sarif", "-o", out, cwd]);
  if (!existsSync(out)) {
    return {
      tool: "trivy",
      ok: false,
      sarifPath: null,
      hint: "Instale Trivy (https://aquasecurity.github.io/trivy/) ou passe um SARIF via --import",
      stderr: (r.stderr || r.error?.message || "").slice(0, 800),
    };
  }
  return { tool: "trivy", ok: true, sarifPath: out };
}

/** Run requested adapters; return SARIF paths that exist. */
export function collectExternalSarifs(opts: {
  oxlint?: boolean;
  semgrep?: boolean;
  sca?: boolean;
  scaTool?: ScaTool;
  cwd?: string;
}): { paths: string[]; logs: ExternalRunResult[] } {
  const cwd = opts.cwd ?? process.cwd();
  const logs: ExternalRunResult[] = [];
  const paths: string[] = [];
  if (opts.oxlint) {
    const r = runOxlint(cwd);
    logs.push(r);
    if (r.ok && r.sarifPath) paths.push(r.sarifPath);
  }
  if (opts.semgrep) {
    const r = runSemgrep(cwd);
    logs.push(r);
    if (r.ok && r.sarifPath) paths.push(r.sarifPath);
  }
  if (opts.sca) {
    const r = runSca(cwd, opts.scaTool ?? "trivy");
    logs.push(r);
    if (r.ok && r.sarifPath) paths.push(r.sarifPath);
  }
  return { paths, logs };
}
