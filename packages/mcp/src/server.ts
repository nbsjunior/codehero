#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// hero-mcp — exposes CodeHero to any MCP client (e.g. Claude). Stateless: it
// proxies the token-guarded hero-core HTTP endpoints and can run a local scan.
//
// Config via env:
//   HERO_CORE_URL  base URL of the deployed functions (e.g.
//                  https://us-central1-<proj>.cloudfunctions.net)
//   HERO_TOKEN     per-project ingest token
//   HERO_ORG_ID / HERO_PROJECT_ID  default target project
// ---------------------------------------------------------------------------

const CORE_URL = process.env.HERO_CORE_URL ?? "http://127.0.0.1:5001/codehero-dev/us-central1";
const TOKEN = process.env.HERO_TOKEN ?? "";
const ORG_ID = process.env.HERO_ORG_ID ?? "";
const PROJECT_ID = process.env.HERO_PROJECT_ID ?? "";

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
}

const server = new McpServer({ name: "hero-mcp", version: "0.1.0" });

server.tool(
  "get_issues",
  "Lista as issues abertas de um projeto CodeHero (opcionalmente filtrando por severidade e código novo).",
  {
    orgId: z.string().default(ORG_ID),
    projectId: z.string().default(PROJECT_ID),
    severity: z.enum(["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"]).optional(),
    newCodeOnly: z.boolean().default(false),
  },
  async ({ orgId, projectId, severity, newCodeOnly }) => {
    const url = new URL(`${CORE_URL}/listIssues`);
    url.searchParams.set("orgId", orgId);
    url.searchParams.set("projectId", projectId);
    if (severity) url.searchParams.set("severity", severity);
    url.searchParams.set("newCodeOnly", String(newCodeOnly));
    const r = await fetch(url, { headers: authHeaders() });
    const body = await r.text();
    return { content: [{ type: "text", text: body }], isError: !r.ok };
  },
);

server.tool(
  "get_sdd_spec",
  "Gera a especificação SDD (contrato verificável de correção) para uma issue, identificada pelo fingerprint.",
  {
    orgId: z.string().default(ORG_ID),
    projectId: z.string().default(PROJECT_ID),
    fingerprint: z.string(),
  },
  async ({ orgId, projectId, fingerprint }) => {
    const r = await fetch(`${CORE_URL}/sddSpec`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ orgId, projectId, fingerprint }),
    });
    const body = await r.text();
    return { content: [{ type: "text", text: body }], isError: !r.ok };
  },
);

server.tool(
  "submit_fix_result",
  "Reporta o resultado de um fix aplicado a partir de um SDD Spec (applied/rejected/failed). Alimenta a taxa de sucesso do template de correção — não altera regras diretamente.",
  {
    orgId: z.string().default(ORG_ID),
    projectId: z.string().default(PROJECT_ID),
    fingerprint: z.string(),
    specId: z.string().optional(),
    status: z.enum(["applied", "rejected", "failed"]),
  },
  async ({ orgId, projectId, fingerprint, specId, status }) => {
    const r = await fetch(`${CORE_URL}/submitFixResult`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ orgId, projectId, fingerprint, specId, status }),
    });
    const body = await r.text();
    return { content: [{ type: "text", text: body }], isError: !r.ok };
  },
);

server.tool(
  "run_scan",
  "Roda o scanner CodeHero localmente com as regras ativas do servidor (canônicas + dress code) e retorna o relatório de análise.",
  { path: z.string().default(".") },
  async ({ path }) => {
    const cmd = (process.env.HERO_SCANNER_CMD ?? "").trim();
    if (!cmd) {
      return {
        content: [
          {
            type: "text",
            text:
              "Defina HERO_SCANNER_CMD (ex.: node /caminho/packages/scanner/dist/index.js). Não use npx hero-scan — pacote inexistente no npm.",
          },
        ],
        isError: true,
      };
    }
    const parts = cmd.split(/\s+/).filter(Boolean);
    const bin = parts[0]!;
    const prefix = parts.slice(1);
    const args = [...prefix, path, "--sarif"];
    if (CORE_URL) {
      args.push("--server", CORE_URL);
    }
    if (TOKEN) args.push("--token", TOKEN);
    if (ORG_ID) args.push("--org", ORG_ID);
    if (PROJECT_ID) args.push("--project", PROJECT_ID);
    const result = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
    if (result.error) {
      return { content: [{ type: "text", text: `scanner error: ${result.error.message}` }], isError: true };
    }
    return { content: [{ type: "text", text: result.stdout || result.stderr }] };
  },
);

server.tool(
  "apply_sdd_workflow",
  "Guia canônico do loop verificável CodeHero para Claude ou GitHub Copilot: issue → SDD → patch → run_scan → submit_fix_result.",
  {
    fingerprint: z.string().optional(),
  },
  async ({ fingerprint }) => {
    const text = [
      "CodeHero verified-fix workflow (Claude / Copilot):",
      "1. get_issues — pick a fingerprint" + (fingerprint ? ` (suggested: ${fingerprint})` : ""),
      "2. get_sdd_spec — obtain the verifiable remediation contract",
      "3. Edit code with a unified_diff scoped to the SDD location",
      "4. run_scan — assert RULE_RESOLVED (fingerprint gone) and NO_NEW_ISSUES",
      "5. submit_fix_result — status=applied|rejected|failed",
      "Never claim a fix is done without run_scan evidence.",
      "",
      "Before generating new code, call get_generation_context with entry describing the guardrails needed",
      '(e.g. "regras de avaliação de código CodeHero").',
    ].join("\n");
    return { content: [{ type: "text", text }] };
  },
);

server.tool(
  "get_active_rules",
  "Busca o catálogo ativo de regras determinísticas CodeHero (core + dress code do projeto) para o agente aplicar no contexto.",
  {
    orgId: z.string().default(ORG_ID),
    projectId: z.string().default(PROJECT_ID),
    maxRules: z.number().int().min(1).max(200).default(80),
  },
  async ({ orgId, projectId, maxRules }) => {
    const url = new URL(`${CORE_URL.replace(/\/$/, "")}/getActiveRules`);
    if (orgId) url.searchParams.set("orgId", orgId);
    if (projectId) url.searchParams.set("projectId", projectId);
    const r = await fetch(url, { headers: authHeaders() });
    const body = await r.text();
    if (!r.ok) {
      return { content: [{ type: "text", text: body || `getActiveRules HTTP ${r.status}` }], isError: true };
    }
    try {
      const data = JSON.parse(body) as {
        version?: string;
        canonicalCount?: number;
        overlayCount?: number;
        rules?: Array<{
          id: string;
          name: string;
          severity: string;
          type: string;
          message: string;
          category?: string;
          languages?: string[];
        }>;
      };
      const rules = (data.rules ?? []).slice(0, maxRules);
      const summary = {
        version: data.version,
        canonicalCount: data.canonicalCount,
        overlayCount: data.overlayCount,
        returned: rules.length,
        rules: rules.map((rule) => ({
          id: rule.id,
          name: rule.name,
          severity: rule.severity,
          type: rule.type,
          category: rule.category ?? null,
          languages: rule.languages ?? [],
          message: rule.message,
        })),
      };
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    } catch {
      return { content: [{ type: "text", text: body }] };
    }
  },
);

server.tool(
  "get_generation_context",
  "Monta um bloco de contexto para geração de código a partir de uma entrada em linguagem natural (ex.: buscar regras CodeHero e aplicar no contexto). O agente deve injetar o retorno no system/user prompt antes de gerar ou editar código.",
  {
    entry: z
      .string()
      .describe(
        'O que carregar no contexto. Ex.: "Buscar regras de avaliação de código (CodeHero) e aplicar no contexto que está sendo gerado"',
      ),
    orgId: z.string().default(ORG_ID),
    projectId: z.string().default(PROJECT_ID),
  },
  async ({ entry, orgId, projectId }) => {
    const intent = entry.trim().toLowerCase();
    const wantRules =
      /regra|rule|avalia|avaliaç|avaliac|qualidade|secur|segurança|dress|sast|codehero|guardrail|lint/.test(
        intent,
      ) || intent.length < 8;
    const wantIssues = /issue|apontamento|finding|d[eé]bito|blocker|critical/.test(intent);

    const sections: string[] = [
      "# CodeHero — contexto de geração",
      `Entrada solicitada: ${entry.trim() || "(padrão: regras de avaliação)"}`,
      "",
      "Instruções obrigatórias para o agente:",
      "- Respeite as regras abaixo ao gerar ou editar código.",
      "- Não introduza padrões listados como VULNERABILITY / CODE_SMELL.",
      "- Se alterar código para corrigir findings, rode run_scan e use submit_fix_result.",
      "",
    ];

    if (wantRules) {
      const url = new URL(`${CORE_URL.replace(/\/$/, "")}/getActiveRules`);
      if (orgId) url.searchParams.set("orgId", orgId);
      if (projectId) url.searchParams.set("projectId", projectId);
      const r = await fetch(url, { headers: authHeaders() });
      const body = await r.text();
      if (!r.ok) {
        sections.push(`## Regras ativas\nFalha ao carregar: HTTP ${r.status}\n${body.slice(0, 500)}`);
      } else {
        try {
          const data = JSON.parse(body) as {
            version?: string;
            canonicalCount?: number;
            overlayCount?: number;
            rules?: Array<{
              id: string;
              name: string;
              severity: string;
              type: string;
              message: string;
              category?: string;
            }>;
          };
          const order = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"];
          const rules = [...(data.rules ?? [])].sort(
            (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
          );
          sections.push(
            `## Regras ativas CodeHero (v=${data.version ?? "?"}, core=${data.canonicalCount ?? 0}, overlay=${data.overlayCount ?? 0})`,
          );
          for (const rule of rules.slice(0, 60)) {
            sections.push(
              `- [${rule.severity}/${rule.type}] ${rule.id} — ${rule.name}: ${rule.message}${rule.category ? ` (${rule.category})` : ""}`,
            );
          }
          if (rules.length > 60) sections.push(`… +${rules.length - 60} regras omitidas (use get_active_rules).`);
        } catch {
          sections.push(`## Regras ativas\n${body.slice(0, 4000)}`);
        }
      }
      sections.push("");
    }

    if (wantIssues && orgId && projectId) {
      const url = new URL(`${CORE_URL.replace(/\/$/, "")}/listIssues`);
      url.searchParams.set("orgId", orgId);
      url.searchParams.set("projectId", projectId);
      url.searchParams.set("limit", "20");
      const r = await fetch(url, { headers: authHeaders() });
      const body = await r.text();
      sections.push("## Apontamentos abertos (amostra)");
      sections.push(r.ok ? body.slice(0, 6000) : `Falha listIssues: ${body.slice(0, 500)}`);
      sections.push("");
    }

    sections.push(
      "## Próximo passo",
      "Gere ou edite o código respeitando o bloco acima. Em dúvida, chame get_active_rules ou get_issues.",
    );

    return { content: [{ type: "text", text: sections.join("\n") }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("hero-mcp server ready (stdio)");
