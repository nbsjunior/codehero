# Modelos offline — inteligência fora do hot path

**Para o líder técnico:** qualquer modelo (ranker, triagem, embed) roda **em lote**. O Quality Gate do PR continua determinístico. Isso é requisito de risco, não detalhe de implementação.

## fp-ranker — menos ruído com feedback real

1. Portal (projeto → overview): **Exportar feedback (treino)** (`exportRuleforgeFeedback`), ou fixture `scripts/fixtures/sample-ruleforge-feedback.json`.
2. Treine:

```bash
npm run fp:train-from-feedback -- path/to/feedback.json
npm run build:fp-ranker
npm run fp:train-from-feedback -- path/to/feedback.json --commit
```

Scanner/ingest usam `DEFAULT_MODEL` (fitted se `trainSize>0`). Seed: `HERO_RANKER_SEED=1`.

## Triagem em lote (opcional LLM local)

```bash
npm run triage:offline -- --sarif codehero.sarif --out reports/triage.json
# Com endpoint OpenAI-compatible:
npm run triage:offline -- --sarif codehero.sarif --out reports/triage.json \
  --llm-url http://127.0.0.1:11434/v1 --model foundation-sec
```

Portal: **Aplicar triage.json** → anota issues; **não** falha o CI sozinho.

Workflow: `examples/github-workflows/offline-triage.example.yml`.

## Mensagem para o board

| Offline (ok) | No PR (proibido no desenho) |
|---|---|
| Treinar ranker | LLM decidir o gate |
| Triagem em lote | Custo linear por arquivo |
| Code-embed / famílias | Não-determinismo no merge |

Ver também [Code-Embed.md](./Code-Embed.md) · [Posicionamento-e-metricas.md](./Posicionamento-e-metricas.md).
