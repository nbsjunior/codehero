# CodeHero — arquitetura (visão para liderança e contribuidores)

> Para o **CTO / líder técnico**: como a plataforma reduz risco operacional sem cluster e sem LLM no gate.  
> Para o **contribuidores**: mapa dos módulos open source.  
> **Não** documenta provedores, contas cloud, IDs de tenant nem inventário hospedado.

## Mensagem executiva

Inspeção na borda é **determinística e barata**. Evolução de regras e planejamento de correção usam IA **fora** do hot path. O Quality Gate do PR continua reproduzível e auditável — o tipo de propriedade que passa em due diligence e em SOC.

## Posicionamento (âncora)

Peer-competitive em segurança (OWASP F1 ~75%, score ~48,9); líder no ciclo pós-finding; complementar em smells via Presence/SARIF.  
Briefing completo: [wiki/Posicionamento-e-metricas.md](./wiki/Posicionamento-e-metricas.md).

## Princípios de desenho (o que o TL deve exigir)

| Princípio | Implicação |
|---|---|
| **Inspeção = determinística** | CLI / CI / IDE; sem LLM por arquivo |
| **Evolução = offline com portão F1** | Corpus golden decide promoção; rejeição é auditável |
| **Correção = contrato + prova** | SDD Spec → agente (MCP) → scanner confirma |
| **Um juiz, vários sensores** | SARIF externo entra no mesmo gate |
| **Grafo sem Gen AI** | Calls/imports para priorização e SDD |

## Módulos open source

| Pacote | Papel de negócio |
|---|---|
| `packages/contracts` | Contratos: SARIF+, SDD, métricas, catálogo |
| `packages/engine` | Análise AST / taint / estrutural |
| `packages/scanner` | CLI na borda (CI / Action / IDE) |
| `packages/code-graph` | Grafo estrutural determinístico (UI + triagem) |
| `packages/ruleforge` | Evolução de regras com prova F1 |
| `packages/fp-ranker` | Assertividade (anti-FP) — offline / anotações |
| `packages/code-embed` | Famílias AST — offline |
| `packages/mcp` | Ponte para agentes |
| `packages/github-action` | Gate no PR |
| `packages/ide-vscode` | Shift-left no editor |
| `apps/web` | Console executivo |
| `apps/functions` | API / ingestão / SDD (self-host ou hospedado) |

## Fluxo que o board entende

```text
Scan (borda) → SARIF+ → ingestão → issues + quality gate + grafo
                         ↓
                   SDD Spec → agente (MCP) → run_scan → prova
                         ↓
              feedback FP/FN → esteira offline → corpus decide
```

## O que **não** vai neste repositório

Credenciais, IDs de tenant, workflows de deploy da plataforma hospedada, inventário cloud. Self-host: `CONTRIBUTING.md` e `apps/web/.env.local.example`.

## Links

- Produto: https://codehero.web.app/docs  
- Wiki: [docs/wiki/](./wiki/)  
- Contribuição: [CONTRIBUTING.md](../CONTRIBUTING.md) · [SECURITY.md](../SECURITY.md)
