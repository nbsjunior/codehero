# CodeHero — visão de arquitetura (pública)

> Documento para contribuidores. **Não** descreve provedores, contas cloud, IDs de projeto,
> pipelines de deploy ou inventário de serviços hospedados. Operação da plataforma
> comercial fica fora deste repositório.

## Posicionamento (resumo)

Plataforma de qualidade com **loop de prova**: detecção determinística peer-competitive em segurança (OWASP F1 ~75%, score ~48,9), evolução de regras offline com portão F1, SDD + MCP para correção verificável. Sonar way: ~19% semântica (core) e ~69% VULN live scannable; smells via Presence/SARIF. Esteira: [wiki/Esteira-Sonar-Way.md](./wiki/Esteira-Sonar-Way.md).

Detalhe e anti-claims: [wiki/Posicionamento-e-metricas.md](./wiki/Posicionamento-e-metricas.md).

## Princípio

- **Inspeção** = determinística, na borda (CLI / CI / IDE), sem LLM por arquivo.
- **Evolução de regras** = offline, em lote; corpus golden + F1 decidem promoção.
- **Correção** = SDD Spec verificável + agentes via MCP; o scanner prova o resultado.

## Módulos open source

| Pacote / área | Papel |
|---|---|
| `packages/contracts` | SARIF+, SDD, métricas, matcher, catálogo de regras |
| `packages/engine` | AST / taint / CFG (JS/TS e extensões) |
| `packages/scanner` | CLI `hero-scanner` |
| `packages/ruleforge` | Corpus + busca evolutiva (decide promoção) |
| `packages/fp-ranker` | Ranqueador de assertividade (offline) |
| `packages/code-embed` | Clustering AST não supervisionado |
| `packages/mcp` | Servidor MCP para agentes |
| `packages/github-action` | Action de scan → ingest |
| `packages/ide-vscode` | Extensão VS Code / Cursor |
| `apps/web` | Portal (requer config local — ver `.env.local.example`) |
| `apps/functions` | API / callables (self-host; secrets só no ambiente) |

## Contratos entre mundos

```text
Scan (borda) → SARIF+ → ingestão → issues + quality gate
                         ↓
                   SDD Spec → agente (MCP) → run_scan → prova
                         ↓
              feedback FP/FN → esteira offline → corpus decide
```

## O que **não** vai neste repositório

- Credenciais, service accounts, API keys
- IDs reais de org / projeto / repo de tenants
- Workflows de deploy da plataforma hospedada
- Inventário de recursos cloud ou nomes de projeto GCP/Firebase
- Documentação operacional interna de produção

Self-hosters configuram o próprio ambiente via variáveis (ver `CONTRIBUTING.md` e
`apps/web/.env.local.example`).

## Links

- Docs do produto: https://codehero.web.app/docs
- Wiki: [docs/wiki/](./wiki/)
- Como contribuir: [CONTRIBUTING.md](../CONTRIBUTING.md)
- Segurança: [SECURITY.md](../SECURITY.md)
