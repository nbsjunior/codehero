# CodeHero 🛡️

Plataforma SaaS de **análise estática e correção de código otimizada por IA** — modelo conceitual do SonarQube, com camada agêntica (SDD + MCP/Claude), rodando em **Firebase**.

> **Princípio central:** a IA nunca está no caminho crítico da inspeção. O motor que roda a cada commit é 100% determinístico; a IA opera offline (compila regras) e sob demanda (gera specs de correção verificáveis).

## Monorepo

```
packages/
  contracts/       # SARIF-estendido, SDD Spec (zod), catálogo de regras (Hero-IR), fórmulas SQALE, matcher compartilhado
  scanner/         # hero-scanner: CLI TS que varre código e emite SARIF  [MÓDULO 1]
  ruleforge/       # hero-ruleforge: busca evolutiva determinística de regras + corpus golden [MÓDULO 1 — evolução offline]
  mcp/             # hero-mcp: servidor MCP p/ Claude                      [MÓDULO 3]
  github-action/   # composite action: scan → ingest → quality gate       [MÓDULO 3]
apps/
  functions/       # Cloud Functions: ingest, métricas, SDD, provisioning, feedback [MÓDULO 2]
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

## Módulo 1 — Evolução de regras (hero-ruleforge)

Motor de busca evolutiva **100% determinístico** (sem chamada de LLM no loop de scoring) que valida/evolui as regras contra um corpus rotulado, com portão de promoção (F1 melhora + precisão ≥ 0.85 + zero regressão).

```bash
node packages/ruleforge/src/cli.ts evaluate      # precisão/recall/F1 de cada regra vs. corpus
node packages/ruleforge/src/cli.ts evolve-all    # roda a busca evolutiva em todas as regras com pool de mutações
```

Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#hero-ruleforge--como-as-regras-evoluem-sem-custo-de-ia-generativa-por-execução) para o resultado de uma execução real (2 regras promovidas, 1 mutação corretamente rejeitada).

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
- `flagIssueFeedback` (callable, auth) — humano marca falso-positivo/confirma issue no dashboard.
- `submitFixResult` (HTTP, token) — agente reporta resultado de um fix (usado pelo MCP); ambos alimentam o loop de melhoria contínua do `hero-ruleforge`.

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
Tools: `get_issues`, `get_sdd_spec`, `run_scan`, `submit_fix_result` (loop de correção verificável + telemetria).

## Status

| Componente | Estado |
|---|---|
| Contratos (SARIF+/SDD/SQALE/matcher) | ✅ compila |
| Scanner → SARIF | ✅ roda e valida no exemplo |
| hero-ruleforge (corpus + evolução) | ✅ **roda de verdade** — 2 regras promovidas, 1 rejeitada corretamente |
| Functions (ingest/sdd/query/provision/feedback) | ✅ compila + **verificado no emulador** |
| MCP server | ✅ compila |
| GitHub Action | ✅ scaffold pronto |
| Dashboard Next.js | 🟡 scaffold (falta `npm install` no workspace + config Firebase) |

## Próximos passos

1. Ligar o dashboard ao emulador/projeto real (auth + leitura de projetos).
2. Deploy: bundlar contracts nas functions (esbuild) antes de `firebase deploy`.
3. V1: VS Code LSP, engine Rust/tree-sitter, job agendado (Cloud Scheduler) que mescla `ruleforgeFeedback` no corpus golden automaticamente.

Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
