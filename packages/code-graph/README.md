# @codehero/code-graph

Grafo estrutural **determinístico** do repositório (funções, calls, imports) — priorização e SDD **sem Gen AI**.

Para o líder técnico: responde “este finding está no caminho do handler?” com fan-in e hops até entrypoint. Alimenta o console, o plugin e o MCP.

```bash
npm run build -w @codehero/code-graph
npx hero-code-graph build . -o .codehero/code-graph.json
```

Docs: [docs/wiki/Code-graph-deterministico.md](../../docs/wiki/Code-graph-deterministico.md)
