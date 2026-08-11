# GitHub Action — gate no PR em um clique

**Para o líder técnico:** o menor caminho entre “aprovamos o CodeHero” e “o PR falha quando a política falha”. Sem o time aprender a infra do fornecedor.

## O que o time faz (5 minutos)

1. Portal → workspace → aba **GitHub Action** → **Configurar Action no GitHub (1 clique)**  
2. Autorize `repo` + `workflow`  
3. O CodeHero cria no repositório:
   - `.github/workflows/codehero.yml`
   - secret `HERO_TOKEN`
   - variable `HERO_CORE_URL`

Fallbacks na mesma aba: script `gh`, deep link, YAML manual.

## O que o board ganha

- Quality gate no merge (política do projeto)  
- Relatório no console executivo (débito, ratings, grafo)  
- Mesmo juiz se você ligar Presence (CodeQL/Semgrep/…)  

## Presence Pack (profundidade sem segundo juiz)

| Input | Efeito |
|---|---|
| `metrics` | Default `true` — métricas + grafo estrutural |
| `semantic` | Taint/semantic mais profundo |
| `oxlint` / `semgrep` / `sca` | Amplitude no mesmo gate |
| `import-sarif` | CodeQL (ou outro) já gerado |

Matriz: [wiki/Presenca-SARIF.md](wiki/Presenca-SARIF.md) · Exemplo: [`examples/github-workflows/codehero-presence.example.yml`](../examples/github-workflows/codehero-presence.example.yml)

Docs: https://codehero.web.app/docs/#github-action · Briefing: [wiki/Posicionamento-e-metricas.md](wiki/Posicionamento-e-metricas.md)
