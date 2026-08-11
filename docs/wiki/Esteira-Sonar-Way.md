# Esteira Sonar way — aproximar com prova, sem mentir para o board

**Para o líder:** cobertura “de catálogo” que conta stub como regra viva é dívida política. Esta esteira promove **VULN** só com detector + golden + F1; smells ficam stub ou entram via Presence/SARIF.

## Os 4 pontos (linguagem de gestão)

1. **Priorizar VULN** — backlog de vulnerabilidades stub / fora da curadoria.  
2. **Promover com prova** — P ≥ 0,85 e matches reais → entra no live.  
3. **Smells = ROI ou SARIF** — não auto-promover smell em massa.  
4. **Medir live scannable** — o que o motor carrega, não “covered” semântico cosmético.

## Comandos

```bash
npm run sonar:engenharia
npm run sonar:engenharia -- promote
npm run sonar:engenharia -- all
npm run sonar:engenharia -- report
```

Pipeline clássico: `sonar:fetch` → `sonar:generate` → `sonar:live` → `sonar:compare`.

## Artefatos

| Artefato | Papel |
|---|---|
| `scripts/sonar-way-engenharia.mjs` | Orquestrador |
| `packages/contracts/src/data/sonarWayCuration.json` | O que de fato roda |
| `reports/sonar-way-vuln-backlog.*` | Prioridade |
| `reports/sonar-way-live-scannable.json` | Métrica para o slide |

## O que isto **não** faz

Não copia analyzers Java/Roslyn do Sonar. Não promove smell em massa. Não conta stub como cobertura.

Posicionamento: [Posicionamento-e-metricas.md](./Posicionamento-e-metricas.md).
