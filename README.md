# CodeHero 🛡️

Plataforma SaaS de **análise estática e correção de código otimizada por IA** — modelo conceitual do SonarQube, com camada agêntica (SDD + MCP/Claude), rodando em **Firebase**.

> **Princípio central:** a IA nunca está no caminho crítico da inspeção. O motor que roda a cada commit é 100% determinístico; a IA opera offline (compila regras) e sob demanda (gera specs de correção verificáveis).

## Monorepo

```
packages/
  contracts/       # SARIF-estendido, SDD Spec (zod), catálogo de regras (Hero-IR), fórmulas SQALE
  scanner/         # hero-scanner: CLI TS que varre código e emite SARIF  [MÓDULO 1]
  mcp/             # hero-mcp: servidor MCP p/ Claude                      [MÓDULO 3]
  github-action/   # composite action: scan → ingest → quality gate       [MÓDULO 3]
apps/
  functions/       # Cloud Functions: ingest, métricas, SDD, provisioning  [MÓDULO 2]
  web/             # Dashboard Next.js (Firebase Hosting)                  [MÓDULO 2]
examples/          # arquivo vulnerável de teste
docs/ARCHITECTURE.md
```

## Setup

```bash
npm install
npm run build:contracts    # gera dist/ dos contratos (dep de scanner/functions/mcp)
```

## Módulo 1 — Scanner (funcional)

```bash
# relatório legível
node packages/scanner/src/index.ts examples/

# SARIF para arquivo
node packages/scanner/src/index.ts examples/ --sarif --out codehero.sarif
```

Node 22+ roda os `.ts` diretamente (type-stripping). Para um binário: `npm run build -w @codehero/scanner`.

## Módulo 2 — Backend (Firebase Functions)

```bash
npm run build:functions
firebase emulators:start          # requer Java (Firestore emulator)
```

Funções expostas:
- `ingestAnalysis` (HTTP, token) — recebe SARIF, calcula débito/quality gate, persiste issues.
- `listIssues` (HTTP, token) / `sddSpec` (HTTP, token) — leitura p/ CI e MCP.
- `generateSddSpec` (callable, auth) — SDD Spec p/ o dashboard.
- `provisionProject` (callable, auth) — onboarding: cria org + projeto + `ingestToken`.

## Módulo 3 — Integrações

**GitHub Action** — ver `packages/github-action/action.yml` e `.github/workflows/codehero.yml`.

**MCP (Claude)** — `packages/mcp`. Config em `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "codehero": {
      "command": "node",
      "args": ["<repo>/packages/mcp/dist/server.js"],
      "env": {
        "HERO_CORE_URL": "https://us-central1-<proj>.cloudfunctions.net",
        "HERO_TOKEN": "chp_...",
        "HERO_ORG_ID": "...",
        "HERO_PROJECT_ID": "..."
      }
    }
  }
}
```
Tools: `get_issues`, `get_sdd_spec`, `run_scan` (loop de correção verificável).

## Status

| Componente | Estado |
|---|---|
| Contratos (SARIF+/SDD/SQALE) | ✅ compila |
| Scanner → SARIF | ✅ roda e valida no exemplo |
| Functions (ingest/sdd/query/provision) | ✅ compila |
| MCP server | ✅ compila |
| GitHub Action | ✅ scaffold pronto |
| Dashboard Next.js | 🟡 scaffold (falta `npm install` no workspace + config Firebase) |

## Próximos passos

1. Emulador ponta a ponta: `provisionProject` → `ingestAnalysis` (SARIF do exemplo) → dashboard.
2. Deploy: bundlar contracts nas functions (esbuild) antes de `firebase deploy`.
3. V1: VS Code LSP, `hero-ruleforge` (corpus golden), engine Rust/tree-sitter.

Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
