# CodeHero 🛡️

**Detecção peer-competitive. Loop fechado depois do finding — sem IA no quality gate.**

CodeHero é uma plataforma de qualidade e segurança de código: motor determinístico na borda, regras que evoluem offline com portão F1, contratos de correção (SDD) que um agente (via MCP) aplica e o scanner **prova** que resolveu. Orquestra CodeQL/Semgrep/Trivy quando você já os paga; não inventa um segundo juiz no PR.

[Documentação na plataforma](https://codehero.web.app/docs) · [Wiki](https://github.com/nbsjunior/codehero/wiki) · [Posicionamento e métricas](./docs/wiki/Posicionamento-e-metricas.md)

---

## O problema que isso resolve

Toda ferramenta de análise estática enfrenta a mesma tensão: regras de mão têm cobertura limitada e ficam obsoletas, mas "colocar um LLM para analisar cada arquivo" resolve a cobertura trocando por um problema pior — **custo linear com o volume**, latência incompatível com CI/IDE, e resultados não-determinísticos.

CodeHero recusa essa troca:

- **Detectar** é sempre determinístico, na borda (CI/IDE) — microssegundos (L0) a ~13 ms/arquivo com árvore (L1).
- **Evoluir as regras** é onde a IA entra — em lote, offline, só promove se ΔF1 > 0 e P ≥ 0,85 no corpus.
- **Corrigir** é sob demanda: SDD Spec com critérios de aceite; o motor confirma depois do fix.

## Posicionamento (métricas, não slogan)

| Eixo | CodeHero hoje | Como ler |
|---|---|---|
| **OWASP BenchmarkJava** v1.2 | F1 **75,1%** · precisão **75,6%** · recall **74,6%** · score **48,9** | Peer-competitive com engines públicos; score OWASP (TPR−FPR) costuma sair **melhor calibrado** que peers de alto recall e FPR altíssimo |
| **Catálogo Sonar way** | ~**19%** semântica (core) · VULN live **~69%** | Smells ainda baixos; esteira `sonar:engenharia` promove VULN com F1 |
| **Presence Pack** | Importa Semgrep/CodeQL/… no mesmo gate | Complementar — orquestra amplitude sem segundo juiz |
| **Latência** | L0 µs/arquivo · L1 ~13 ms/25 KB | Adequado a CI e save no IDE |

Fonte da baseline OWASP: [`benchmarks/owasp-baseline.json`](./benchmarks/owasp-baseline.json) (medido 2026-08-09). Detalhe e anti-claims: [docs/wiki/Posicionamento-e-metricas.md](./docs/wiki/Posicionamento-e-metricas.md).

**Uma frase:** peer-competitive em detecção de vulnerabilidades; líder no ciclo pós-finding (evolução + correção verificável + agentes); complementar — não substituto — em amplitude de smells enterprise.

GTM (ICPs, anti-claims, quando usar o quê): [docs/wiki/Posicionamento-e-metricas.md](./docs/wiki/Posicionamento-e-metricas.md) · portal [`/docs/#posicionamento`](https://codehero.web.app/docs/#posicionamento).

## Em que ponto isso evolui em relação a suites enterprise clássicas

| | Suites enterprise clássicas | CodeHero |
|---|---|---|
| **Origem das regras** | Curadas pelo vendor, lançadas em releases | Curadas + **evoluídas por busca evolutiva determinística** contra um corpus rotulado |
| **Correção de issues** | Aponta o problema; quick fixes limitados e sem prova | **SDD Spec** + agente aplica + scanner **confirma** que a issue sumiu |
| **Integração com IA/agentes** | Add-on comercial fechado | **Nativo em MCP** — regras no contexto de geração, issues, SDD, scan e prova do fix |
| **Custo de manter a IA** | N/A ou por token/arquivo | Validar regra nova = **milissegundos de CPU** no corpus |
| **Aprendizado com uso real** | Feedback vira ticket para o vendor | Telemetria alimenta o próximo ciclo de evolução |
| **Operação** | Cluster próprio | Cloud serverless — sem cluster para o cliente manter |
| **Linguagens legadas** | Frequentemente add-on Enterprise | COBOL, T-SQL/DB2, C#/VB.Net desde o MVP |
| **Amplitude de smells** | Catálogo maduro (décadas) | Ainda atrás — use Presence Pack / Sonar ao lado |

**O que ainda não alcançamos** (honestidade > marketing): amplitude de code smells enterprise e taint interprocedural avançado em todas as linguagens. O motor nativo cobre L0 + AST/dataflow em evolução; Java e demais langs ganham profundidade via SARIF importado.

## Prova, não promessa

- **Busca evolutiva real**: promoção e rejeição auditáveis contra o corpus golden.
- **Correção verificável**: relatório → portal → SDD → fix → confirmação pelo scanner.
- **Multi-linguagem real**: COBOL, T-SQL/DB2 e C#/VB.Net — [`examples/legacy/`](examples/legacy/).
- **Benchmark de segurança**: baseline OWASP versionada no repo (regredir o score quebra o gate de CI).

## Os três módulos

1. **Motor de Inspeção** — determinístico na borda; evolução offline (Dress Code Tools + corpus).
2. **Painel & SDD** — ingestão, débito técnico, quality gates, especificações de correção.
3. **Integrações** — GitHub Action, VS Code/Cursor e servidor MCP.

Guia completo: **[codehero.web.app/docs](https://codehero.web.app/docs)**.

## Contribuindo (open source)

- [CONTRIBUTING.md](./CONTRIBUTING.md) — como contribuir
- [SECURITY.md](./SECURITY.md) — vulnerabilidades (privadas)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- Licença: [Apache-2.0](./LICENSE)

**Não** envie secrets, IDs de tenant nem workflows de deploy de produção.

```bash
npm ci
npm test
```

Exemplos de workflow: [`examples/github-workflows/`](./examples/github-workflows/).

## Começando (produto hospedado)

Crie a conta no [portal](https://codehero.web.app), provisione um projeto e escolha o canal (Action, plugin, prévia ou MCP). Detalhes: [docs na plataforma](https://codehero.web.app/docs).

## Status atual

| Componente | Estado |
|---|---|
| Contratos (relatório + SDD + métricas + matcher) | ✅ |
| Scanner multi-linguagem + baseline OWASP | ✅ |
| Evolução de regras (corpus + Dress Code Tools) | ✅ |
| API (ingestão / SDD / provisionamento / feedback) | ✅ |
| MCP server | ✅ |
| GitHub Action + one-click | ✅ |
| Portal web | ✅ |
| Presence Pack (SARIF externo) | ✅ |
| Motor nativo de escala enterprise (roadmap) | ⬜ |

---

<sub>CodeHero é projeto e arquitetura próprios. Números de benchmark são medidos neste repositório; comparações com peers públicos citam estudos externos quando indicado.</sub>
