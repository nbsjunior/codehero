import Link from "next/link";
import type { Metadata } from "next";
import MermaidDiagram from "@/components/MermaidDiagram";
import DocsTopNav from "@/components/DocsTopNav";
import LearningLoopStory from "@/components/LearningLoopStory";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import "./docs.css";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "Posicionamento, GTM/ICPs, métricas OWASP, modelos matemáticos, quality gate, GitHub Action, VS Code e MCP.",
  alternates: { canonical: "/docs/" },
  openGraph: {
    title: `Docs · ${SITE_NAME}`,
    description:
      "Posicionamento, GTM/ICPs, métricas OWASP, modelos matemáticos, quality gate, GitHub Action, VS Code e MCP.",
    url: `${SITE_URL}/docs/`,
    type: "article",
  },
};

const TOC = [
  { href: "#missao", label: "Missão e valor" },
  { href: "#posicionamento", label: "Posicionamento e métricas" },
  { href: "#gtm-icp", label: "Para quem falar (GTM)" },
  { href: "#quando-usar", label: "Quando usar o quê" },
  { href: "#modelos-matematicos", label: "Modelos matemáticos" },
  { href: "#aprendizado-continuo", label: "Aprendizado contínuo" },
  { href: "#cenario-ruleforge", label: "Cenário exercitado" },
  { href: "#fluxo-regras", label: "Criação automática de regras" },
  { href: "#modelos", label: "GenAI + motor de prova" },
  { href: "#matematica", label: "Fórmulas (débito, F1, gate)" },
  { href: "#indices", label: "Manutenibilidade e segurança" },
  { href: "#papeis", label: "Quem usa o CodeHero" },
  { href: "#canais", label: "Onde o CodeHero age" },
  { href: "#comecar", label: "Começar do zero" },
  { href: "#github-action", label: "GitHub Action (pipeline)" },
  { href: "#vscode", label: "VS Code / Cursor (shift left)" },
  { href: "#previa-repo", label: "Varrer um repositório GitHub" },
  { href: "#mcp", label: "MCP nas IDEs de IA" },
  { href: "#mcp-cursor", label: "MCP · Cursor" },
  { href: "#mcp-claude", label: "MCP · Claude" },
  { href: "#mcp-github", label: "MCP · GitHub Copilot" },
  { href: "#mcp-devin", label: "MCP · Devin" },
  { href: "#presenca-sarif", label: "Presença SARIF" },
  { href: "#dress-code", label: "Dress code do time" },
  { href: "#workflow-recomendado", label: "Workflow recomendado" },
  { href: "#arquitetura", label: "Arquitetura (resumo)" },
  { href: "#links", label: "Links" },
];

const DIAGRAM_HYBRID = `flowchart TB
  subgraph gen["Camada GenAI — propõe, não decide"]
    DC["Política do time\\nem linguagem natural"]
    RF["Dress Code Tools\\nciclo diário"]
    SDD["SDD Spec + agente MCP"]
  end
  subgraph det["Camada de prova — decide e mede"]
    SCAN["Scanner CodeHero\\nregex / AST / dataflow"]
    CORPUS["Corpus golden\\nP / R / F1"]
    DEBT["Métricas de débito\\nratings · gate"]
  end
  DC -->|regras candidatas| SCAN
  RF -->|mutações candidatas| CORPUS
  CORPUS -->|só se ΔF1>0 e P≥0.85| SCAN
  SCAN -->|relatório| DEBT
  SDD -->|fix proposto| SCAN
  SCAN -->|rescaneio prova o fix| SDD`;

const DIAGRAM_PATHS = `flowchart LR
  PR["Push / PR / IDE"] --> SCAN["Scanner"]
  SCAN --> REP["Relatório + fingerprints"]
  REP --> ING["API de ingestão"]
  ING --> MET["Débito + ratings\\nmanutenibilidade / segurança"]
  MET --> QG{"Quality Gate"}
  QG -->|PASSED| OK["Merge liberado"]
  QG -->|FAILED| BLOCK["Bloqueia merge"]
  BLOCK --> MCP["MCP / SDD / humano"]
  MCP --> FIX["Correção"]
  FIX --> SCAN`;

const DIAGRAM_RULEFORGE = `flowchart LR
  FB["Telemetria FP/FN"] --> GEN["Dress Code Tools\\npropõe mutações"]
  HAND["Mutações humanas"] --> POOL["Pool de candidatos"]
  GEN -.->|não decide| POOL
  POOL --> GA["Busca evolutiva\\nreproduzível"]
  GOLD["Corpus golden"] --> GA
  GA -->|"PROMOTED\\nΔF1>0 · P≥0.85 · 0 regressão"| RULES["RuleSet ativo"]
  GA -->|REJECTED| LOG["Histórico de evolução"]
  RULES --> SCAN["Scanner\\nsem LLM por arquivo"]`;

const DIAGRAM_RATINGS = `flowchart TB
  ISSUES["Issues do relatório"] --> SMELL["Code smells\\nΣ esforço (min)"]
  ISSUES --> SEV["Vulnerabilities / Bugs\\nseveridades"]
  SMELL --> TDR["TDR = Debt / LOC×30min"]
  TDR --> MR["Maintainability\\nA–E"]
  SEV --> SR["Security rating\\n= pior severidade"]
  MR --> GATE["Quality Gate\\nmax rating A"]
  SR --> GATE`;

const DIAGRAM_MATH_STACK = `flowchart TB
  subgraph debt["Manutenibilidade"]
    SM["Σ effortMin smells"] --> TD["TechnicalDebt"]
    LOC["LOC × 30 min"] --> DC["DevelopmentCost"]
    TD --> TDR["TDR = Debt / Cost"]
    DC --> TDR
    TDR --> MR["Rating A–E"]
  end
  subgraph sec["Segurança"]
    V["Issues VULN / BUG / HOTSPOT"] --> WORST["argmax severidade"]
    WORST --> SR["Rating A–E"]
  end
  subgraph f1["Portão de promoção de regras"]
    TP["TP / FP / FN no corpus"] --> P["Precision"]
    TP --> R["Recall"]
    P --> F1["F1 = 2PR/(P+R)"]
    R --> F1
    F1 --> GATE{"ΔF1>0 ∧ P≥0.85?"}
    GATE -->|sim| PROMOTE["PROMOTED"]
    GATE -->|não| REJECT["REJECTED"]
  end
  MR --> QG["Quality Gate"]
  SR --> QG`;

const DIAGRAM_RULE_AUTOMATION = `flowchart TB
  START["Sinais de entrada"] --> SPLIT{Tipo de sinal}
  SPLIT -->|Política em texto| DRESS["Dress Code Tools\\ninterpreta → regra candidata"]
  SPLIT -->|FP / FN / gaps| MUT["Propõe mutações\\nde regras existentes"]
  SPLIT -->|Curadoria humana| HAND["MutationSpec manual"]
  DRESS --> POOL["Pool de candidatos"]
  MUT --> POOL
  HAND --> POOL
  POOL --> EVAL["Avalia no corpus\\ncasos match / no_match"]
  EVAL --> SCORE["Calcula P, R, F1\\nvs baseline"]
  SCORE --> DEC{"Portão\\nΔF1>0 · P≥0.85\\n0 regressão"}
  DEC -->|PROMOTED| TYPE{Categoria da regra}
  DEC -->|REJECTED| LOG["Registra motivo\\ne tenta na próxima rodada"]
  TYPE -->|CODE_SMELL| MAINT["Manutenibilidade\\n↓ TDR no próximo scan"]
  TYPE -->|VULN / HOTSPOT / BUG| SEC["Segurança\\n↓ pior severidade"]
  MAINT --> ACTIVE["RuleSet ativo\\nCI + IDE + prévia"]
  SEC --> ACTIVE
  ACTIVE --> NEXT["Próximo ciclo diário"]
  LOG --> NEXT
  NEXT --> START`;

const DIAGRAM_F1_DETAIL = `flowchart LR
  C["Corpus golden"] --> M["Regra candidata\\naplica match"]
  M --> TP["TP: acertou positivo"]
  M --> FP["FP: falso positivo"]
  M --> FN["FN: deixou passar"]
  TP --> P["P = TP/(TP+FP)"]
  FP --> P
  TP --> R["R = TP/(TP+FN)"]
  FN --> R
  P --> F1["F1"]
  R --> F1
  F1 --> CMP{"melhor que baseline?"}
  CMP -->|sim + P≥0.85| OK["Entra no RuleSet"]
  CMP -->|não| NO["Descartada\\nsem afetar o CI"]`;

export default function DocsPage() {
  return (
    <div className="cr-page">
      <DocsTopNav />

      <div className="cr-docs-shell">
        <aside className="cr-docs-toc" aria-label="Sumário">
          {TOC.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </aside>

        <article className="cr-docs-article">
          <h1>Documentação do CodeHero</h1>
          <p className="cr-docs-lede">
            Detecção peer-competitive, loop fechado depois do finding e o fluxo que promove qualidade e segurança —
            na pipeline, no editor e nas IDEs de IA — sem IA no quality gate e sem o time configurar infraestrutura.
          </p>

          <section id="missao">
            <h2>Missão e valor</h2>
            <p>
              O CodeHero existe para <strong>elevar a qualidade e a segurança</strong> do software que o time entrega —
              com motor <strong>determinístico</strong> (reproduzível, auditável) e um ciclo que não para no alerta:
              regras evoluem offline, a correção nasce com contrato (SDD) e o agente (MCP) prova o fix no rescaneio.
            </p>
            <div className="cr-docs-callout">
              <strong>Princípio</strong>
              <p style={{ margin: 0 }}>
                Inspeção = regras + motor determinístico. IA = planejamento de correção e evolução de políticas — nunca
                no lugar do quality gate do PR.
              </p>
            </div>
            <p>Na prática, o herói do PR usa o CodeHero em três frentes:</p>
            <ul>
              <li>
                <strong>Pipeline</strong> — GitHub Action bloqueia merge quando o gate falha.
              </li>
              <li>
                <strong>Shift left</strong> — plugin VS Code/Cursor mostra compliance e non-compliance no workspace.
              </li>
              <li>
                <strong>Agentes de IA</strong> — MCP no Cursor, Claude e GitHub Copilot para corrigir com prova.
              </li>
            </ul>
          </section>

          <section id="posicionamento">
            <h2>Posicionamento e métricas</h2>
            <p>
              Categoria: plataforma de qualidade <em>AI-native</em> com <strong>loop de prova determinístico</strong> —
              não “mais um SAST”, não clone de suite enterprise por amplitude de catálogo.
            </p>
            <div className="cr-docs-callout">
              <strong>Headline</strong>
              <p style={{ margin: "0.5rem 0 0" }}>
                CodeHero: detecção peer-competitive, loop fechado depois do finding — sem IA no quality gate.
              </p>
            </div>
            <div className="cr-docs-callout">
              <strong>Uma frase</strong>
              <p style={{ margin: "0.5rem 0 0" }}>
                Peer-competitive em detecção de vulnerabilidades (OWASP); líder no ciclo pós-finding (evolução + SDD +
                MCP); complementar — não substituto — em amplitude de smells enterprise.
              </p>
            </div>

            <h3>Três provas</h3>
            <ol>
              <li>
                <strong>OWASP BenchmarkJava</strong> — F1 <strong>75,1%</strong> · precisão <strong>75,6%</strong> ·
                score <strong>48,9</strong> (<code>benchmarks/owasp-baseline.json</code>).
              </li>
              <li>
                <strong>Sonar way VULN live</strong> — ~<strong>69%</strong> (330/479) na curadoria, com esteira F1;
                smells via Presence/SARIF.
              </li>
              <li>
                <strong>Correção com prova</strong> — SDD → agente MCP → scanner confirma que a finding sumiu.
              </li>
            </ol>

            <div className="cr-docs-module-grid">
              <div className="cr-docs-module-card">
                <strong>OWASP BenchmarkJava</strong>
                <span>
                  F1 <strong>75,1%</strong> · precisão <strong>75,6%</strong> · recall <strong>74,6%</strong> · score{" "}
                  <strong>48,9</strong> (TPR − FPR). Baseline em{" "}
                  <code>benchmarks/owasp-baseline.json</code> (2026-08-09).
                </span>
              </div>
              <div className="cr-docs-module-card">
                <strong>Vs peers públicos</strong>
                <span>
                  Estudos recentes colocam CodeQL/Semgrep com F1 OWASP ~69–74% e FPR muito alto. O CodeHero tende a
                  score OWASP mais calibrado (menos ruído no gate), sem reivindicar o maior recall do mercado.
                </span>
              </div>
              <div className="cr-docs-module-card">
                <strong>Sonar way / smells</strong>
                <span>
                  ~<strong>19%</strong> semântica (core) · VULN live ~<strong>69%</strong> · smells live ~<strong>7%</strong>.
                  Não revendemos substituição 1:1 do catálogo enterprise.
                </span>
              </div>
              <div className="cr-docs-module-card">
                <strong>Latência</strong>
                <span>
                  L0 em microssegundos/arquivo; L1 (árvore ~25&nbsp;KB) ~13&nbsp;ms/arquivo; sem LLM no hot path do PR.
                </span>
              </div>
            </div>

            <div className="cr-docs-compare">
              <div>
                <strong>Liderar o pitch com</strong>
                <ul>
                  <li>Loop fechado: finding → SDD → agente → prova</li>
                  <li>Precisão / score OWASP calibrado</li>
                  <li>MCP nativo + regras no contexto de geração</li>
                  <li>COBOL/DB2 sem add-on enterprise</li>
                  <li>Orquestração CodeQL/Semgrep/Trivy</li>
                  <li>Esteira de promoção com F1 auditável</li>
                </ul>
              </div>
              <div>
                <strong>Anti-claims — não dizer</strong>
                <ul>
                  <li>“Temos mais regras que o Sonar”</li>
                  <li>Substituição 1:1 de suite enterprise em smells</li>
                  <li>“LLM analisa cada arquivo”</li>
                  <li>Taint interprocedural maduro em todas as langs</li>
                  <li>Catálogo nativo como única cobertura</li>
                  <li>“Melhor SAST do mercado” só pelo F1</li>
                  <li>Contar stub de catálogo como cobertura live</li>
                </ul>
              </div>
            </div>
          </section>

          <section id="gtm-icp">
            <h2>Para quem falar (GTM · Sim)</h2>
            <p>
              Early access e conversas comerciais focam nestes ICPs — não em “troca o Sonar por amplitude de smells”.
            </p>
            <div className="cr-docs-table-wrap">
              <table className="cr-docs-table">
                <thead>
                  <tr>
                    <th>ICP</th>
                    <th>Abertura</th>
                    <th>Fecho</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <strong>AppSec (odeia FP)</strong>
                    </td>
                    <td>Mesmo patamar de F1, score OWASP mais calibrado.</td>
                    <td>Gate estável; FP vira estatística da regra.</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Times com agentes</strong>
                      <br />
                      <span style={{ color: "var(--cr-muted)", fontSize: "0.85em" }}>
                        Cursor / Copilot / Claude
                      </span>
                    </td>
                    <td>SAST que fala MCP e prova o fix.</td>
                    <td>Regras no contexto de geração; rescaneio fecha o ciclo.</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Legado / banco</strong>
                    </td>
                    <td>COBOL + DB2 na junta, sem SKU Enterprise.</td>
                    <td>Host var × coluna, cursor, COMMIT no laço.</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Já tem Sonar/CodeQL</strong>
                    </td>
                    <td>Não troque o detector — unifique o gate e a correção.</td>
                    <td>Presence Pack no mesmo juiz.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="cr-docs-callout">
              <strong>Para quem não liderar com troca total</strong>
              <p style={{ margin: "0.5rem 0 0" }}>
                Quem só quer amplitude de code smells enterprise e não usa agentes/SDD — Sonar (ou Presence) continua no
                papel de catálogo; o CodeHero não vende “mais regras de smell”.
              </p>
            </div>
          </section>

          <section id="quando-usar">
            <h2>Quando usar o quê</h2>
            <div className="cr-docs-table-wrap">
              <table className="cr-docs-table">
                <thead>
                  <tr>
                    <th>Cenário</th>
                    <th>Escolha</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Gate + legado + agentes + evolução de regras</td>
                    <td>
                      <strong>CodeHero sozinho</strong> (perfil <code>native</code> / Action)
                    </td>
                  </tr>
                  <tr>
                    <td>Amplitude de smells/SAST <em>e</em> loop de fix</td>
                    <td>
                      <strong>CodeHero + Sonar/Semgrep/CodeQL</strong> (Presence Pack)
                    </td>
                  </tr>
                  <tr>
                    <td>Só catálogo de smells, sem agentes/SDD</td>
                    <td>
                      <strong>Sonar</strong> (ou import SARIF) — CodeHero não é o substituto
                    </td>
                  </tr>
                  <tr>
                    <td>CI rápido no PR + profundidade à noite</td>
                    <td>Semgrep/Opengrep no Presence + CodeQL importado no mesmo gate</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Wiki completa:{" "}
              <a
                href="https://github.com/nbsjunior/codehero/blob/main/docs/wiki/Posicionamento-e-metricas.md"
                target="_blank"
                rel="noreferrer"
              >
                Posicionamento-e-metricas.md
              </a>
              . Esteira Sonar way (VULN → golden → F1 → live):{" "}
              <a
                href="https://github.com/nbsjunior/codehero/blob/main/docs/wiki/Esteira-Sonar-Way.md"
                target="_blank"
                rel="noreferrer"
              >
                Esteira-Sonar-Way.md
              </a>{" "}
              · <code>npm run sonar:engenharia -- all</code>.
            </p>
          </section>

          <section id="modelos-matematicos">
            <h2>Modelos matemáticos</h2>
            <p>
              Três famílias de fórmulas sustentam o produto: <strong>débito técnico</strong> (manutenibilidade),{" "}
              <strong>pior severidade</strong> (segurança) e <strong>precisão/recall/F1</strong> (portão de promoção
              de regras). Elas são as mesmas no CI, no portal e no plugin.
            </p>

            <MermaidDiagram
              chart={DIAGRAM_MATH_STACK}
              caption="Figura A — Três modelos: TDR → rating de manutenibilidade; pior severidade → rating de segurança; F1 → promoção de regras."
            />

            <div className="cr-docs-module-grid">
              <div className="cr-docs-module-card">
                <strong>Manutenibilidade (TDR)</strong>
                <span>
                  TechnicalDebt = Σ effortMin dos code smells. DevelopmentCost = LOC × 30 min. TDR = Debt / Cost →
                  rating A–E (A se TDR ≤ 5%).
                </span>
              </div>
              <div className="cr-docs-module-card">
                <strong>Segurança</strong>
                <span>
                  Rating = mapeamento da pior severidade presente (BLOCKER→E … sem issues→A). Não usa média: um único
                  BLOCKER derruba o índice.
                </span>
              </div>
              <div className="cr-docs-module-card">
                <strong>Portão F1</strong>
                <span>
                  P = TP/(TP+FP), R = TP/(TP+FN), F1 = 2PR/(P+R). Só promove regra se ΔF1 &gt; 0, P ≥ 0,85 e zero
                  regressão no corpus.
                </span>
              </div>
            </div>

            <MermaidDiagram
              chart={DIAGRAM_F1_DETAIL}
              caption="Figura B — Como o corpus classifica uma regra candidata (TP/FP/FN) antes de ela tocar o CI."
            />

            <MermaidDiagram
              chart={DIAGRAM_RATINGS}
              caption="Figura C — Do relatório de análise aos índices A–E e ao Quality Gate."
            />
          </section>

          <LearningLoopStory id="aprendizado-continuo" variant="docs" />

          <section id="cenario-ruleforge">
            <h2>Cenário narrado — do dress code ao CI</h2>
            <p>
              Além do run real de <code>evolve-all</code> (rejeição correta quando F1 já é 1,00), o fluxo de produto
              que o time sente no dia a dia é este:
            </p>
            <MermaidDiagram
              chart={`sequenceDiagram
  participant Dev
  participant CI as Action / IDE
  participant FB as Feedback
  participant RF as ruleforgeDaily
  participant Gate as evolve / F1
  participant RS as RuleSet
  Dev->>CI: PR com console.log em prod
  CI-->>Dev: finding HERO-SMELL-debug
  Dev->>FB: marca FP em arquivo de teste
  Note over RF: lote offline 1×/dia
  RF->>Gate: mutação + casos de corpus
  alt ΔF1>0 e P≥0.85
    Gate->>RS: PROMOTED
    RS-->>CI: próxima Action usa regra
  else sem ganho / P baixa
    Gate-->>RF: REJECTED auditável
  end`}
              caption="Figura — Sequência do cenário de produto: feedback e dress code alimentam o lote; só o portão F1 publica."
            />
            <div className="cr-docs-callout">
              <strong>Diferença prática vs outras ferramentas</strong>
              <p style={{ margin: "0.5rem 0 0" }}>
                Em suite enterprise, o time espera o vendor; em scanner só-IA, o “julgamento” muda com o modelo. No
                CodeHero o PR sempre vê o mesmo RuleSet, e a esteira offline é a única porta de entrada de regra nova —
                com rejeição explícita quando não há ganho (como no <code>evolve-all</code> que rodamos).
              </p>
            </div>
            <p>
              Wiki (markdown no repo):{" "}
              <a
                href="https://github.com/nbsjunior/codehero/blob/main/docs/wiki/Esteira-de-aprendizado-de-regras.md"
                target="_blank"
                rel="noreferrer"
              >
                docs/wiki/Esteira-de-aprendizado-de-regras.md
              </a>
              .
            </p>
          </section>

          <section id="fluxo-regras">
            <h2>Fluxo automatizado de criação de regras</h2>
            <p>
              Manutenibilidade e segurança compartilham o mesmo pipeline de promoção. O que muda é a{" "}
              <em>categoria</em> da regra promovida: code smells alimentam o TDR; vulnerabilidades/hotspots alimentam o
              rating de segurança.
            </p>

            <MermaidDiagram
              chart={DIAGRAM_RULE_AUTOMATION}
              caption="Figura E — Da política/telemetria ao RuleSet: candidatos → corpus → portão → impacto em manutenibilidade ou segurança."
            />

            <div className="cr-docs-compare">
              <div>
                <strong>Regras de manutenibilidade</strong>
                <ul>
                  <li>Tipo CODE_SMELL com effortMin</li>
                  <li>Sobe Σ débito quando disparam</li>
                  <li>Baixar TDR = melhorar rating A–E</li>
                  <li>Ex.: debug em produção, TODO abandonado, GO TO</li>
                </ul>
              </div>
              <div>
                <strong>Regras de segurança</strong>
                <ul>
                  <li>Tipo VULNERABILITY / HOTSPOT / BUG</li>
                  <li>Sobe a pior severidade do projeto</li>
                  <li>Portão exige P ≥ 0,85 (menos FP)</li>
                  <li>Ex.: secret hardcoded, XSS, SQL injection</li>
                </ul>
              </div>
            </div>

            <MermaidDiagram
              chart={DIAGRAM_RULEFORGE}
              caption="Figura F — Detalhe do ciclo diário: propostas → busca evolutiva → PROMOTED / REJECTED."
            />
          </section>

          <section id="modelos">
            <h2>Modelos: GenAI + motor de prova (o mix)</h2>
            <p>
              O CodeHero não escolhe “só IA” nem “só regras fixas”. Ele separa <strong>dois tipos de modelo</strong> com
              responsabilidades distintas — scanners clássicos + detecções complementares, mas com um contrato
              explícito: <em>a IA nunca é o juiz do quality gate</em>.
            </p>

            <div className="cr-docs-module-grid">
              <div className="cr-docs-module-card">
                <strong>Modelo generativo (GenAI)</strong>
                <span>
                  Interpreta linguagem natural (dress code), propõe mutações de regra (Dress Code Tools) e redige
                  contratos de correção (SDD) para agentes. Bom em exploração e síntese; ruim como única fonte de
                  verdade em CI.
                </span>
              </div>
              <div className="cr-docs-module-card">
                <strong>Modelo determinístico</strong>
                <span>
                  Matcher (regex/AST/dataflow), avaliação F1 no corpus, débito técnico e quality gate. Mesma entrada →
                  mesma saída. Roda na borda (CI/IDE) sem rede e sem custo de inferência por arquivo.
                </span>
              </div>
            </div>

            <MermaidDiagram
              chart={DIAGRAM_HYBRID}
              caption="Figura 1 — GenAI propõe; o motor determinístico decide, mede e prova."
            />

            <h3>Por que misturar os dois?</h3>
            <ul>
              <li>
                <strong>Cobertura sem alucinação no caminho crítico</strong> — o PR não depende de um LLM “achar” o
                bug a cada arquivo.
              </li>
              <li>
                <strong>Evolução contínua das regras</strong> — GenAI sugere padrões novos; o corpus + F1 só promove o
                que melhora precisão/recall sem regressão.
              </li>
              <li>
                <strong>Correção assistida com prova</strong> — o agente MCP aplica o SDD; o scanner rescaneia e
                confirma objetivamente.
              </li>
              <li>
                <strong>Custo e latência previsíveis no CI</strong> — scan = CPU local; GenAI fica offline (1×/dia) ou
                sob demanda (dress code / SDD).
              </li>
            </ul>

            <MermaidDiagram
              chart={DIAGRAM_PATHS}
              caption="Figura 2 — Caminho crítico do PR: scanner → métricas → gate → (opcional) fix verificado."
            />

            <MermaidDiagram
              chart={DIAGRAM_RULEFORGE}
              caption="Figura 3 — Evolução de regras: Dress Code Tools propõe mutações; o motor determinístico promove ou rejeita."
            />
          </section>

          <section id="matematica">
            <h2>Matemática por trás (débito técnico, F1, quality gate)</h2>
            <p>
              As fórmulas são as mesmas no scanner, na API e no portal. Assim o índice que o eng vê no dashboard é o
              mesmo que falhou (ou passou) no CI.
            </p>

            <h3>1. Débito técnico e manutenibilidade</h3>
            <p>
              Cada code smell carrega um esforço de remediação em minutos. O débito é a soma; o rating de
              manutenibilidade vem da razão entre débito e o custo de desenvolver o código (LOC × 30 min).
            </p>
            <div className="cr-docs-formula">
              <span className="cr-docs-formula-label">Débito e TDR</span>
              TechnicalDebt = Σ remediationEffortMin (code smells)
              {"\n"}
              DevelopmentCost = LOC × 30 min
              {"\n"}
              TDR = TechnicalDebt / DevelopmentCost
            </div>
            <div className="cr-docs-table-wrap">
              <table className="cr-docs-table">
                <thead>
                  <tr>
                    <th>TDR (debt ratio)</th>
                    <th>Maintainability rating</th>
                    <th>Leitura prática</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>≤ 5%</td>
                    <td>
                      <code>A</code>
                    </td>
                    <td>Débito saudável — gate padrão exige A</td>
                  </tr>
                  <tr>
                    <td>≤ 10%</td>
                    <td>
                      <code>B</code>
                    </td>
                    <td>Atenção — ainda recuperável</td>
                  </tr>
                  <tr>
                    <td>≤ 20%</td>
                    <td>
                      <code>C</code>
                    </td>
                    <td>Débito material</td>
                  </tr>
                  <tr>
                    <td>≤ 50%</td>
                    <td>
                      <code>D</code>
                    </td>
                    <td>Alto custo de mudança</td>
                  </tr>
                  <tr>
                    <td>&gt; 50%</td>
                    <td>
                      <code>E</code>
                    </td>
                    <td>Crítico — manutenibilidade comprometida</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3>2. Rating de segurança</h3>
            <p>
              Segurança (e reliability no mesmo eixo) não usa TDR: usa a{" "}
              <strong>pior severidade presente</strong> entre as issues relevantes. Sem issues → A.
            </p>
            <div className="cr-docs-table-wrap">
              <table className="cr-docs-table">
                <thead>
                  <tr>
                    <th>Pior severidade</th>
                    <th>Security rating</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>nenhuma / INFO</td>
                    <td>
                      <code>A</code>
                    </td>
                  </tr>
                  <tr>
                    <td>MINOR</td>
                    <td>
                      <code>B</code>
                    </td>
                  </tr>
                  <tr>
                    <td>MAJOR</td>
                    <td>
                      <code>C</code>
                    </td>
                  </tr>
                  <tr>
                    <td>CRITICAL</td>
                    <td>
                      <code>D</code>
                    </td>
                  </tr>
                  <tr>
                    <td>BLOCKER</td>
                    <td>
                      <code>E</code>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="cr-docs-formula">
              <span className="cr-docs-formula-label">Ordem de severidade</span>
              rank(BLOCKER) &gt; rank(CRITICAL) &gt; rank(MAJOR) &gt; rank(MINOR) &gt; rank(INFO)
              {"\n"}
              SecurityRating = rating( argmax_i rank(severity_i) )
            </div>

            <MermaidDiagram
              chart={DIAGRAM_RATINGS}
              caption="Figura 4 — Do relatório de análise aos índices A–E e ao Quality Gate."
            />

            <h3>3. Quality Gate (new code)</h3>
            <p>
              O gate padrão exige, entre outras condições:{" "}
              <strong>security rating ≤ A</strong>, <strong>maintainability rating ≤ A</strong>, zero blockers novos,
              cobertura e duplicação dentro dos limiares. Qualquer condição falha → <code>FAILED</code> (merge
              bloqueado na Action).
            </p>
            <div className="cr-docs-formula">
              <span className="cr-docs-formula-label">Gate (simplificado)</span>
              PASSED ⇔
              {"\n"}
              {"  "}coverage_new ≥ 80% ∧ duplication_new ≤ 3% ∧ blockers_new = 0
              {"\n"}
              {"  "}∧ security ≤ A ∧ maintainability ≤ A
            </div>

            <h3>4. Evolução de regras — precisão, recall e F1</h3>
            <p>
              Quando as Dress Code Tools propõem uma mutação de regra, o juiz é o corpus golden (casos{" "}
              <code>match</code> / <code>no_match</code>). Nada de “a IA achou bom”:
            </p>
            <div className="cr-docs-formula">
              <span className="cr-docs-formula-label">Classificação binária no corpus</span>
              Precision P = TP / (TP + FP)
              {"\n"}
              Recall R = TP / (TP + FN)
              {"\n"}
              F1 = 2 · P · R / (P + R)
            </div>
            <div className="cr-docs-formula">
              <span className="cr-docs-formula-label">Fitness do algoritmo genético + portão</span>
              fitness ≈ 1000·F1 + 10·P + simplicidade (Occam)
              {"\n"}
              PROMOTED ⇔ ΔF1 &gt; 0 ∧ P ≥ 0.85 ∧ zero regressões vs baseline
            </div>
            <p>
              Resultado: o catálogo de regras melhora com ajuda de GenAI, mas só entra no scanner o que o corpus
              comprova — protegendo os índices de segurança (menos FP que “choram lobo”) e de manutenibilidade
              (regras que realmente capturam smells caros).
            </p>
          </section>

          <section id="indices">
            <h2>Como o mix sobe manutenibilidade e segurança</h2>
            <p>
              Índices A–E não são “notas de vibe”: são funções do que o scanner determinístico encontra. O mix GenAI +
              determinístico melhora esses índices de formas complementares:
            </p>
            <div className="cr-docs-callout">
              <strong>O que o scanner conta hoje</strong>
              <p style={{ margin: "0.5rem 0 0" }}>
                Contam no gate e nos índices: regras <strong>L0 (CORE)</strong>, ports Sonar live, regras{" "}
                <strong>estruturais</strong> (HERO-ST-*, tree-sitter com <code>--metrics</code>) e achados{" "}
                <strong>importados</strong> via SARIF (CodeQL, Semgrep, Trivy…). Stubs do catálogo Sonar Way são
                metadados/política — não inventam findings. Procedência (<em>tool</em> / <em>engine</em>) fica no
                apontamento.
              </p>
            </div>
            <div className="cr-docs-callout">
              <strong>Movimentos 2 · 3 · 4</strong>
              <p style={{ margin: "0.5rem 0 0" }}>
                <strong>2 — CPG (Joern):</strong> <code>--joern</code> / Action <code>joern: true</code> (JDK ou
                Docker). Achados entram como <code>EXT:joern:*</code>. Opt-in — JVM no scan é escolha consciente.{" "}
                <strong>3 — Ranqueador FP:</strong> gradient boosting de stumps em features (teste/dist, taxa histórica,
                severidade…). Modelo versionado; confirmar/descartar no workspace gera rótulos;{" "}
                <code>exportRuleforgeFeedback</code> + <code>hero-fp-ranker train</code>.{" "}
                <strong>4 — CVE mine:</strong> <code>npm run cve:mine</code> extrai pares antes/depois de GHSA/OSV para o
                corpus do ruleforge (orquestração de agentes propõe offline; F1/P≥0.85 decide).
              </p>
            </div>
            <div className="cr-docs-callout">
              <strong>Locksmith Loop (migração legado)</strong>
              <p style={{ margin: "0.5rem 0 0" }}>
                Validação determinística COBOL→Java no espírito AmEx (arXiv:2607.28271):{" "}
                <em>Witness Search</em> (pairwise / 3-way / LHS / ART / MAP-Elites / UCB1) → parágrafos travados →{" "}
                <em>Mutation Skills</em> (<code>dispatcher-arm</code>, <code>call-injection</code>) nos dois harnesses →{" "}
                <em>Parity Gate</em> (<code>paragraphs_hit</code> ∧ <code>stub_log</code> ∧ <code>terminal_state</code>).
                Mutação só fica se cobertura↑ e parity PASS. CLI:{" "}
                <code>npm run locksmith -- run examples/legacy/sample.cbl</code> (e{" "}
                <code>locksmith-locked.cbl</code> para forçar Mutation Skills). Hoje o runner é mock de CFG (não
                GnuCOBOL/JVM); plugue <code>javaRunner</code> para o alvo real.
              </p>
            </div>

            <div className="cr-docs-compare">
              <div>
                <strong>Manutenibilidade (TDR ↓ → rating ↑)</strong>
                <ul>
                  <li>Regras de code smell com effortMin realistas somam o débito</li>
                  <li>Dress code (GenAI → regra) captura políticas do time cedo</li>
                  <li>Shift left no VS Code reduz smells antes do PR</li>
                  <li>MCP + rescaneio remove issues e corta Σ effort</li>
                  <li>Gate exige rating A no new code — impede regressão silenciosa</li>
                </ul>
              </div>
              <div>
                <strong>Segurança (pior severidade ↓ → rating ↑)</strong>
                <ul>
                  <li>Vulnerabilities/hotspots ranqueados por severidade</li>
                  <li>Evolução de regras só promove com P ≥ 0.85 (menos FP em segurança)</li>
                  <li>Action falha em CRITICAL/BLOCKER conforme fail-on</li>
                  <li>SDD guia o fix; scanner prova que a finding sumiu</li>
                  <li>Mesma régua no CI, IDE e portal — sem score paralelo</li>
                </ul>
              </div>
            </div>

            <div className="cr-docs-callout">
              <strong>Vantagem prática do mix</strong>
              <p style={{ margin: 0 }}>
                Sistemas só-de-IA variam o resultado e não fecham gate de forma auditável. Sistemas só-de-regras
                engessam e atrasam políticas novas. O CodeHero usa GenAI para <em>ampliar e acelerar</em> o catálogo e
                as correções, e modelos determinísticos + débito/F1 para <em>medir, promover e bloquear</em> com
                reprodutibilidade — exatamente o que faz o índice de manutenibilidade e segurança subir de forma
                sustentável.
              </p>
            </div>
          </section>

          <section id="papeis">
            <h2>Quem usa o CodeHero</h2>
            <p>
              A documentação e o portal são para o <strong>time do projeto</strong>: quem provisiona a org, liga o
              repositório e escolhe os canais (Action, plugin, MCP). Não é necessário conhecer infraestrutura do
              CodeHero — só a conta no portal e o repositório GitHub.
            </p>

            <div className="cr-docs-role-grid">
              <div className="cr-docs-role-card is-accent">
                <span className="cr-docs-role-badge">Admin de projeto</span>
                <h3 style={{ marginTop: "0.75rem" }}>Engenheiros, tech leads, donos do repo</h3>
                <p>
                  Provisionam organização e projeto, conectam o GitHub, instalam o plugin e/ou o MCP, definem dress
                  code do time e acompanham quality gate e issues.
                </p>
                <p style={{ marginBottom: 0 }}>
                  Tudo isso acontece no portal e no repositório — sem configurar infraestrutura do fornecedor.
                </p>
              </div>
              <div className="cr-docs-role-card">
                <span className="cr-docs-role-badge">Membros do time</span>
                <h3 style={{ marginTop: "0.75rem" }}>Quem abre PR e corrige findings</h3>
                <p>
                  Usam a Action no CI, o plugin no editor e, se quiserem, o MCP no agente para aplicar o SDD e provar o
                  fix.
                </p>
                <p style={{ marginBottom: 0 }}>
                  Recebem o token/config do admin do projeto (aba Configurar) — não gerenciam a conta da organização
                  sozinhos, salvo permissão no portal.
                </p>
              </div>
            </div>

            <h3>O que você faz no dia a dia</h3>
            <div className="cr-docs-compare">
              <div>
                <strong>Admin de projeto</strong>
                <ul>
                  <li>Criar org + projeto no portal</li>
                  <li>One-click da GitHub Action no repo</li>
                  <li>Plugin VS Code + prévia de repo + MCP</li>
                  <li>Dress code do próprio projeto</li>
                </ul>
              </div>
              <div>
                <strong>Engenharia no repo</strong>
                <ul>
                  <li>Push/PR com quality gate</li>
                  <li>Scan no editor antes do PR</li>
                  <li>Corrigir issues (manual ou via MCP)</li>
                  <li>Marcar falso positivo quando fizer sentido</li>
                </ul>
              </div>
            </div>
          </section>

          <section id="canais">
            <h2>Onde o CodeHero age</h2>
            <div className="cr-docs-module-grid">
              <div className="cr-docs-module-card">
                <strong>1. Pipeline (CI)</strong>
                <span>
                  GitHub Action em todo push/PR: scan → ingestão → quality gate. Merge só passa se o código estiver
                  adequado.
                </span>
              </div>
              <div className="cr-docs-module-card">
                <strong>2. IDE (shift left)</strong>
                <span>
                  Plugin VS Code/Cursor: varre o workspace, painel Avaliação, Problems, gráficos de
                  manutenibilidade / segurança / compliance.
                </span>
              </div>
              <div className="cr-docs-module-card">
                <strong>3. Prévia de repositório</strong>
                <span>
                  No portal: cole a URL do GitHub, rode a prévia na nuvem e veja findings + recomendações antes do PR.
                </span>
              </div>
              <div className="cr-docs-module-card">
                <strong>4. MCP (agentes)</strong>
                <span>
                  Cursor, Claude Desktop e GitHub Copilot: o agente lê issues, aplica SDD, rescaneia e prova o fix.
                </span>
              </div>
            </div>
          </section>

          <section id="comecar">
            <h2>Começar do zero (admin de projeto)</h2>
            <ol className="cr-docs-steps">
              <li>
                <strong>Crie a conta</strong>
                <p>
                  Em <Link href="/">codehero.web.app</Link>: email/senha ou Google. Em segundos você está no
                  dashboard.
                </p>
              </li>
              <li>
                <strong>Provisione org + projeto</strong>
                <p>
                  <em>Novo projeto</em> → nome da organização, nome do projeto e (recomendado) URL do repositório
                  GitHub. O portal gera o token de ingestão usado por CI, IDE e MCP.
                </p>
              </li>
              <li>
                <strong>Abra Configurar no projeto</strong>
                <p>
                  Quatro abas: Visão geral · Plugin VS Code · GitHub Action · MCP. Cada uma já vem com os dados do
                  <em>seu</em> projeto preenchidos.
                </p>
              </li>
              <li>
                <strong>Escolha o canal (pode usar todos)</strong>
                <p>
                  Action na esteira, plugin no editor, prévia no portal, MCP no agente. O workflow recomendado está
                  mais abaixo.
                </p>
              </li>
            </ol>
          </section>

          <section id="github-action">
            <h2>GitHub Action — quality gate na pipeline</h2>
            <p>
              É o jeito mais simples de garantir que <strong>todo PR</strong> passa pelas regras do CodeHero. Você
              configura tudo a partir do portal e do próprio repositório GitHub.
            </p>

            <h3>Passo a passo (1 clique)</h3>
            <ol className="cr-docs-steps">
              <li>
                <strong>Projeto com URL do repositório</strong>
                <p>Na criação (ou edição) informe a URL <code>https://github.com/org/repo</code>.</p>
              </li>
              <li>
                <strong>Aba GitHub Action → Configurar Action no GitHub (1 clique)</strong>
                <p>
                  Autorize o acesso pedido pelo portal. O CodeHero cria/atualiza{" "}
                  <code>.github/workflows/codehero.yml</code> e os segredos/variáveis necessários no repositório
                  (<code>HERO_TOKEN</code> e <code>HERO_CORE_URL</code>).
                </p>
              </li>
              <li>
                <strong>Abra um PR ou faça push</strong>
                <p>
                  A Action roda o scanner com as regras ativas (canônicas + dress code), envia o relatório e avalia o
                  quality gate. Severidades críticas podem falhar o job e bloquear o merge.
                </p>
              </li>
            </ol>

            <h3>Alternativas (se preferir manual)</h3>
            <ul>
              <li>
                <strong>Script <code>gh</code></strong> — copie na mesma aba do portal.
              </li>
              <li>
                <strong>Deep link “new file”</strong> — abre o GitHub com o YAML pronto para commit.
              </li>
              <li>
                <strong>Colar o YAML</strong> — em <code>.github/workflows/codehero.yml</code>.
              </li>
            </ul>
          </section>

          <section id="vscode">
            <h2>VS Code / Cursor — shift left no editor</h2>
            <p>
              Antes do PR, o engenheiro vê <strong>compliance e non-compliance</strong> no próprio workspace: painel
              Avaliação, Problems e (quando ligado ao portal) o contexto do projeto.
            </p>

            <h3>Instalar o plugin</h3>
            <ol className="cr-docs-steps">
              <li>
                <strong>Baixe o VSIX</strong>
                <p>
                  Na página do projeto → aba <em>Plugin VS Code</em> → <strong>Baixar plugin (.vsix)</strong>, ou em{" "}
                  <code>/downloads/codehero-vscode.vsix</code>.
                </p>
              </li>
              <li>
                <strong>Instale no editor</strong>
                <p>
                  Extensions → ⋯ → <em>Install from VSIX…</em> → selecione o arquivo. Funciona no VS Code e no Cursor.
                </p>
              </li>
              <li>
                <strong>Abra a pasta do repositório</strong>
                <p>File → Open Folder no root do app que você quer analisar.</p>
              </li>
            </ol>

            <h3>Rodar o scan no workspace (forma simples)</h3>
            <ol className="cr-docs-steps">
              <li>
                <strong>Ícone CodeHero na Activity Bar</strong>
                <p>
                  Clique em <strong>Rodar scan no workspace</strong>. O scanner embutido varre os arquivos do
                  workspace e aplica as regras ativas.
                </p>
              </li>
              <li>
                <strong>Leia o resultado</strong>
                <p>
                  Painel <em>Avaliação</em>: lista de findings. Dashboard (ícone de gráfico): anéis de{" "}
                  <strong>segurança</strong> e <strong>manutenibilidade</strong>, débito técnico e compliance.
                  Também sobe para <em>Problems</em>. Status bar mostra o andamento.
                </p>
              </li>
              <li>
                <strong>(Opcional) Ligar ao portal</strong>
                <p>
                  Cole o <code>.vscode/settings.json</code> gerado na aba do projeto (org, project, server, token).
                  Assim o scan usa as mesmas regras/dress code do projeto na nuvem.
                </p>
              </li>
              <li>
                <strong>Atalhos úteis</strong>
                <p>
                  Command Palette → <code>CodeHero: Abrir configurações</code> (scan ao salvar, cache, severidade
                  mínima). Node.js no PATH é suficiente — CLI extra não é necessária.
                </p>
              </li>
            </ol>
            <div className="cr-docs-callout">
              <strong>Por que shift left?</strong>
              <p style={{ margin: 0 }}>
                Corrigir no editor custa menos do que descobrir no PR. O mesmo motor da pipeline roda localmente —
                mesma linguagem de severidade e regras.
              </p>
            </div>
          </section>

          <section id="previa-repo">
            <h2>Varrer um repositório GitHub (prévia + recomendações)</h2>
            <p>
              Quando o objetivo é <strong>analisar o repo inteiro</strong> (não só a pasta aberta no editor), o fluxo
              recomendado é:
            </p>

            <h3>Opção A — Prévia no portal (rápida, ideal para demo e onboarding)</h3>
            <ol className="cr-docs-steps">
              <li>
                <strong>No dashboard</strong>, use o bloco <em>Prévia no runner</em>.
              </li>
              <li>
                <strong>Cole a URL</strong> de um repositório GitHub público (
                <code>https://github.com/org/repo</code>).
              </li>
              <li>
                <strong>Associe ao projeto</strong> (opcional) para aplicar dress code / regras do projeto.
              </li>
              <li>
                <strong>Rode a prévia</strong> — o CodeHero baixa o código, aplica as regras e devolve contagem por
                severidade + top findings (arquivo, linha, mensagem).
              </li>
            </ol>
            <p>
              Use isso para “mostrar o herói em ação” antes de ligar a Action. Hoje a prévia prioriza repos{" "}
              <strong>públicos</strong>; repos privados entram pelo caminho B.
            </p>

            <h3>Opção B — Repo completo na esteira (recomendado para produção)</h3>
            <ol className="cr-docs-steps">
              <li>
                <strong>Configure a GitHub Action</strong> (seção acima) no repositório — público ou privado.
              </li>
              <li>
                <strong>Push / PR</strong> dispara o scan de todo o checkout do job (path <code>.</code> por padrão).
              </li>
              <li>
                <strong>Resultado no portal</strong> — issues, ratings, débito técnico e quality gate. No GitHub,
                o relatório de análise também pode aparecer em Security / Code scanning.
              </li>
              <li>
                <strong>Recomendações de correção</strong> — no portal ou via MCP, peça o SDD Spec da issue: localização,
                contexto e critérios de aceite para o agente/humano aplicar o fix e <em>provar</em> com um novo scan.
              </li>
            </ol>

            <h3>Opção C — Workspace local = clone do repo</h3>
            <p>
              Clone o repositório, abra no VS Code/Cursor e rode <strong>Rodar scan no workspace</strong>. É o mesmo
              motor, arquivo a arquivo, com feedback imediato — ótimo enquanto você prepara o PR.
            </p>

            <div className="cr-docs-callout">
              <strong>Qual forma usar?</strong>
              <p style={{ margin: 0 }}>
                Demo / first look → <em>Prévia no portal</em>. Dia a dia do eng → <em>VS Code</em>. Gate de merge →{" "}
                <em>GitHub Action</em>. Correção assistida → <em>MCP</em>. Juntos formam o loop completo de qualidade.
              </p>
            </div>
          </section>

          <section id="mcp">
            <h2>MCP — Cursor, Claude, GitHub Copilot e Devin</h2>
            <p>
              O servidor MCP do CodeHero conecta agentes de IA às issues reais e ao catálogo de regras. O agente não
              “chuta” o fix: ele segue o contrato SDD e valida com evidência (<code>get_issues</code> / scan).
            </p>
            <p>
              Guia completo versionado:{" "}
              <a
                href="https://github.com/nbsjunior/codehero/blob/main/docs/wiki/Conectar-MCP-CodeHero.md"
                target="_blank"
                rel="noreferrer"
              >
                Conectar-MCP-CodeHero.md
              </a>
              . Exemplos JSON:{" "}
              <a href="https://github.com/nbsjunior/codehero/tree/main/integrations/mcp" target="_blank" rel="noreferrer">
                integrations/mcp/
              </a>
              .
            </p>

            <h3>Ferramentas expostas</h3>
            <ul>
              <li>
                <code>get_generation_context</code> — entrada em linguagem natural → bloco de regras/issues para o
                prompt
              </li>
              <li>
                <code>get_active_rules</code> — catálogo ativo (core + dress code)
              </li>
              <li>
                <code>get_issues</code> · <code>get_sdd_spec</code> · <code>submit_fix_result</code> — loop de
                correção
              </li>
              <li>
                <code>apply_sdd_workflow</code> — roteiro verified-fix
              </li>
              <li>
                <code>run_scan</code> — opcional (scanner local)
              </li>
            </ul>

            <h3>Antes de tudo (comum a todas)</h3>
            <ol className="cr-docs-steps">
              <li>
                <strong>Portal</strong>
                <p>
                  <Link href="/">codehero.web.app</Link> → projeto + repo → <strong>Integração MCP</strong> → copiar o
                  JSON (já com token).
                </p>
              </li>
              <li>
                <strong>Node ≥ 20</strong>
                <p>
                  O comando <code>npx -y codehero-mcp@latest</code> baixa o pacote na primeira execução.
                </p>
              </li>
              <li>
                <strong>Teste no chat</strong>
                <p>
                  “Chame <code>get_generation_context</code> com as regras CodeHero e aplique no contexto.”
                </p>
              </li>
            </ol>

            <pre>{`{
  "command": "npx",
  "args": ["-y", "codehero-mcp@latest"],
  "env": {
    "HERO_CORE_URL": "https://codehero.web.app/api",
    "HERO_TOKEN": "…",
    "HERO_ORG_ID": "…",
    "HERO_PROJECT_ID": "…",
    "HERO_REPO_ID": "…"
  }
}`}</pre>
          </section>

          <section id="mcp-cursor">
            <h2>MCP · Cursor</h2>
            <ol className="cr-docs-steps">
              <li>
                <strong>Crie</strong> <code>.cursor/mcp.json</code> na raiz do seu repo com o JSON do portal (formato{" "}
                <code>mcpServers</code>).
              </li>
              <li>
                <strong>Opcional:</strong> cole a regra do agente em <code>.cursor/rules/codehero-mcp.mdc</code>.
              </li>
              <li>
                <strong>Settings → MCP</strong> — confirme <code>codehero</code> conectado; Refresh se preciso.
              </li>
              <li>
                No Agent Chat: peça <code>get_generation_context</code>, depois <code>get_issues</code> /{" "}
                <code>get_sdd_spec</code>.
              </li>
            </ol>
          </section>

          <section id="mcp-claude">
            <h2>MCP · Claude Desktop</h2>
            <ol className="cr-docs-steps">
              <li>
                Edite <code>claude_desktop_config.json</code>:
                <ul style={{ marginTop: "0.4rem" }}>
                  <li>macOS: <code>~/Library/Application Support/Claude/</code></li>
                  <li>Windows: <code>%APPDATA%\Claude\</code></li>
                </ul>
              </li>
              <li>
                Mesclar o bloco <code>mcpServers.codehero</code> (mesmo JSON do portal).
              </li>
              <li>
                <strong>Feche e reabra</strong> o Claude Desktop por completo.
              </li>
              <li>
                Verifique as tools MCP e chame <code>get_generation_context</code>.
              </li>
            </ol>
          </section>

          <section id="mcp-github">
            <h2>MCP · GitHub Copilot</h2>
            <ol className="cr-docs-steps">
              <li>
                Crie <code>.vscode/mcp.json</code> com o formato <code>servers</code> (exemplo no repo; o painel
                também gera).
              </li>
              <li>
                Ative <strong>Agent mode</strong> no Copilot Chat.
              </li>
              <li>
                Autorize as tools CodeHero na sessão.
              </li>
              <li>
                Prompt: use o texto “Prompt pronto” do painel Integração MCP.
              </li>
            </ol>
            <p>
              Ambiente cloud do coding agent precisa de Node 20+ se for usar <code>npx</code> no runner. No editor
              local (VS Code) basta o Node da máquina.
            </p>
          </section>

          <section id="mcp-devin">
            <h2>MCP · Devin</h2>
            <p>
              Transport: <strong>STDIO</strong> com <code>npx</code> + <code>codehero-mcp@latest</code>.
            </p>
            <ol className="cr-docs-steps">
              <li>
                <strong>Web:</strong>{" "}
                <a href="https://app.devin.ai/settings/connections?tab=mcps" target="_blank" rel="noreferrer">
                  Settings → Connections → MCP servers
                </a>{" "}
                → <em>Add a custom MCP</em> → STDIO → command <code>npx</code>, args{" "}
                <code>-y codehero-mcp@latest</code>, env = variáveis do portal.
              </li>
              <li>
                <strong>CLI / Local:</strong> grave em <code>.devin/mcp_config.local.json</code> (token) ou{" "}
                <code>%APPDATA%\devin\mcp_config.json</code> (Windows). Exemplo:{" "}
                <a
                  href="https://github.com/nbsjunior/codehero/blob/main/integrations/mcp/devin.example.json"
                  target="_blank"
                  rel="noreferrer"
                >
                  devin.example.json
                </a>
                .
              </li>
              <li>
                Ou: <code>devin mcp add codehero -t stdio --command npx -- -y codehero-mcp@latest -e HERO_TOKEN=…</code>
              </li>
              <li>
                Na sessão Devin, peça para listar tools e chamar <code>get_issues</code> /{" "}
                <code>get_generation_context</code>.
              </li>
            </ol>
            <p>
              Referência Devin:{" "}
              <a href="https://docs.devin.ai/work-with-devin/mcp" target="_blank" rel="noreferrer">
                docs.devin.ai/work-with-devin/mcp
              </a>
              .
            </p>
          </section>

          <section id="presenca-sarif">
            <h2>Presença SARIF (orquestração)</h2>
            <p>
              CodeHero não substitui CodeQL/Semgrep: <strong>orquestra</strong> esses motores via SARIF e aplica a
              mesma política, gate e proveniência no portal. O nativo cobre o eixo de segurança com métricas
              peer-competitive (<a href="#posicionamento">posicionamento</a>); a amplitude de smells/SAST enterprise
              entra por import. No hot path do PR: scan nativo + imports; modelos só offline (triagem / ruleforge).
            </p>
            <ul>
              <li>
                <strong>Pack recomendado:</strong> CodeQL + Semgrep + Oxlint + Trivy/OSV — veja{" "}
                <a
                  href="https://github.com/nbsjunior/codehero/blob/main/docs/wiki/Presenca-SARIF.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  matriz wiki
                </a>{" "}
                e o workflow{" "}
                <a
                  href="https://github.com/nbsjunior/codehero/blob/main/examples/github-workflows/codehero-presence.example.yml"
                  target="_blank"
                  rel="noreferrer"
                >
                  codehero-presence.example.yml
                </a>
                .
              </li>
              <li>
                Action inputs: <code>oxlint</code>, <code>semgrep</code>, <code>sca</code>, <code>sca-tool</code>,{" "}
                <code>import-sarif</code>, <code>semantic</code>, <code>metrics</code> (default on).
              </li>
              <li>
                CLI: <code>--with-oxlint</code> / <code>--with-semgrep</code> / <code>--with-sca</code> (soft-fail se o
                binário não estiver no PATH) ou <code>--import path.sarif</code>.
              </li>
              <li>
                Achados importados aparecem como <code>EXT:&lt;tool&gt;:&lt;rule&gt;</code> com badge{" "}
                <em>via codeql</em> / <em>via oxlint</em> no findings browser.
              </li>
            </ul>
          </section>

          <section id="dress-code">
            <h2>Dress code do time</h2>
            <p>
              Descreva a política em português (“sem console.log em produção”, “sem Math.random em token”). As Dress
              Code Tools interpretam; o motor determinístico aplica como regra auditável.
            </p>
            <ul>
              <li>
                <strong>No projeto</strong> — políticas do seu time (escopo do projeto no portal).
              </li>
              <li>
                Políticas da organização, quando existirem, aparecem junto das regras ativas no scan — sem configuração
                extra no repositório.
              </li>
            </ul>
            <p>
              Scanners (Action, IDE, prévia, MCP) buscam as regras ativas no servidor antes de analisar — dress code
              novo passa a valer sem republicar o plugin.
            </p>
          </section>

          <section id="workflow-recomendado">
            <h2>Workflow recomendado (time de engenharia)</h2>
            <ol className="cr-docs-steps">
              <li>
                <strong>Provisionar</strong> o projeto no portal com a URL do GitHub.
              </li>
              <li>
                <strong>Prévia</strong> (repo público) ou primeiro push com Action — baseline de issues.
              </li>
              <li>
                <strong>One-click Action</strong> — quality gate em todo PR.
              </li>
              <li>
                <strong>Plugin VS Code</strong> — cada eng roda scan no workspace antes de abrir PR.
              </li>
              <li>
                <strong>Dress code</strong> — políticas do time em linguagem natural.
              </li>
              <li>
                <strong>MCP</strong> — corrigir issues com agente + prova objetiva (rescaneio).
              </li>
            </ol>
            <p>
              Resultado: menos surpresa no code review, menos débito silencioso, segurança e manutenibilidade medidas
              com o mesmo régua do CI até o editor.
            </p>
          </section>

          <section id="arquitetura">
            <h2>Arquitetura (resumo)</h2>
            <div className="cr-docs-module-grid">
              <div className="cr-docs-module-card">
                <strong>Motor de inspeção</strong>
                <span>
                  Scanner na borda (CI/IDE). Evolução de regras offline com Dress Code Tools + corpus golden.
                </span>
              </div>
              <div className="cr-docs-module-card">
                <strong>Painel &amp; SDD</strong>
                <span>Ingestão via API, débito técnico, quality gates, contratos de correção verificáveis.</span>
              </div>
              <div className="cr-docs-module-card">
                <strong>Integrações</strong>
                <span>VS Code, GitHub Action e MCP — o portal e a aba Configurar entregam o que cada canal precisa.</span>
              </div>
            </div>
            <p>
              Cada organização e projeto tem o próprio espaço no portal: regras, tokens de ingestão e quality gate
              ficam isolados por projeto.
            </p>
          </section>

          <section id="links">
            <h2>Links</h2>
            <ul>
              <li>
                <Link href="/">Portal CodeHero</Link>
              </li>
              <li>
                <a href="https://github.com/nbsjunior/codehero" target="_blank" rel="noreferrer">
                  Repositório
                </a>
              </li>
              <li>
                <a href="https://github.com/nbsjunior/codehero/wiki" target="_blank" rel="noreferrer">
                  Wiki
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/nbsjunior/codehero/blob/main/docs/wiki/Conectar-MCP-CodeHero.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  Wiki — Conectar MCP (Cursor, Claude, Copilot, Devin)
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/nbsjunior/codehero/blob/main/docs/wiki/Esteira-de-aprendizado-de-regras.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  Wiki — Esteira de aprendizado de regras
                </a>
              </li>
              <li>
                <a href="https://github.com/nbsjunior/codehero/blob/main/docs/ARCHITECTURE.md" target="_blank" rel="noreferrer">
                  Arquitetura (visão pública)
                </a>
              </li>
            </ul>
          </section>
        </article>
      </div>
    </div>
  );
}
