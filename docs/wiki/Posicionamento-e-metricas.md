# Briefing para CTO e líder técnico — posicionamento e métricas

Documento de **decisão de compra / adoção**, não de marketing vazio. Números medidos neste repositório.

## A tese em uma reunião

**CodeHero fecha o ciclo que o SAST clássico abandona:** finding → contrato de correção → agente → prova no scanner — **sem colocar LLM no quality gate do PR.**

Categoria: plataforma de qualidade *AI-native* com **loop de prova determinístico**. Não é “mais um SAST”. Não é clone de suite enterprise por amplitude de catálogo.

## Headline

**Detecção peer-competitive. Loop fechado depois do finding — sem IA no quality gate.**

## O que o CTO precisa ouvir

| Risco / dor | Como o CodeHero responde |
|---|---|
| Gate barulhento (FP) queima confiança do time | Score OWASP calibrado (TPR−FPR **48,9**); precisão **75,6%** |
| Ferramenta aponta e some | SDD + MCP + rescaneio — a issue precisa **sumir** para fechar |
| IA no CI = custo e não-determinismo | Inspeção só determinística; IA offline (regras) ou sob demanda (fix) |
| Já pagamos CodeQL/Semgrep/Sonar | Presence Pack: mesmos sensores, **um** juiz de política |
| Legado (COBOL/DB2) fora do SKU | Coberto no núcleo, sem upsell enterprise |
| Agentes geram patch sem contexto | MCP entrega regras ativas, issues, SDD e grafo estrutural |

## Três provas (levar para o slide)

1. **OWASP BenchmarkJava** — F1 **75,1%** · precisão **75,6%** · score **48,9** ([`benchmarks/owasp-baseline.json`](../../benchmarks/owasp-baseline.json), 2026-08-09).
2. **Sonar way VULN live** — **~69%** (330/479) com esteira F1; smells via Presence/SARIF — sem mentir com stub.
3. **Correção com prova** — SDD → agente MCP → scanner confirma.

## Métricas (fonte única)

| Eixo | Valor |
|---|---|
| OWASP F1 / precisão / recall | **75,1%** / **75,6%** / **74,6%** |
| Score OWASP (TPR − FPR) | **48,9** |
| Cobertura semântica Sonar way (core) | ~**19%** |
| VULN live scannable | **~69%** |
| Smells live (nativo) | ~**7%** — não é o eixo de venda |
| Latência L0 / L1 (~25 KB) | µs · ~**13 ms**/arquivo |

### Como ler vs peers

Estudos públicos recentes colocam Semgrep/CodeQL com F1 OWASP ~69–74% e **FPR muito alto**. CodeHero prioriza gate estável (menos ruído), não o slogan de “maior recall do mercado”.

## ICPs — para quem o líder deve abrir a porta

| ICP | Abertura (30 s) | Fecho |
|---|---|---|
| **AppSec / segurança** | “Mesmo patamar de F1, score mais calibrado.” | Gate que o time não contorna. |
| **Engenharia com agentes** | “SAST que fala MCP e prova o fix.” | Patch com contrato e rescaneio. |
| **Plataforma / legado** | “COBOL + DB2 sem SKU Enterprise.” | Risco na junta host↔SQL visível. |
| **Já tem Sonar/CodeQL** | “Não troque o detector — unifique o gate.” | Presence Pack + correção. |

### Para quem **não** liderar com troca total

Time que só quer catálogo de smells e não usa agentes/SDD → Sonar (ou SARIF). CodeHero não vende “mais regras de smell”.

## O que liderar / o que nunca dizer

| Liderar | Anti-claim |
|---|---|
| Loop fechado finding → SDD → agente → prova | “Temos mais regras que o Sonar” |
| Precisão / score OWASP calibrado | Substituição 1:1 em smells |
| MCP nativo | “LLM analisa cada arquivo no PR” |
| Legado sem add-on | Taint enterprise maduro em todas as langs |
| Presence Pack no mesmo juiz | Catálogo nativo como única cobertura |
| Esteira F1 auditável | “Melhor SAST do mercado” só pelo F1 |

## Quando usar o quê (decisão de arquitetura)

| Cenário | Escolha |
|---|---|
| Gate + legado + agentes + evolução de regras | **CodeHero** (perfil nativo / Action) |
| Amplitude de smells/SAST **e** loop de fix | **CodeHero +** Sonar/Semgrep/CodeQL (Presence) |
| Só catálogo de smells, sem agentes | **Sonar** — CodeHero não é o substituto |
| CI rápido no PR + profundidade à noite | Presence + CodeQL importado no mesmo gate |

## Relação com Presence, esteira e grafo

- Amplitude externa: [Presenca-SARIF.md](./Presenca-SARIF.md)
- Promoção Sonar way com prova: [Esteira-Sonar-Way.md](./Esteira-Sonar-Way.md)
- Grafo estrutural (priorização sem Gen AI): [Code-graph-deterministico.md](./Code-graph-deterministico.md)
- Agentes: [Conectar-MCP-CodeHero.md](./Conectar-MCP-CodeHero.md)

## Docs do produto

- Portal (mesmo briefing): https://codehero.web.app/docs/#posicionamento
- Home: https://codehero.web.app/
