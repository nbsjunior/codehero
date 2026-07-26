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
  "Roda o hero-scanner localmente com as regras ativas do servidor (canônicas + dress code) e retorna o SARIF.",
  { path: z.string().default(".") },
  async ({ path }) => {
    const bin = process.env.HERO_SCANNER_CMD ?? "hero-scan";
    const args = [path, "--sarif"];
    if (CORE_URL) {
      args.push("--server", CORE_URL);
    }
    if (TOKEN) args.push("--token", TOKEN);
    if (ORG_ID) args.push("--org", ORG_ID);
    if (PROJECT_ID) args.push("--project", PROJECT_ID);
    const result = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
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
    ].join("\n");
    return { content: [{ type: "text", text }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("hero-mcp server ready (stdio)");
