# Modelos offline (Presence Fase 4)

LLM **não** entra no quality gate do PR. Usa-se só em lote.

## fp-ranker (treino com feedback real)

1. No portal (projeto → overview): **Exportar feedback (treino)** — chama `exportRuleforgeFeedback`.
   Ou fixture: `scripts/fixtures/sample-ruleforge-feedback.json`.
2. Treine:

```bash
# one-shot (escreve reports/assertiveness.fitted.json)
npm run fp:train-from-feedback -- path/to/feedback.json

# ativar no runtime (trainSize>0 → DEFAULT_MODEL carrega o JSON)
npm run build:fp-ranker
npm run fp:train-from-feedback -- path/to/feedback.json --commit
```

Equivalente manual:

```bash
npm run fp:feedback-to-training -- feedback.json reports/fp-training.json
npm run fp-ranker:train -- reports/fp-training.json packages/fp-ranker/models/assertiveness.json
```

3. Scanner/ingest usam `@codehero/fp-ranker` `DEFAULT_MODEL` (fitted se `trainSize>0`, senão seed).
   Force seed: `HERO_RANKER_SEED=1`. Override path: `HERO_RANKER_MODEL=/path/model.json`.

## Foundation-Sec / LLM local (triagem batch)

```bash
# Heurística (sem GPU):
npm run triage:offline -- --sarif codehero.sarif --out reports/triage.json

# Com endpoint OpenAI-compatible (Ollama / llama.cpp / Foundation-Sec):
npm run triage:offline -- --sarif codehero.sarif --out reports/triage.json \
  --llm-url http://127.0.0.1:11434/v1 --model foundation-sec
```

No portal: **Aplicar triage.json** no repo → callable `applyOfflineTriage` grava
`triageScore` / `likelyTruePositive` nos issues. O findings browser mostra
`triagem N% TP` — **não** falha o CI sozinho.

Workflow exemplo (schedule/manual): `.github/workflows/offline-triage.example.yml`.

Ingest também aceita `properties.triageScore` no SARIF, se a triagem for fundida antes do upload.

## Genkit / ruleforge / CVE

| Passo | Comando / local | Portão |
|---|---|---|
| Minerar fixes CVE | `npm run cve:mine` | — |
| Mesclar no golden | `npm run cve:merge-corpus -- reports/cve-mined/corpus/….json` | só anexa casos |
| Avaliar / evoluir | `npm run ruleforge:evaluate` · `npm run ruleforge:evolve-all` | `evolve.ts`: **ΔF1>0 ∧ P≥0.85** |
| Genkit diário | `ruleforgeDaily` / Esteira no portal | propõe; humano aprova; evolve decide |

Sem corpus / sem P≥0.85 a proposta **não** vira regra no hot path.

## Code Embed (não supervisionado)

```bash
npm run code-embed:cluster -- . --out reports/code-embed-clusters.json
# anotar SARIF ou aplicar JSON no portal (famílias AST)
```

Ver [Code-Embed.md](./Code-Embed.md).

## Anti-padrões

- Não chamar Foundation-Sec por arquivo no GitHub Action do PR.
- Não promover regra Genkit sem corpus.
- Não apagar provenance `EXT:*` ao fundir triagem.
- Não usar `triageScore` como único critério do Quality Gate.
- Gate suppress por FP local (n≥5, rate≥0.6) é aprendizado de **política**, não de detecção: o achado permanece no portal.
