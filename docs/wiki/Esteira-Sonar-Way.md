# Esteira de engenharia Sonar way

Como aproximar o CodeHero do Sonar way **sem mentir com stubs**.

## Os 4 pontos

1. **Priorizar VULN** — backlog só de `VULNERABILITY` stub / ainda fora da curadoria (`reports/sonar-way-vuln-backlog.*`).
2. **Promover com prova** — template L0 (ou L1/L2 depois) + sementes golden + portão **P ≥ 0,85** e ≥1 match + ≥1 no_match → entra em `sonarWayCuration.selecao`.
3. **Smells = ROI ou SARIF** — `CODE_SMELL` não é auto-promovido; effort &lt; 15 fica stub; Presence Pack importa Sonar/Semgrep.
4. **Medir live scannable** — % na curadoria (o que o motor carrega), não “covered” semântico nem stub de catálogo.

## Comandos

```bash
# Backlog + política de smell + live scannable
npm run sonar:engenharia

# Gera templates, promove VULNs que passam F1, rebuild live + contracts
npm run sonar:engenharia -- promote

# Esteira completa (+ compare)
npm run sonar:engenharia -- all

# Só relatório live
npm run sonar:engenharia -- report
```

Pipeline clássico (inalterado):

```bash
npm run sonar:fetch      # snapshots API pública
npm run sonar:generate   # catálogo live L0 + stubs
npm run sonar:live       # deriva sonarWayLiveRules.json da curadoria
npm run sonar:compare    # semântica Hero↔Sonar + bloco live scannable
```

## Arquivos

| Artefato | Papel |
|---|---|
| `scripts/generate-sonar-way-rules.mjs` | Templates (incl. wave2 VULN) |
| `scripts/data/sonar-port-golden-seeds.json` | Sementes match/no_match por template |
| `scripts/sonar-way-engenharia.mjs` | Orquestrador dos 4 pontos |
| `packages/contracts/src/data/sonarWayCuration.json` | O que de fato roda |
| `reports/sonar-way-vuln-backlog.*` | Prioridade |
| `reports/sonar-way-promote.json` | Última promoção |
| `reports/sonar-way-live-scannable.json` | Métrica live |
| `reports/sonar-way-coverage.md` | Compare (semântica + live) |

## O que isto não faz

- Não copia analyzers Java/Roslyn do Sonar.
- Não promove smell em massa (quebraria P≥0,85).
- Não conta stub como cobertura.

Posicionamento: [Posicionamento-e-metricas.md](./Posicionamento-e-metricas.md).
