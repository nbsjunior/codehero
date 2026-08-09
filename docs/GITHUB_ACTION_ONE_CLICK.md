# GitHub Action — one-click (portal)

Guia para o **time do projeto**. Você configura a Action a partir do portal CodeHero e do repositório GitHub — sem precisar conhecer a infraestrutura do fornecedor.

## O que você faz

1. No portal → seu projeto → aba **GitHub Action** → **Configurar Action no GitHub (1 clique)**
2. Autorize o acesso pedido pelo portal (`repo` + `workflow`)
3. O CodeHero cria no repositório:
   - `.github/workflows/codehero.yml`
   - secret `HERO_TOKEN` (token de ingestão do projeto)
   - variable `HERO_CORE_URL` (endpoint público usado pela Action)

Fallbacks na mesma aba: script `gh`, deep link, YAML — se preferir configurar à mão.

## Depois do one-click

Abra um PR ou faça push: a Action roda o scanner, envia o relatório e avalia o quality gate. Severidades críticas podem falhar o job conforme a política do projeto.

## Presence Pack (SARIF / profundidade)

Para mais profundidade sem depender só do motor nativo, ligue na Action (ou no YAML):

| Input | Efeito |
|---|---|
| `metrics` | Default `true` — métricas de débito no CI |
| `semantic` | Taint/semantic TS mais profundo |
| `oxlint` | Roda Oxlint → `EXT:oxlint:*` |
| `semgrep` | Roda Semgrep → `EXT:semgrep:*` |
| `sca` + `sca-tool` | Trivy ou osv-scanner → SCA no gate |
| `import-sarif` | Paths de SARIF já gerados (ex.: CodeQL) |

Matriz completa: [docs/wiki/Presenca-SARIF.md](wiki/Presenca-SARIF.md). Workflow de exemplo: [`examples/github-workflows/codehero-presence.example.yml`](../examples/github-workflows/codehero-presence.example.yml).

Docs do produto: https://codehero.web.app/docs/#github-action
