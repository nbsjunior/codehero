# Code-graph determinístico — priorizar o que o board sente

**Para o CTO / TL:** depois do scan, o time não precisa de outro dashboard opaco. O CodeHero mostra o **grafo estrutural do código avaliado** — funções, calls, imports, distância até entrypoints — **sem Gen AI e sem Memgraph**.

Isso responde a pergunta de priorização: *“esse finding está em código morto ou no caminho do handler?”*

## Valor de negócio

| Pergunta | Resposta do grafo |
|---|---|
| Onde concentrar o próximo sprint? | Hotspots por **fan-in** |
| O finding é alcançável? | **Hops até entrypoint** |
| O agente tem contexto? | Callers/callees no SDD e no MCP |
| O gate depende de LLM? | **Não** — parse → JSON → consultas tipadas |

## Como funciona (simples)

1. Tree-sitter (`@codehero/engine`) extrai funções, calls e imports  
2. Persistência em `.codehero/code-graph.json`  
3. Resumo no SARIF → portal e plugin  

Com `--metrics`, o scanner gera o grafo por padrão (`--no-code-graph` desliga).

## Camadas (não misturar no pitch)

| Camada | Papel |
|---|---|
| **code-graph** (nativo) | Navegação + SDD + triagem — sempre determinístico |
| **Joern** (`--joern`) | CPG de segurança profundo (opcional) |
| Graph-RAG com LLM→Cypher | Inspiração de mercado — **não** é o gate CodeHero |

## Onde o líder vê

- **Console** (`/admin` → workspace → Visão geral): painel **Grafo do código avaliado**
- **Ficha do apontamento**: callers / callees
- **Plugin**: painel **Saúde e grafo** após Avaliar
- **MCP**: `get_callers`, `get_callees`, `path_to_entrypoint`, `enrich_finding_graph`

## Comandos

```bash
npx hero-code-graph build . -o .codehero/code-graph.json
hero-scan . --metrics --sarif   # grafo incluso por padrão com metrics
```

Triagem: features `fanInNorm` / `entryReachNorm` no fp-ranker. Briefing geral: [Posicionamento-e-metricas.md](./Posicionamento-e-metricas.md).
