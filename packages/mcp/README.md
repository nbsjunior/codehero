# codehero-mcp

Servidor MCP do CodeHero — **plug-and-play** para Cursor, Claude Desktop e GitHub Copilot.

> Nome no npm: **`codehero-mcp`** (sem scope). O workspace interno do monorepo continua em `packages/mcp`.

## Instalação rápida (sem clonar o monorepo)

1. No portal: **Projetos → Integração MCP** → copie o `mcp.json` (já vem com token/org/project).
2. Cole em:
   - **Cursor:** `.cursor/mcp.json` (ou Settings → MCP)
   - **Copilot:** `.vscode/mcp.json`
   - **Claude Desktop:** `claude_desktop_config.json`
3. Reinicie o agente. Pronto.

O JSON usa:

```json
{
  "mcpServers": {
    "codehero": {
      "command": "npx",
      "args": ["-y", "codehero-mcp@latest"],
      "env": {
        "HERO_CORE_URL": "https://codehero.web.app/api",
        "HERO_TOKEN": "…",
        "HERO_ORG_ID": "…",
        "HERO_PROJECT_ID": "…",
        "HERO_REPO_ID": "…"
      }
    }
  }
}
```

Requisito: **Node.js ≥ 20** no PATH (`npx` disponível).

## Ferramentas

| Tool | Precisa de token? | Precisa de scanner local? |
|---|---|---|
| `get_generation_context` | overlay sim / core não | Não |
| `get_active_rules` | overlay sim / core não | Não |
| `get_issues` | Sim | Não |
| `get_sdd_spec` | Sim | Não |
| `submit_fix_result` | Sim | Não |
| `apply_sdd_workflow` | Não | Não |
| `run_scan` | Opcional | Sim (`HERO_SCANNER_CMD`) |

No modo plug-and-play, **não** configure `HERO_SCANNER_CMD` — o loop de correção usa a API (`get_issues` / SDD). Scanner local é avançado (monorepo).

## Publicar no npm (maintainers)

```bash
npm login
npm run build -w codehero-mcp
npm publish -w codehero-mcp
```

Não use o scope `@codehero/...` até criar a organização [@codehero](https://www.npmjs.com/org/create) no npm e ter permissão nela — o `PUT` retorna 404 sem org.

## Dev local

```bash
npm run build -w codehero-mcp
node packages/mcp/dist/server.js
```
