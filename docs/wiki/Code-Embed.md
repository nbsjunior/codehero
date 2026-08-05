# Code Embed — aprendizado não supervisionado (AST → vetor → K-Means)

Offline only. **Não** roda no Quality Gate do PR.

Inspirado em Code2Vec / AST-NN + clustering industrial:

1. **AST** via tree-sitter (`@codehero/engine`)
2. **Embedding** — caminhos de tipos de nó (feature hashing, dim 64), sem rede neural
3. **K-Means** determinístico (seed=42) → famílias `fam-{k}-{i}`
4. **PCA 2D** opcional no relatório (visualização)
5. **Anotação** SARIF / portal → features do fp-ranker (`clusterOutlier`, `clusterSizeNorm`)

## Comandos

```bash
npm run build:engine
npm run build:code-embed

# Agrupa funções do repositório
npm run code-embed:cluster -- . --out reports/code-embed-clusters.json

# Com k fixo + anotar SARIF existente
npx hero-code-embed cluster . --k 12 --out reports/code-embed-clusters.json \
  --annotate-sarif codehero.sarif --sarif-out codehero.clustered.sarif
```

Depois:

- Ingest do SARIF anotado, **ou**
- Portal → **Aplicar triage / code-embed JSON** (callable `applyCodeEmbedClusters`)

## O que aparece no portal

- Provenance: `família fam-8-3 · 12` ou `família … (outlier)`
- fp-ranker usa outlier/tamanho da família no score de assertividade (ainda **não** decide o gate sozinho)

## Limites (honestos)

- Embedding é **leve** (bag de caminhos AST), não GraphCodeBERT
- Melhor em JS/TS/Python/Java/Go/C#/COBOL/T-SQL já parseados pelo engine
- Famílias são hipótese de similaridade estrutural — validar com feedback FP/TP

## Anti-padrões

- Não usar clusterId como único fail do CI
- Não substituir CodeQL/Opengrep por clustering
- Não treinar rede no hot path do scan
