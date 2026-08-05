/**
 * External tool adapters — Presence Pack (Fase 2).
 *
 * Soft-fail: missing binary → hint, empty list (same spirit as Joern).
 * Output SARIF paths for importSarifFiles → EXT:<tool>:<rule>.
 */
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { eslintJsonToSarif } from "./eslintSarif.ts";

export interface ExternalRunResult {
  tool: string;
  ok: boolean;
  sarifPath: string | null;
  hint?: string;
  stderr?: string;
}

/**
 * Executa sem SHELL, sempre.
 *
 * O motivo de `shell: true` existir aqui era o Windows: `npx`, `pmd` e
 * `spotbugs` são `.cmd`/`.bat`, e o `spawnSync` sem shell não faz a resolução
 * por PATHEXT. Mas com shell os argumentos são CONCATENADOS sem escape — e os
 * argumentos incluem o caminho do repositório analisado. Um diretório chamado
 * `foo & calc` viraria execução de comando.
 *
 * Um scanner de segurança não pode ter injeção de comando no próprio
 * adaptador. A resolução por extensão substitui o shell sem abrir essa porta.
 */
/**
 * Metacaracteres que o `cmd.exe` interpreta. Com `shell: true` os argumentos
 * são CONCATENADOS sem escape, então qualquer um destes num caminho vira
 * execução de comando.
 */
const METACARACTERE_SHELL = /[&|<>^"`$;\n\r]/;

function runCapture(
  command: string,
  args: string[],
  opts?: { cwd?: string },
): { status: number | null; stdout: string; stderr: string; error?: Error } {
  // No Windows as ferramentas de Node são `.cmd`, e desde a correção da
  // CVE-2024-27980 o Node RECUSA executá-las sem shell (EINVAL). Ou seja: shell
  // é obrigatório ali, e com shell os argumentos não são escapados.
  //
  // A saída é recusar em vez de arriscar. Todos os argumentos daqui são
  // literais fixos ou caminhos do sistema de arquivos; um caminho com `&` ou
  // `|` não é caso de uso legítimo, é vetor de injeção. Melhor a ferramenta
  // externa não rodar do que rodar `calc` no meio do scan.
  const precisaShell = process.platform === "win32";
  if (precisaShell) {
    const perigoso = [command, ...args].find((a) => METACARACTERE_SHELL.test(a));
    if (perigoso !== undefined) {
      return {
        status: null,
        stdout: "",
        stderr: "",
        error: new Error(
          `argumento com metacaractere de shell recusado: ${JSON.stringify(perigoso)}`,
        ),
      };
    }
  }

  const r = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: precisaShell,
    cwd: opts?.cwd,
  });
  // `encoding: "utf8"` garante string, mas a assinatura do spawnSync é
  // genérica demais para o TS saber disso.
  return {
    status: r.status,
    stdout: (r.stdout as unknown as string) ?? "",
    stderr: (r.stderr as unknown as string) ?? "",
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
  let r = runCapture("semgrep", ["scan", "--config", "auto", "--sarif", "--output", out, cwd]);
  if (r.error || (r.status !== 0 && !existsSync(out))) {
    r = runCapture("npx", ["--yes", "semgrep", "scan", "--config", "auto", "--sarif", "--output", out, cwd]);
  }
  if (!existsSync(out)) {
    return {
      tool: "semgrep",
      ok: false,
      sarifPath: null,
      hint: "Instale Semgrep (pip install semgrep) ou use --with-opengrep / CodeQL --import",
      stderr: (r.stderr || r.stdout || r.error?.message || "").slice(0, 800),
    };
  }
  return { tool: "semgrep", ok: true, sarifPath: out };
}

/**
 * Opengrep — motor OSS (LGPL) compatível com rulesets Semgrep.
 * Preferível no CI open-source quando Semgrep CE/Pro não está disponível.
 */
export function runOpengrep(cwd = process.cwd()): ExternalRunResult {
  const dir = mkdtempSync(join(tmpdir(), "hero-opengrep-"));
  const out = join(dir, "opengrep.sarif");
  // Binário `opengrep` (pip/cargo/release) ou npx wrapper se existir.
  let r = runCapture("opengrep", ["scan", "--config", "auto", "--sarif", "--output", out, cwd]);
  if (r.error || (r.status !== 0 && !existsSync(out))) {
    r = runCapture("npx", ["--yes", "opengrep", "scan", "--config", "auto", "--sarif", "--output", out, cwd]);
  }
  if (!existsSync(out)) {
    return {
      tool: "opengrep",
      ok: false,
      sarifPath: null,
      hint:
        "Instale Opengrep (https://github.com/opengrep/opengrep) ou use --with-semgrep / CodeQL --import",
      stderr: (r.stderr || r.stdout || r.error?.message || "").slice(0, 800),
    };
  }
  return { tool: "opengrep", ok: true, sarifPath: out };
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

/**
 * ESLint — o padrão de fato em Node.
 *
 * Competir com o ESLint escrevendo regras de JS é perder duas vezes: ele tem
 * mais regras que o SonarQube e um ecossistema que nenhum fornecedor alcança.
 * Integrar custa um adaptador; reimplementar custa anos.
 *
 * `-f json` em vez do formatador SARIF de propósito: aquele é um pacote extra
 * que teria de estar instalado no projeto ANALISADO, e o objetivo é rodar em
 * repositório de terceiro sem exigir instalação. A conversão fica em
 * `eslintSarif.ts`.
 */
export function runEslint(cwd = process.cwd()): ExternalRunResult {
  const dir = mkdtempSync(join(tmpdir(), "hero-eslint-"));
  const out = join(dir, "eslint.sarif");
  const r = runCapture("npx", ["--yes", "eslint", ".", "-f", "json", "--no-color"], { cwd });

  // ESLint sai com 1 quando ENCONTRA problema — isso é sucesso, não falha.
  // Só stdout vazio (ou não-JSON) indica que ele não rodou.
  const bruto = (r.stdout ?? "").trim();
  if (!bruto.startsWith("[")) {
    return {
      tool: "eslint",
      ok: false,
      sarifPath: null,
      hint: "ESLint não rodou (falta config eslint.config.js/.eslintrc no projeto?)",
      stderr: (r.stderr || r.error?.message || bruto).slice(0, 800),
    };
  }
  const sarif = eslintJsonToSarif(bruto);
  if (!sarif) {
    return { tool: "eslint", ok: false, sarifPath: null, hint: "saída do ESLint não pôde ser convertida" };
  }
  writeFileSync(out, JSON.stringify(sarif));
  return { tool: "eslint", ok: true, sarifPath: out };
}

/**
 * PMD — regras de manutenibilidade e bug em Java, direto no FONTE.
 *
 * Escolhido como primeiro adaptador de Java justamente por não exigir build:
 * o SpotBugs precisa de bytecode, e num scan de repositório arbitrário quase
 * nunca há `target/classes` compilado.
 */
export function runPmd(cwd = process.cwd()): ExternalRunResult {
  const dir = mkdtempSync(join(tmpdir(), "hero-pmd-"));
  const out = join(dir, "pmd.sarif");
  const args = ["check", "-d", cwd, "-R", "rulesets/java/quickstart.xml", "-f", "sarif", "-r", out, "--no-progress"];
  const r = runCapture("pmd", args);
  if (!existsSync(out)) {
    return {
      tool: "pmd",
      ok: false,
      sarifPath: null,
      hint: "Instale o PMD (https://pmd.github.io) e deixe `pmd` no PATH",
      stderr: (r.stderr || r.error?.message || "").slice(0, 800),
    };
  }
  return { tool: "pmd", ok: true, sarifPath: out };
}

/**
 * SpotBugs — análise de BYTECODE, portanto com tipo completo.
 *
 * É o equivalente Java da camada semântica que o `tsc` dá em TS: ele sabe o
 * tipo real de cada receptor, que é exatamente o que falta às regras de Java
 * do CodeHero (hoje 6 próprias, zero taint).
 *
 * O preço é precisar de classes compiladas. Sem elas, a mensagem tem de dizer
 * isso claramente em vez de sair "ferramenta indisponível" — o usuário
 * consegue resolver compilando, e não adivinha isso sozinho.
 */
export function runSpotbugs(cwd = process.cwd(), classesDir?: string): ExternalRunResult {
  const alvo =
    classesDir ??
    [join(cwd, "target", "classes"), join(cwd, "build", "classes"), join(cwd, "out")].find((p) =>
      existsSync(p),
    );
  if (!alvo) {
    return {
      tool: "spotbugs",
      ok: false,
      sarifPath: null,
      hint:
        "SpotBugs analisa BYTECODE: compile antes (mvn compile / gradle classes) " +
        "ou informe o diretório de classes. Sem isso, use --with-pmd, que roda no fonte.",
    };
  }
  const dir = mkdtempSync(join(tmpdir(), "hero-spotbugs-"));
  const out = join(dir, "spotbugs.sarif");
  const r = runCapture("spotbugs", ["-textui", "-sarif", "-output", out, "-quiet", alvo]);
  if (!existsSync(out)) {
    return {
      tool: "spotbugs",
      ok: false,
      sarifPath: null,
      hint: "Instale o SpotBugs (https://spotbugs.github.io) e deixe `spotbugs` no PATH",
      stderr: (r.stderr || r.error?.message || "").slice(0, 800),
    };
  }
  return { tool: "spotbugs", ok: true, sarifPath: out };
}

/** Run requested adapters; return SARIF paths that exist. */
export function collectExternalSarifs(opts: {
  oxlint?: boolean;
  eslint?: boolean;
  semgrep?: boolean;
  opengrep?: boolean;
  pmd?: boolean;
  spotbugs?: boolean;
  spotbugsClasses?: string;
  sca?: boolean;
  scaTool?: ScaTool;
  cwd?: string;
}): { paths: string[]; logs: ExternalRunResult[] } {
  const cwd = opts.cwd ?? process.cwd();
  const logs: ExternalRunResult[] = [];
  const paths: string[] = [];
  const rodar = (r: ExternalRunResult) => {
    logs.push(r);
    if (r.ok && r.sarifPath) paths.push(r.sarifPath);
  };
  if (opts.oxlint) rodar(runOxlint(cwd));
  if (opts.eslint) rodar(runEslint(cwd));
  if (opts.opengrep) rodar(runOpengrep(cwd));
  if (opts.semgrep) rodar(runSemgrep(cwd));
  if (opts.pmd) rodar(runPmd(cwd));
  if (opts.spotbugs) rodar(runSpotbugs(cwd, opts.spotbugsClasses));
  if (opts.sca) rodar(runSca(cwd, opts.scaTool ?? "trivy"));
  return { paths, logs };
}
