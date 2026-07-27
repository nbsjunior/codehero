# CodeHero 🛡️

**Análise estática de código que aprende — sem colocar IA generativa no caminho de cada arquivo.**

CodeHero é uma plataforma de qualidade e segurança de código — débito técnico, quality gates, análise multi-linguagem — com um eixo diferente: **o catálogo de regras evolui continuamente por um motor determinístico, e cada issue encontrada já nasce com um contrato de correção que um agente (via MCP) pode aplicar e provar que resolveu.**

[Documentação na plataforma](https://codehero.web.app/docs) · [Wiki](https://github.com/nbsjunior/codehero/wiki)

---

## O problema que isso resolve

Toda ferramenta de análise estática enfrenta a mesma tensão: regras de mão têm cobertura limitada e ficam obsoletas (novos CVEs, novos frameworks, novos anti-padrões), mas "colocar um LLM para analisar cada arquivo" resolve a cobertura trocando por um problema pior — **custo que cresce linearmente com o volume de código**, latência incompatível com CI/IDE, e resultados não-determinísticos (a mesma linha pode ser marcada ou não dependendo da temperatura do modelo naquele dia).

CodeHero recusa essa troca. A resposta arquitetural é separar os dois problemas:

- **Detectar** é sempre determinístico, instantâneo e roda na borda (CI/IDE) — nunca centralizado, nunca com custo de inferência por arquivo.
- **Evoluir as regras** é onde a IA entra — mas em lote, offline, validada por um corpus de teste antes de qualquer promoção. Uma proposta de regra (de um humano ou de um LLM) só vira produção se provar, matematicamente, que melhora sem regredir.
- **Corrigir** é onde a IA generativa entra de fato, sob demanda — e não "sugere um fix"; ela recebe uma **especificação verificável** (SDD Spec) com critérios de aceite que o próprio motor determinístico confirma depois de aplicado.

## Em que ponto isso evolui em relação a suites enterprise clássicas

| | Suites enterprise clássicas | CodeHero |
|---|---|---|
| **Origem das regras** | Curadas pelo vendor, lançadas em releases | Curadas + **evoluídas por busca evolutiva determinística** contra um corpus rotulado — cada promoção é auditável e reproduzível |
| **Correção de issues** | Aponta o problema; quick fixes limitados e sem prova | Gera um **SDD Spec** com localização, contexto e critérios de aceite — o agente aplica e o scanner **confirma** que a issue sumiu |
| **Integração com IA/agentes** | Add-on comercial fechado | **Nativo em MCP** — qualquer agente compatível consome issues, SDD, scan e resultado do fix |
| **Custo de manter a IA** | N/A ou por token/arquivo | Validar uma regra nova custa **milissegundos de CPU** contra o corpus — o custo não cresce com o volume analisado |
| **Aprendizado com uso real** | Feedback vira ticket para o vendor | Telemetria de produção alimenta o próximo ciclo de evolução — o ciclo é parte do produto |
| **Operação da plataforma** | Cluster próprio (DB, search, etc.) | Cloud serverless — sem cluster próprio para o cliente manter |
| **Linguagens legadas** | Frequentemente add-on Enterprise | COBOL, T-SQL/DB2, C#/VB.Net desde o MVP |

**O que ainda não alcançamos** (honestidade > marketing): suites maduras têm mais de uma década de cobertura e análise de taint inter-procedural avançada. O motor determinístico do CodeHero hoje cobre o MVP com matcher + AST/dataflow em evolução — ver a documentação na plataforma e a Wiki.

## Prova, não promessa

Toda alegação acima já foi exercitada de ponta a ponta neste repositório, não apenas desenhada:

- **Busca evolutiva real**: contra o corpus golden, regras foram promovidas automaticamente e mutações ruins corretamente rejeitadas — o portão de segurança funcionando.
- **Correção verificável**: relatório → portal → SDD Spec → fix → confirmação pelo scanner, ponta a ponta.
- **Multi-linguagem real**: regras dedicadas para COBOL, T-SQL/DB2 e C#/VB.Net — testado com exemplos em [`examples/legacy/`](examples/legacy/).

## Os três módulos

1. **Motor de Inspeção** — determinístico na borda; evolução de regras offline e auditável (Dress Code Tools + corpus).
2. **Painel & SDD** — ingestão via API, débito técnico, quality gates, especificações de correção.
3. **Integrações** — GitHub Action, VS Code/Cursor e servidor MCP para agentes de IA.

Guia completo para quem usa a plataforma: **[codehero.web.app/docs](https://codehero.web.app/docs)**.

## Começando

Crie a conta no [portal](https://codehero.web.app), provisionne um projeto e escolha o canal (Action, plugin, prévia ou MCP). Detalhes: [docs na plataforma](https://codehero.web.app/docs).

## Status atual

| Componente | Estado |
|---|---|
| Contratos (relatório + SDD + métricas + matcher) | ✅ |
| Scanner multi-linguagem | ✅ exemplos reais |
| Evolução de regras (corpus + Dress Code Tools) | ✅ |
| API (ingestão / SDD / provisionamento / feedback) | ✅ |
| MCP server | ✅ |
| GitHub Action + one-click | ✅ |
| Portal web | ✅ |
| Motor nativo de escala (roadmap) | ⬜ |

---

<sub>CodeHero é projeto e arquitetura próprios. Comparações com o mercado são conceituais.</sub>
