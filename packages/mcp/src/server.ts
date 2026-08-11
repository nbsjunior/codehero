#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  SCAN_PROFILE_IDS,
  SCAN_PROFILES,
  isScanProfileId,
  scanProfileToCliArgs,
} from "@codehero/contracts";

// ---------------------------------------------------------------------------
// hero-mcp — stdio MCP for Cursor / Claude / GitHub Copilot.
//
// Plug-and-play:
//   npx -y codehero-mcp
//
// Env (painel → Integração MCP preenche o mcp.json):
//   HERO_CORE_URL   default https://codehero.web.app/api
//   HERO_TOKEN      ingest token do repositório
//   HERO_ORG_ID / HERO_PROJECT_ID / HERO_REPO_ID
//   HERO_SCANNER_CMD  opcional — só para run_scan local
//   HERO_SCAN_PROFILE  default native (presence|java|full)
// ---------------------------------------------------------------------------

const DEFAULT_CORE = "https://codehero.web.app/api";

const CORE_URL = (
  process.env.HERO_CORE_URL ||
  process.env.CODEHERO_API_URL ||
  DEFAULT_CORE
).replace(/\/$/, "");
const TOKEN = process.env.HERO_TOKEN ?? process.env.CODEHERO_TOKEN ?? "";
const ORG_ID = process.env.HERO_ORG_ID ?? process.env.CODEHERO_ORG_ID ?? "";
const PROJECT_ID = process.env.HERO_PROJECT_ID ?? process.env.CODEHERO_PROJECT_ID ?? "";
const REPO_ID = process.env.HERO_REPO_ID ?? process.env.CODEHERO_REPO_ID ?? "";
const DEFAULT_PROFILE = isScanProfileId(process.env.HERO_SCAN_PROFILE)
  ? process.env.HERO_SCAN_PROFILE!
  : "native";

/** Local deterministic code-graph (HERO_CODE_GRAPH or .codehero/code-graph.json). */
function resolveGraphPath(): string | null {
  const fromEnv = (process.env.HERO_CODE_GRAPH ?? "").trim();
  if (fromEnv) return fromEnv;
  const fallback = join(process.cwd(), ".codehero", "code-graph.json");
  return existsSync(fallback) ? fallback : null;
}

async function loadLocalGraph() {
  const path = resolveGraphPath();
  if (!path || !existsSync(path)) return null;
  try {
    const { loadCodeGraph } = await import("@codehero/code-graph");
    return { path, doc: loadCodeGraph(path) };
  } catch {
    return null;
  }
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
}

const server = new McpServer({ name: "hero-mcp", version: "0.3.0" });

server.tool(
  "list_scan_profiles",
  "Lista os perfis de orquestração canônicos (native|presence|java|full) usados igualmente por CLI, Action, MCP e IDE.",
  {},
  async () => {
    const body = SCAN_PROFILE_IDS.map((id) => ({
      id,
      label: SCAN_PROFILES[id].label,
      summary: SCAN_PROFILES[id].summary,
      engines: SCAN_PROFILES[id].engines,
    }));
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  },
);

server.tool(
  "get_issues",
  "Lista as issues abertas de um repositório CodeHero (opcionalmente filtrando por severidade e código novo). Mesma fonte do portal.",
  {
    orgId: z.string().default(ORG_ID),
    projectId: z.string().default(PROJECT_ID),
    repoId: z.string().default(REPO_ID),
    severity: z.enum(["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"]).optional(),
    newCodeOnly: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(100),
  },
  async ({ orgId, projectId, repoId, severity, newCodeOnly, limit }) => {
    if (!TOKEN) {
      return {
        content: [{ type: "text", text: "HERO_TOKEN ausente. Cole o mcp.json do painel CodeHero (Integração MCP)." }],
        isError: true,
      };
    }
    if (!repoId) {
      return {
        content: [{ type: "text", text: "repoId é obrigatório (defina HERO_REPO_ID ou passe repoId)." }],
        isError: true,
      };
    }
    const url = new URL(`${CORE_URL}/listIssues`);
    url.searchParams.set("orgId", orgId);
    url.searchParams.set("projectId", projectId);
    url.searchParams.set("repoId", repoId);
    if (severity) url.searchParams.set("severity", severity);
    url.searchParams.set("newCodeOnly", String(newCodeOnly));
    url.searchParams.set("limit", String(limit));
    const r = await fetch(url, { headers: authHeaders() });
    const body = await r.text();
    return { content: [{ type: "text", text: body }], isError: !r.ok };
  },
);

server.tool(
  "get_repo_status",
  "Quality gate e métricas do repositório (mesma superfície do portal). GET /repoStatus.",
  {
    orgId: z.string().default(ORG_ID),
    projectId: z.string().default(PROJECT_ID),
    repoId: z.string().default(REPO_ID),
  },
  async ({ orgId, projectId, repoId }) => {
    if (!TOKEN) {
      return {
        content: [{ type: "text", text: "HERO_TOKEN ausente. Cole o mcp.json do painel CodeHero." }],
        isError: true,
      };
    }
    if (!repoId) {
      return {
        content: [{ type: "text", text: "repoId é obrigatório (defina HERO_REPO_ID ou passe repoId)." }],
        isError: true,
      };
    }
    const url = new URL(`${CORE_URL}/repoStatus`);
    url.searchParams.set("orgId", orgId);
    url.searchParams.set("projectId", projectId);
    url.searchParams.set("repoId", repoId);
    const r = await fetch(url, { headers: authHeaders() });
    const body = await r.text();
    return { content: [{ type: "text", text: body }], isError: !r.ok };
  },
);

server.tool(
  "get_sdd_spec",
  "Gera a especificação SDD (contrato verificável de correção) para uma issue, identificada pelo fingerprint. Se existir code-graph local, enriquece com callers/callees (determinístico, sem Gen AI).",
  {
    orgId: z.string().default(ORG_ID),
    projectId: z.string().default(PROJECT_ID),
    repoId: z.string().default(REPO_ID),
    fingerprint: z.string(),
  },
  async ({ orgId, projectId, repoId, fingerprint }) => {
    if (!TOKEN) {
      return {
        content: [{ type: "text", text: "HERO_TOKEN ausente. Cole o mcp.json do painel CodeHero." }],
        isError: true,
      };
    }
    if (!repoId) {
      return {
        content: [{ type: "text", text: "repoId é obrigatório (defina HERO_REPO_ID ou passe repoId)." }],
        isError: true,
      };
    }
    const r = await fetch(`${CORE_URL}/sddSpec`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ orgId, projectId, repoId, fingerprint }),
    });
    const body = await r.text();
    if (!r.ok) return { content: [{ type: "text", text: body }], isError: true };

    try {
      const spec = JSON.parse(body) as {
        location?: { file?: string; range?: { startLine?: number } };
        context?: Record<string, unknown>;
      };
      const file = spec.location?.file;
      const line = spec.location?.range?.startLine;
      const g = await loadLocalGraph();
      if (g && file && line) {
        const { enrichFinding } = await import("@codehero/code-graph");
        const ev = enrichFinding(g.doc, file, line);
        spec.context = {
          ...(spec.context ?? {}),
          imports:
            Array.isArray(spec.context?.imports) && (spec.context!.imports as string[]).length
              ? spec.context!.imports
              : ev.imports,
          callGraph: {
            functionId: ev.functionId,
            functionName: ev.functionName,
            fanIn: ev.fanIn,
            fanOut: ev.fanOut,
            hopsToEntry: ev.hopsToEntry,
            callers: ev.callers,
            callees: ev.callees,
            priority: ev.priority,
          },
        };
        return { content: [{ type: "text", text: JSON.stringify(spec, null, 2) }] };
      }
    } catch {
      // fall through — return raw body
    }
    return { content: [{ type: "text", text: body }] };
  },
);

server.tool(
  "submit_fix_result",
  "Reporta o resultado de um fix aplicado a partir de um SDD Spec (applied/rejected/failed). Alimenta a taxa de sucesso do template de correção — não altera regras diretamente.",
  {
    orgId: z.string().default(ORG_ID),
    projectId: z.string().default(PROJECT_ID),
    repoId: z.string().default(REPO_ID),
    fingerprint: z.string(),
    specId: z.string().optional(),
    status: z.enum(["applied", "rejected", "failed"]),
  },
  async ({ orgId, projectId, repoId, fingerprint, specId, status }) => {
    if (!TOKEN) {
      return {
        content: [{ type: "text", text: "HERO_TOKEN ausente. Cole o mcp.json do painel CodeHero." }],
        isError: true,
      };
    }
    if (!repoId) {
      return {
        content: [{ type: "text", text: "repoId é obrigatório (defina HERO_REPO_ID ou passe repoId)." }],
        isError: true,
      };
    }
    const r = await fetch(`${CORE_URL}/submitFixResult`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ orgId, projectId, repoId, fingerprint, specId, status }),
    });
    const body = await r.text();
    return { content: [{ type: "text", text: body }], isError: !r.ok };
  },
);

server.tool(
  "run_scan",
  "Roda o scanner CodeHero localmente com o mesmo --profile da Action/IDE. Requer HERO_SCANNER_CMD. Sem isso, use get_issues / get_repo_status via API.",
  {
    path: z.string().default("."),
    profile: z.enum(["native", "presence", "java", "full"]).default(DEFAULT_PROFILE as "native"),
    ingest: z
      .boolean()
      .default(false)
      .describe("Se true e HERO_TOKEN+ids estiverem setados, envia o SARIF para ingestAnalysis (paridade com CI)."),
    spotbugsClasses: z.string().optional(),
  },
  async ({ path, profile, ingest, spotbugsClasses }) => {
    const cmd = (process.env.HERO_SCANNER_CMD ?? "").trim();
    if (!cmd) {
      return {
        content: [
          {
            type: "text",
            text: [
              "run_scan precisa de HERO_SCANNER_CMD (opcional no plug-and-play).",
              "Modo API: use get_issues / get_repo_status / get_sdd_spec / get_active_rules — não exigem scanner local.",
              "Avançado: HERO_SCANNER_CMD=\"node caminho/packages/scanner/dist/index.js\"",
              `Perfis: ${SCAN_PROFILE_IDS.join("|")} (default env HERO_SCAN_PROFILE=${DEFAULT_PROFILE})`,
            ].join("\n"),
          },
        ],
        isError: true,
      };
    }
    const parts = cmd.split(/\s+/).filter(Boolean);
    const bin = parts[0]!;
    const prefix = parts.slice(1);
    const profileArgs = scanProfileToCliArgs(profile);
    const args = [...prefix, path, "--sarif", "--out", "codehero.sarif", ...profileArgs];
    if (spotbugsClasses) args.push("--spotbugs-classes", spotbugsClasses);
    if (CORE_URL) args.push("--server", CORE_URL);
    if (TOKEN) args.push("--token", TOKEN);
    if (ORG_ID) args.push("--org", ORG_ID);
    if (PROJECT_ID) args.push("--project", PROJECT_ID);
    const result = spawnSync(bin, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === "win32",
    });
    if (result.error) {
      return { content: [{ type: "text", text: `scanner error: ${result.error.message}` }], isError: true };
    }

    let ingestNote = "";
    if (ingest) {
      if (!TOKEN || !ORG_ID || !PROJECT_ID || !REPO_ID) {
        ingestNote =
          "\n[ingest pulado] Defina HERO_TOKEN, HERO_ORG_ID, HERO_PROJECT_ID, HERO_REPO_ID para sync ao portal.";
      } else {
        try {
          const { readFileSync } = await import("node:fs");
          const sarif = JSON.parse(readFileSync("codehero.sarif", "utf8"));
          const loc = Number(sarif?.runs?.[0]?.properties?.linesOfCode ?? 1) || 1;
          const r = await fetch(`${CORE_URL}/ingestAnalysis`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
              orgId: ORG_ID,
              projectId: PROJECT_ID,
              repoId: REPO_ID,
              branch: "local-mcp",
              linesOfCode: loc,
              newCodeFingerprints: [],
              sarif,
              source: "mcp",
            }),
          });
          const body = await r.text();
          ingestNote = r.ok
            ? `\n[ingest ok] ${body.slice(0, 500)}`
            : `\n[ingest falhou HTTP ${r.status}] ${body.slice(0, 400)}`;
        } catch (e) {
          ingestNote = `\n[ingest erro] ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    }

    const out = (result.stdout || result.stderr || "") + ingestNote;
    return { content: [{ type: "text", text: out || "(scan sem stdout — veja codehero.sarif)" }] };
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
      "CodeHero verified-fix workflow (Claude / Copilot / Cursor):",
      "1. get_issues — pick a fingerprint" + (fingerprint ? ` (suggested: ${fingerprint})` : ""),
      "2. get_sdd_spec — obtain the verifiable remediation contract",
      "3. Edit code with a unified_diff scoped to the SDD location",
      "4. run_scan(profile=presence|native, ingest=true) — se HERO_SCANNER_CMD; senão get_issues + get_repo_status",
      "5. submit_fix_result — status=applied|rejected|failed",
      "Never claim a fix is done without scan/API evidence.",
      "",
      "Before generating new code, call get_generation_context with entry describing the guardrails needed",
      '(e.g. "regras de avaliação de código CodeHero").',
      "",
      "Provenance: cada issue pode ter tool/engine/alsoRuleIds — trate EXT:* e “também …” como a mesma superfície do portal.",
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
    const url = new URL(`${CORE_URL}/getActiveRules`);
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
      "- Se alterar código para corrigir findings, use get_issues / run_scan e submit_fix_result.",
      "",
    ];

    if (wantRules) {
      const url = new URL(`${CORE_URL}/getActiveRules`);
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
      const repoId = REPO_ID;
      if (!repoId) {
        sections.push("## Apontamentos abertos\nDefina HERO_REPO_ID para listar issues neste contexto.\n");
      } else if (!TOKEN) {
        sections.push("## Apontamentos abertos\nHERO_TOKEN necessário para listar issues.\n");
      } else {
        const url = new URL(`${CORE_URL}/listIssues`);
        url.searchParams.set("orgId", orgId);
        url.searchParams.set("projectId", projectId);
        url.searchParams.set("repoId", repoId);
        url.searchParams.set("limit", "20");
        const r = await fetch(url, { headers: authHeaders() });
        const body = await r.text();
        sections.push("## Apontamentos abertos (amostra)");
        sections.push(r.ok ? body.slice(0, 6000) : `Falha listIssues: ${body.slice(0, 500)}`);
        sections.push("");
      }
    }

    sections.push(
      "## Próximo passo",
      "Gere ou edite o código respeitando o bloco acima. Em dúvida, chame get_active_rules ou get_issues.",
    );

    return { content: [{ type: "text", text: sections.join("\n") }] };
  },
);

// Resources mirror the portal API so agents can subscribe without inventing a second model.
server.resource("issues", "codehero://issues", { description: "Issues abertas do repo (HERO_* env)" }, async (uri) => {
  if (!TOKEN || !REPO_ID) {
    return {
      contents: [
        {
          uri: uri.href,
          text: "Configure HERO_TOKEN e HERO_REPO_ID (mcp.json do painel).",
          mimeType: "text/plain",
        },
      ],
    };
  }
  const url = new URL(`${CORE_URL}/listIssues`);
  url.searchParams.set("orgId", ORG_ID);
  url.searchParams.set("projectId", PROJECT_ID);
  url.searchParams.set("repoId", REPO_ID);
  url.searchParams.set("limit", "100");
  const r = await fetch(url, { headers: authHeaders() });
  const text = await r.text();
  return {
    contents: [{ uri: uri.href, text, mimeType: "application/json" }],
  };
});

server.resource(
  "quality-gate",
  "codehero://quality-gate",
  { description: "Status do quality gate do repositório" },
  async (uri) => {
    if (!TOKEN || !REPO_ID) {
      return {
        contents: [
          {
            uri: uri.href,
            text: "Configure HERO_TOKEN e HERO_REPO_ID.",
            mimeType: "text/plain",
          },
        ],
      };
    }
    const url = new URL(`${CORE_URL}/repoStatus`);
    url.searchParams.set("orgId", ORG_ID);
    url.searchParams.set("projectId", PROJECT_ID);
    url.searchParams.set("repoId", REPO_ID);
    const r = await fetch(url, { headers: authHeaders() });
    const text = await r.text();
    return {
      contents: [{ uri: uri.href, text, mimeType: "application/json" }],
    };
  },
);

// --- Code-graph determinístico (sem Gen AI; distinto do Joern CPG) ------------

server.tool(
  "get_callers",
  "Lista callers de uma função no code-graph local (determinístico). Requer HERO_CODE_GRAPH ou .codehero/code-graph.json.",
  {
    nodeId: z.string().describe("Id do nó, ex. src/a.ts#handler@10"),
  },
  async ({ nodeId }) => {
    const g = await loadLocalGraph();
    if (!g) {
      return {
        content: [
          {
            type: "text",
            text: "Code-graph ausente. Rode: hero-code-graph build . -o .codehero/code-graph.json (ou hero-scan --code-graph).",
          },
        ],
        isError: true,
      };
    }
    const { callers } = await import("@codehero/code-graph");
    return { content: [{ type: "text", text: JSON.stringify(callers(g.doc, nodeId), null, 2) }] };
  },
);

server.tool(
  "get_callees",
  "Lista callees de uma função no code-graph local (determinístico).",
  { nodeId: z.string() },
  async ({ nodeId }) => {
    const g = await loadLocalGraph();
    if (!g) {
      return {
        content: [{ type: "text", text: "Code-graph ausente. Rode hero-code-graph build." }],
        isError: true,
      };
    }
    const { callees } = await import("@codehero/code-graph");
    return { content: [{ type: "text", text: JSON.stringify(callees(g.doc, nodeId), null, 2) }] };
  },
);

server.tool(
  "path_to_entrypoint",
  "Distância (hops) até um entrypoint via arestas calls — priorização estrutural sem Gen AI.",
  {
    nodeId: z.string(),
    maxDepth: z.number().int().min(1).max(32).default(12),
  },
  async ({ nodeId, maxDepth }) => {
    const g = await loadLocalGraph();
    if (!g) {
      return {
        content: [{ type: "text", text: "Code-graph ausente. Rode hero-code-graph build." }],
        isError: true,
      };
    }
    const { hopsToEntrypoint } = await import("@codehero/code-graph");
    const hops = hopsToEntrypoint(g.doc, nodeId, maxDepth);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { nodeId, hopsToEntry: hops, entries: g.doc.indexes.entries.slice(0, 20) },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.tool(
  "enrich_finding_graph",
  "Evidência estrutural (fan-in, callers, hops até entry) para um arquivo:linha — útil antes de aplicar SDD.",
  {
    file: z.string(),
    line: z.number().int().positive(),
  },
  async ({ file, line }) => {
    const g = await loadLocalGraph();
    if (!g) {
      return {
        content: [{ type: "text", text: "Code-graph ausente. Rode hero-code-graph build." }],
        isError: true,
      };
    }
    const { enrichFinding } = await import("@codehero/code-graph");
    return { content: [{ type: "text", text: JSON.stringify(enrichFinding(g.doc, file, line), null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`hero-mcp ready (stdio) · api=${CORE_URL} · profile=${DEFAULT_PROFILE}`);
