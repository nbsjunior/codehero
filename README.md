# CodeHero

**O quality gate que o time de engenharia confia — e que o agente de IA consegue fechar com prova.**

CodeHero é a plataforma de qualidade e segurança de código pensada para **CTOs e líderes técnicos** que já pagam o custo do ruído no PR: falso positivo que atrasa merge, finding sem dono, e “IA que analisa arquivo” que quebra reprodutibilidade e orçamento.

[Portal](https://codehero.web.app) · [Documentação para liderança](https://codehero.web.app/docs) · [Briefing e métricas](./docs/wiki/Posicionamento-e-metricas.md)

---

## A conversa de 90 segundos com o CTO

| Pergunta do board | Resposta CodeHero |
|---|---|
| **O gate é auditável?** | Sim. Inspeção determinística na borda (CI/IDE). Sem LLM no hot path do PR. |
| **Vocês competem com Sonar/CodeQL?** | Em **segurança**, estamos no mesmo patamar (OWASP F1 ~75%, score ~49). Em **amplitude de smells**, orquestramos o que você já tem — não prometemos catálogo enterprise 1:1. |
| **Onde está o diferencial?** | Depois do finding: regra evolui com portão F1, correção nasce com contrato (SDD), agente (MCP) aplica e o scanner **prova** que a issue sumiu. |
| **Quanto custa a IA?** | Validar regra nova = milissegundos de CPU no corpus. Não há custo linear por arquivo no CI. |
| **Quanto custa o produto?** | Sem custo de licença no modelo atual — você opera no [portal](https://codehero.web.app). |

**Uma frase para o comitê:** peer-competitive em vulnerabilidades; líder no ciclo pós-finding (evolução + correção verificável + agentes); complementar — não substituto — em smells enterprise.

---

## Por que líderes técnicos escolhem isto agora

1. **Agentes já estão no fluxo** (Cursor, Copilot, Claude) — sem um SAST que fala MCP e prova o fix, a IA gera patch sem contrato.
2. **FP custa sprint** — score OWASP calibrado (precisão ~76%) reduz o ruído que o AppSec e o TL rejeitam no gate.
3. **Legado não é SKU** — COBOL, DB2/T-SQL e C#/VB entram sem add-on “Enterprise”.
4. **Um juiz, vários sensores** — CodeQL, Semgrep, Trivy, Oxlint no mesmo Quality Gate (Presence Pack).
5. **Grafo do código sem Gen AI** — callers, fan-in e exposição a entrypoints no console e no plugin, para priorizar o que importa.

Detalhe, ICPs e anti-claims: [docs/wiki/Posicionamento-e-metricas.md](./docs/wiki/Posicionamento-e-metricas.md).

---

## Prova, não slide

| Evidência | Número / artefato |
|---|---|
| OWASP BenchmarkJava v1.2 | F1 **75,1%** · precisão **75,6%** · recall **74,6%** · score **48,9** — [`benchmarks/owasp-baseline.json`](./benchmarks/owasp-baseline.json) |
| Sonar way VULN live | ~**69%** (330/479) com esteira F1 |
| Latência no PR | L0 µs/arquivo · L1 ~13 ms/25 KB — cabe no CI e no save do IDE |
| Loop de correção | SDD → MCP → `run_scan` confirma |

Regredir o baseline OWASP quebra o gate de CI deste repositório.

---

## O que o time instala (sem cluster)

| Canal | Papel para o líder |
|---|---|
| **GitHub Action** | Gate no PR — um clique a partir do portal |
| **Plugin VS Code / Cursor** | Shift-left: saúde, compliance e grafo no workspace |
| **MCP** | Agentes corrigem com regras e prova no contexto |
| **Console executivo** | Débito, ratings, apontamentos, grafo do código avaliado |

Comece em [codehero.web.app](https://codehero.web.app) → provisione o workspace → Action ou plugin.

---

## Onde **não** vender troca total

Quem só quer amplitude de code smells enterprise e **não** usa agentes/SDD: mantenha Sonar (ou importe SARIF). CodeHero não lidera o pitch com “temos mais regras de smell”.

Honestidade de roadmap: taint interprocedural maduro em todas as linguagens e paridade de smells ainda não são claims.

---

## Open source

Apache-2.0. Contribuição: [CONTRIBUTING.md](./CONTRIBUTING.md) · [SECURITY.md](./SECURITY.md).

```bash
npm ci
npm test
```

Arquitetura para engenharia: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) · Wiki executiva: [docs/wiki/](./docs/wiki/).

---

CodeHero · qualidade com loop de prova · [codehero.web.app](https://codehero.web.app)
