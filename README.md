# CodeHero 🛡️

**Análise estática de código que aprende — sem colocar IA generativa no caminho de cada arquivo.**

CodeHero é uma plataforma de qualidade e segurança de código no modelo do SonarQube — débito técnico, quality gates, análise multi-linguagem — reconstruída do zero com um eixo diferente: **o catálogo de regras evolui continuamente por um motor de IA determinístico, e cada issue encontrada já nasce com um contrato de correção que um agente (Claude, via MCP) pode aplicar e provar que resolveu.**

[Arquitetura completa](docs/ARCHITECTURE.md) · [Roadmap](docs/ARCHITECTURE.md#roadmap-firebase)

---

## O problema que isso resolve

Toda ferramenta de SAST enfrenta a mesma tensão: regras de mão têm cobertura limitada e ficam obsoletas (novos CVEs, novos frameworks, novos anti-padrões), mas "colocar um LLM para analisar cada arquivo" resolve a cobertura trocando por um problema pior — **custo que cresce linearmente com o volume de código**, latência incompatível com CI/IDE, e resultados não-determinísticos (a mesma linha pode ser marcada ou não dependendo da temperatura do modelo naquele dia).

CodeHero recusa essa troca. A resposta arquitetural é separar os dois problemas:

- **Detectar** é sempre determinístico, instantâneo e roda na borda (CI/IDE) — nunca centralizado, nunca com custo de inferência por arquivo.
- **Evoluir as regras** é onde a IA entra — mas em lote, offline, validada por um corpus de teste antes de qualquer promoção. Uma proposta de regra (de um humano ou de um LLM) só vira produção se provar, matematicamente, que melhora sem regredir.
- **Corrigir** é onde a IA generativa entra de fato, sob demanda — e não "sugere um fix"; ela recebe uma **especificação verificável** (SDD Spec) com critérios de aceite que o próprio motor determinístico confirma depois de aplicado.

## Em que ponto isso evolui em relação ao SonarQube

| | SonarQube | CodeHero |
|---|---|---|
| **Origem das regras** | Curadas manualmente pelo time da SonarSource, lançadas em releases do produto | Curadas + **evoluídas por busca evolutiva determinística** (`hero-ruleforge`) contra um corpus rotulado — cada promoção é auditável e reproduzível (seed fixa) |
| **Correção de issues** | Aponta o problema; "quick fixes" automatizados são limitados e não verificam se o fix realmente resolveu | Gera um **SDD Spec** (JSON) com localização exata, contexto de tipos e `acceptanceCriteria` — um agente aplica o diff e o próprio scanner **confirma objetivamente** que a issue sumiu e nenhuma nova surgiu |
| **Integração com IA/agentes** | Camada de IA (Sonar AI CodeFix) é um add-on comercial fechado sobre o produto existente | **Nativo em MCP** (Model Context Protocol) desde a arquitetura-base — qualquer agente compatível (Claude, etc.) consome `get_issues`/`get_sdd_spec`/`run_scan`/`submit_fix_result` como cidadãos de primeira classe |
| **Custo de manter a IA** | N/A (não usa IA para evoluir regras) | Buscar/validar uma regra nova custa **milissegundos de CPU** contra um corpus — não uma chamada de API por arquivo escaneado, então o custo não cresce com o volume de código analisado |
| **Aprendizado com uso real** | Falsos-positivos reportados viram tickets de suporte para o vendor decidir em release futura | Telemetria de produção (`flagIssueFeedback`, `submit_fix_result`) já é capturada como material de corpus rotulado para a próxima rodada de evolução — o ciclo de melhoria é parte do produto, não um processo de vendor externo |
| **Stack para operar a própria plataforma** | Requer operar Postgres + Elasticsearch (+ opcionalmente outros serviços) | 100% serverless sobre Firebase (Functions + Firestore + Hosting) — sem cluster próprio para manter |
| **Linguagens legadas empresariais** | Suporte a COBOL/PL·I é add-on Enterprise separado | COBOL, T-SQL/DB2, C#/VB.Net tratados como cidadãos de primeira classe desde o MVP, com regras dedicadas às particularidades sintáticas de cada um (ex.: `MOVE...TO` do COBOL, `SET @sql = ... +` do T-SQL) |

**O que ainda não alcançamos** (honestidade > marketing): o SonarQube tem mais de uma década de cobertura de regras, análise de taint inter-procedural madura, e integrações IDE profundas. O motor determinístico do CodeHero hoje é um matcher por linha (Fase MVP) — a análise de dataflow real é o motor Rust/tree-sitter do roadmap V1→Scale-up, ainda não implementado. Ver [docs/ARCHITECTURE.md § Escala](docs/ARCHITECTURE.md#escala-100-mil-repositórios-2-bilhões-de-linhas-de-código) para o que isso implica em volumes de milhões/bilhões de linhas.

## Prova, não promessa

Toda alegação acima já foi exercitada de ponta a ponta neste repositório, não apenas desenhada:

- **Busca evolutiva real**: rodando `hero-ruleforge` contra o corpus golden, 2 regras foram promovidas automaticamente (F1 0.50→1.00 e 0.67→1.00) e **uma mutação proposta foi corretamente rejeitada** por não gerar ganho real — o portão de segurança funcionando contra uma proposta ruim, humana ou de IA.
- **Correção verificável**: o fluxo SARIF → Firestore → SDD Spec → aplicação de fix → `submit_fix_result` foi testado ponta a ponta no emulador Firebase.
- **Multi-linguagem real**: regras dedicadas para COBOL (`MOVE...TO`, `GO TO`), T-SQL/DB2 (SQL dinâmico) e C#/VB.Net (ADO.NET) detectam corretamente as vulnerabilidades e não disparam falso-positivo nas variantes seguras — testado com arquivos de exemplo reais em [`examples/legacy/`](examples/legacy/).

## Os três módulos

1. **Motor de Inspeção** (`packages/scanner`, `packages/ruleforge`) — determinístico na borda; evolução de regras offline e auditável.
2. **Painel & SDD** (`apps/functions`, `apps/web`) — ingestão, débito técnico (modelo SQALE), quality gates, geração de especificações de correção.
3. **Integrações** (`packages/mcp`, `packages/github-action`) — GitHub Action, e servidor MCP nativo para agentes de IA.

Arquitetura detalhada, diagramas C4/Mermaid e o fluxo de dados completo: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Começando

Setup local, MCP, emuladores Firebase e `hero-ruleforge`: ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e a Wiki do repositório.

## Status atual

| Componente | Estado |
|---|---|
| Contratos (SARIF+/SDD/SQALE/matcher) | ✅ compila |
| Scanner → SARIF (7 linguagens) | ✅ roda e valida em exemplos reais |
| hero-ruleforge (corpus + evolução) | ✅ determinístico + Genkit diário (`ruleforgeDaily`) |
| Functions (ingest/sdd/query/provision/feedback) | ✅ compila + verificado no emulador |
| MCP server | ✅ compila |
| GitHub Action + workflow de deploy | ✅ scaffold pronto |
| Dashboard Next.js | ✅ Auth + Firestore + `provisionProject` / admin callables |
| Motor nativo Rust/tree-sitter (escala 2B+ LOC) | ⬜ roadmap V1→Scale-up |

---

<sub>CodeHero usa o SonarQube como referência conceitual, mas não deriva código nem regras dele. Projeto próprio, arquitetura própria.</sub>
