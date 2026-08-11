# Code Embed — famílias de código sem supervisionar o gate

**Para o TL:** agrupa funções por forma de AST (famílias) e marca outliers. Ajuda a triagem e o fp-ranker. **Offline only** — não decide o Quality Gate.

Pipeline: AST (tree-sitter) → embedding leve (dim 64) → K-Means determinístico → anota SARIF / portal.

## Comandos

```bash
npm run build:engine && npm run build:code-embed
npm run code-embed:cluster -- . --out reports/code-embed-clusters.json
npx hero-code-embed cluster . --k 12 --out reports/code-embed-clusters.json \
  --annotate-sarif codehero.sarif --sarif-out codehero.clustered.sarif
```

Ingest do SARIF anotado ou portal → **Aplicar code-embed JSON**.

## No console

Provenance tipo `família fam-8-3 · 12` ou outlier. Features `clusterOutlier` / `clusterSizeNorm` no ranker — **não** são o juiz do merge.

## Limites (honestos no pitch)

Embedding leve (não GraphCodeBERT). Melhor nas langs já parseadas pelo engine. Ver [Modelos-Offline.md](./Modelos-Offline.md).
