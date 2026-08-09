# Posicionamento e métricas

Como o CodeHero se posiciona no mercado **com números medidos neste repositório**, não com slogan.

## Headline

**CodeHero: detecção peer-competitive, loop fechado depois do finding — sem IA no quality gate.**

## Categoria

**AI-native code quality platform with a deterministic proof loop** — não “mais um SAST”, não “clone do Sonar”.

## Uma frase

Peer-competitive em detecção de vulnerabilidades (OWASP); líder no ciclo pós-finding (evolução de regras + SDD verificável + agentes MCP); complementar — não substituto — em amplitude de smells enterprise.

## Três provas

1. **OWASP BenchmarkJava** — F1 **75,1%** · precisão **75,6%** · score **48,9** ([`benchmarks/owasp-baseline.json`](../../benchmarks/owasp-baseline.json)).
2. **Sonar way VULN live** — **~69%** (330/479) na curadoria, com esteira F1; smells via Presence/SARIF.
3. **Correção com prova** — SDD → agente MCP → scanner confirma que a finding sumiu.

## Métricas atuais

| Eixo | Valor | Fonte |
|---|---|---|
| OWASP BenchmarkJava v1.2 — F1 | **75,1%** | [`benchmarks/owasp-baseline.json`](../../benchmarks/owasp-baseline.json) (2026-08-09) |
| Precisão / recall | **75,6%** / **74,6%** | idem |
| Score OWASP (TPR − FPR) | **48,9** | idem |
| Cobertura semântica Sonar way (Hero **core** ↔ nomes) | ~**19%** (138 covered + 368 partial / 2668) | [`reports/sonar-way-coverage.md`](../../reports/sonar-way-coverage.md) |
| Live scannable (curadoria) | **18,4%** catálogo · VULN **68,9%** (330/479) | `npm run sonar:engenharia -- report` |
| Live smells | ~**7%** do catálogo Sonar way | idem — não é o eixo nativo |
| Latência L0 | microssegundos/arquivo | [`packages/scanner/README.md`](../../packages/scanner/README.md) |
| Latência L1 (árvore ~25 KB) | ~**13 ms**/arquivo | idem |

### Leitura vs peers públicos

Estudos públicos recentes (ex.: arXiv 2025 *Sifting the Noise*) reportam F1 OWASP na faixa ~69–74% para Semgrep/CodeQL, frequentemente com **FPR muito alto** (~68–75%). O CodeHero, com precisão ~76% e FPR bem menor, tende a um **score OWASP (TPR−FPR) mais calibrado** — menos ruído no gate — sem reivindicar “maior recall do mercado”.

Presence Pack (nativo + Semgrep): Semgrep sozinho pode ter score ligeiramente maior; o valor do CodeHero é **unificar** sinais no mesmo gate, não vencer Semgrep no detector puro.

## GTM — para quem falar (Sim)

| ICP | Abertura | Fecho |
|---|---|---|
| **AppSec (odeia FP)** | “Mesmo patamar de F1, score OWASP mais calibrado.” | Gate estável; FP vira estatística da regra. |
| **Times com agentes** (Cursor / Copilot / Claude) | “SAST que fala MCP e prova o fix.” | Regras no contexto de geração; rescaneio fecha o ciclo. |
| **Legado / banco** | “COBOL + DB2 na junta, sem SKU Enterprise.” | Host var × coluna, cursor, COMMIT no laço. |
| **Já tem Sonar/CodeQL** | “Não troque o detector — unifique o gate e a correção.” | Presence Pack no mesmo juiz. |

### Para quem **não** liderar com troca total

Quem só quer amplitude de code smells enterprise e não usa agentes/SDD — Sonar (ou Presence) continua no papel de catálogo; o CodeHero não vende “mais regras de smell”.

## O que liderar no pitch

| Liderar com | Não liderar com (anti-claims) |
|---|---|
| Loop fechado: issue → SDD → agente → prova | “Temos mais regras que o Sonar” |
| Precisão / score OWASP calibrado | Substituição 1:1 de Sonar em smells |
| MCP nativo + regras no contexto de geração | “LLM analisa cada arquivo” |
| Legado (COBOL/DB2) sem add-on enterprise | Taint interprocedural maduro em todas as langs |
| Presence Pack no mesmo gate | Catálogo nativo como única cobertura |
| Esteira de promoção com F1 auditável | “Melhor SAST do mercado” só pelo F1 |

## Quando usar o quê

| Cenário | Escolha |
|---|---|
| Gate + legado + agentes + evolução de regras | **CodeHero sozinho** (perfil `native` / Action) |
| Amplitude de smells/SAST **e** loop de fix | **CodeHero + Sonar/Semgrep/CodeQL** (Presence Pack) |
| Só catálogo de smells, sem agentes/SDD | **Sonar** (ou import SARIF) — CodeHero não é o substituto |
| CI rápido no PR + profundidade à noite | Semgrep/Opengrep no Presence + CodeQL importado no mesmo gate |

## Anti-claims (checklist)

- Não comparar só por % de regras Sonar way → perde.
- Não dizer “melhor SAST do mercado” só pelo F1 → contestável por recall.
- Não prometer paridade de taint enterprise em todas as linguagens.
- Não contar **stub** de catálogo como cobertura live.

## Caminho para aproximar o Sonar way

Não é “buscar o catálogo de novo” (já buscamos). É a esteira de engenharia: priorizar VULN stubs → detector + golden + F1 → live scannable; smells só com ROI ou via SARIF. Ver [Esteira-Sonar-Way.md](./Esteira-Sonar-Way.md) · `npm run sonar:engenharia -- all`.

## Relação com Presence SARIF

Ver [Presenca-SARIF.md](./Presenca-SARIF.md): amplitude de engines externos entra como `EXT:<tool>:<rule>`; o gate e a política continuam do CodeHero.

## Docs do produto

- Portal: https://codehero.web.app/docs/#posicionamento
- Home: seção “Onde estamos no mercado” em https://codehero.web.app/
