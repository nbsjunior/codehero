import Link from "next/link";
import MermaidDiagram from "@/components/MermaidDiagram";

export const metadata = {
  title: "Docs — CodeHero",
  description:
    "Guia completo: modelos GenAI + determinísticos, SQALE, papéis, GitHub Action, VS Code, prévia GitHub e MCP.",
};

const TOC = [
  { href: "#missao", label: "Missão e valor" },
  { href: "#modelos", label: "Modelos GenAI + determinísticos" },
  { href: "#matematica", label: "Matemática (SQALE, F1, gate)" },
  { href: "#indices", label: "Manutenibilidade e segurança" },
  { href: "#papeis", label: "Dois tipos de perfil" },
  { href: "#canais", label: "Onde o CodeHero age" },
  { href: "#comecar", label: "Começar do zero" },
  { href: "#github-action", label: "GitHub Action (pipeline)" },
  { href: "#vscode", label: "VS Code / Cursor (shift left)" },
  { href: "#previa-repo", label: "Varrer um repositório GitHub" },
  { href: "#mcp", label: "MCP nas IDEs de IA" },
  { href: "#dress-code", label: "Dress code do time" },
  { href: "#workflow-recomendado", label: "Workflow recomendado" },
  { href: "#arquitetura", label: "Arquitetura (resumo)" },
  { href: "#links", label: "Links" },
];

const DIAGRAM_HYBRID = `flowchart TB
  subgraph gen["Camada GenAI — propõe, não decide"]
    DC["Dress code em português"]
    RF["ruleforgeDaily / Genkit"]
    SDD["SDD Spec + agente MCP"]
  end
  subgraph det["Camada determinística — decide e prova"]
    SCAN["hero-scanner\\nregex / AST / dataflow"]
    CORPUS["Corpus golden\\nP / R / F1"]
    SQALE["Métricas SQALE\\ndébito · ratings · gate"]
  end
  DC -->|regras candidatas| SCAN
  RF -->|MutationSpec| CORPUS
  CORPUS -->|só se ΔF1>0 e P≥0.85| SCAN
  SCAN -->|SARIF| SQALE
  SDD -->|fix proposto| SCAN
  SCAN -->|rescaneio prova o fix| SDD`;

const DIAGRAM_PATHS = `flowchart LR
  PR["Push / PR / IDE"] --> SCAN["Scanner determinístico"]
  SCAN --> SARIF["SARIF + fingerprints"]
  SARIF --> ING["ingestAnalysis"]
  ING --> MET["Débito + ratings\\nmanutenibilidade / segurança"]
  MET --> QG{"Quality Gate"}
  QG -->|PASSED| OK["Merge liberado"]
  QG -->|FAILED| BLOCK["Bloqueia merge"]
  BLOCK --> MCP["MCP / SDD / humano"]
  MCP --> FIX["Correção"]
  FIX --> SCAN`;

const DIAGRAM_RULEFORGE = `flowchart LR
  FB["Telemetria FP/FN"] --> GEN["Genkit\\npropõe mutações"]
  HAND["Mutações humanas"] --> POOL["Pool de candidatos"]
  GEN -.->|não decide| POOL
  POOL --> GA["GA determinístico\\nseed diária"]
  GOLD["Corpus golden"] --> GA
  GA -->|"PROMOTED\\nΔF1>0 · P≥0.85 · 0 regressão"| RULES["RuleSet ativo"]
  GA -->|REJECTED| LOG["ruleforgeRuns"]
  RULES --> SCAN["hero-scanner\\nsem LLM por arquivo"]`;

const DIAGRAM_RATINGS = `flowchart TB
  ISSUES["Issues do SARIF"] --> SMELL["CODE_SMELL\\nΣ effortMin"]
  ISSUES --> SEV["Vulnerabilities / Bugs\\nseveridades"]
  SMELL --> TDR["TDR = Debt / LOC×30min"]
  TDR --> MR["Maintainability\\nA–E"]
  SEV --> SR["Security rating\\n= pior severidade"]
  MR --> GATE["Quality Gate\\nmax rating A"]
  SR --> GATE`;

export default function DocsPage() {
  return (
    <div className="cr-page">
      <nav className="cr-docs-nav">
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#fff" }}>
          <span className="cr-nav-mark" aria-hidden>
            H
          </span>
          <strong>CodeHero</strong>
        </Link>
        <div style={{ display: "flex", gap: "1.25rem", alignItems: "center" }}>
          <a href="https://github.com/nbsjunior/codehero" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="https://github.com/nbsjunior/codehero/wiki" target="_blank" rel="noreferrer">
            Wiki
          </a>
          <Link href="/" className="cr-btn cr-btn-primary" style={{ textDecoration: "none", padding: "0.5rem 1rem" }}>
            Entrar
          </Link>
        </div>
      </nav>

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
            Como aumentar qualidade e segurança do código — na pipeline, no editor (shift left) e nas IDEs de IA —
            sem o time precisar configurar infraestrutura.
          </p>

          <section id="missao">
            <h2>Missão e valor</h2>
            <p>
              O CodeHero existe para <strong>elevar a qualidade e a segurança</strong> do software que o time entrega.
              O scanner é <strong>determinístico</strong> (reproduzível, auditável, sem “alucinação” no caminho crítico).
              A IA entra onde agrega: dress code em português, contratos de correção (SDD) e agentes via MCP.
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

          <section id="modelos">
            <h2>Modelos: GenAI + determinísticos (o mix)</h2>
            <p>
              O CodeHero não escolhe “só IA” nem “só regras fixas”. Ele separa <strong>dois tipos de modelo</strong> com
              responsabilidades distintas — o mesmo espírito do CodeQL + detecções complementares, mas com um contrato
              explícito: <em>a IA nunca é o juiz do quality gate</em>.
            </p>

            <div className="cr-docs-module-grid">
              <div className="cr-docs-module-card">
                <strong>Modelo generativo (GenAI)</strong>
                <span>
                  Interpreta linguagem natural (dress code), propõe mutações de regra (Genkit / ruleforge) e redige
                  contratos de correção (SDD) para agentes. Bom em exploração e síntese; ruim como única fonte de
                  verdade em CI.
                </span>
              </div>
              <div className="cr-docs-module-card">
                <strong>Modelo determinístico</strong>
                <span>
                  Matcher (regex/AST/dataflow), avaliação F1 no corpus, débito SQALE e quality gate. Mesma entrada →
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
              caption="Figura 3 — Evolução de regras: Genkit propõe mutações; o GA determinístico promove ou rejeita."
            />
          </section>

          <section id="matematica">
            <h2>Matemática por trás (SQALE, F1, quality gate)</h2>
            <p>
              As fórmulas vivem em <code>@codehero/contracts</code> — puras, iguais no Functions, no scanner e no
              browser. Assim o índice que o eng vê no portal é o mesmo que falhou (ou passou) no CI.
            </p>

            <h3>1. Débito técnico e manutenibilidade (SQALE)</h3>
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
              caption="Figura 4 — Do SARIF aos índices A–E e ao Quality Gate."
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
              Quando o Genkit propõe uma mutação de regra, o juiz é o corpus golden (casos{" "}
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
                  <li>Ruleforge só promove com P ≥ 0.85 (menos FP em segurança)</li>
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
                as correções, e modelos determinísticos + SQALE/F1 para <em>medir, promover e bloquear</em> com
                reprodutibilidade — exatamente o que faz o índice de manutenibilidade e segurança subir de forma
                sustentável.
              </p>
            </div>
          </section>

          <section id="papeis">
            <h2>Dois tipos de perfil</h2>
            <p>
              A plataforma separa quem opera a <em>plataforma inteira</em> de quem opera <em>projetos e
              repositórios</em>. Isso evita que engenheiros precisem conhecer Firebase, secrets de cloud ou painéis de
              infra.
            </p>

            <div className="cr-docs-role-grid">
              <div className="cr-docs-role-card">
                <span className="cr-docs-role-badge">Admin geral da plataforma</span>
                <h3 style={{ marginTop: "0.75rem" }}>Enxerga todos os projetos</h3>
                <p>
                  Papel interno do CodeHero. Vê o painel global (<code>/admin</code>), acompanha orgs/projetos de
                  todos os clientes e pode definir dress code <strong>global</strong> (regras que valem para a
                  plataforma).
                </p>
                <p style={{ marginBottom: 0 }}>
                  Conta de referência atual: <code>nelsonborgesjr@hotmail.com</code> — concedida fora da aplicação
                  (nunca autoatribuída no signup).
                </p>
              </div>
              <div className="cr-docs-role-card is-accent">
                <span className="cr-docs-role-badge">Admin de projeto (cliente)</span>
                <h3 style={{ marginTop: "0.75rem" }}>Engenheiros, tech leads, donos do repo</h3>
                <p>
                  São os usuários típicos: querem qualidade no código das aplicações (repos públicos ou privados).
                  Provisionam o projeto no portal, ligam o GitHub Action, instalam o plugin e/ou o MCP.
                </p>
                <p style={{ marginBottom: 0 }}>
                  <strong>Não</strong> configuram Firebase, Cloud Functions nem secrets da plataforma — só o portal e
                  o repositório deles.
                </p>
              </div>
            </div>

            <h3>O que cada um faz no dia a dia</h3>
            <div className="cr-docs-compare">
              <div>
                <strong>Admin geral</strong>
                <ul>
                  <li>Monitorar saúde de todos os projetos</li>
                  <li>Dress code global da plataforma</li>
                  <li>Operação / OAuth App / secrets (ops)</li>
                </ul>
              </div>
              <div>
                <strong>Admin de projeto</strong>
                <ul>
                  <li>Criar org + projeto no portal</li>
                  <li>One-click da GitHub Action no repo</li>
                  <li>Plugin VS Code + prévia de repo + MCP</li>
                  <li>Dress code do próprio projeto</li>
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
                  Plugin VS Code/Cursor: varre o workspace, painel Avaliação, Problems, gráficos de compliance /
                  non-compliance.
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
              É o jeito mais simples de garantir que <strong>todo PR</strong> passa pelas regras do CodeHero. O admin
              de projeto configura no próprio GitHub, sem tocar em Firebase.
            </p>

            <h3>Passo a passo (1 clique)</h3>
            <ol className="cr-docs-steps">
              <li>
                <strong>Projeto com repoUrl</strong>
                <p>Na criação (ou edição) informe a URL <code>https://github.com/org/repo</code>.</p>
              </li>
              <li>
                <strong>Aba GitHub Action → Configurar Action no GitHub (1 clique)</strong>
                <p>
                  Autorize o app do CodeHero. O portal cria/atualiza{" "}
                  <code>.github/workflows/codehero.yml</code>, o secret <code>HERO_TOKEN</code> e a variable{" "}
                  <code>HERO_CORE_URL</code> (= <code>https://codehero.web.app/api</code>).
                </p>
              </li>
              <li>
                <strong>Abra um PR ou faça push</strong>
                <p>
                  A Action roda o scanner com as regras ativas (canônicas + dress code), envia o SARIF e avalia o
                  quality gate. Severidades críticas podem falhar o job e bloquear o merge.
                </p>
              </li>
            </ol>

            <h3>Alternativas (se preferir manual)</h3>
            <ul>
              <li>
                <strong>Script <code>gh</code></strong> — copie na mesma aba (<code>gh secret set</code> /{" "}
                <code>gh variable set</code>).
              </li>
              <li>
                <strong>Deep link “new file”</strong> — abre o GitHub com o YAML pronto para commit.
              </li>
              <li>
                <strong>Colar o YAML</strong> — em <code>.github/workflows/codehero.yml</code>.
              </li>
            </ul>
            <div className="cr-docs-callout">
              <strong>Callback OAuth (só ops da plataforma)</strong>
              <p style={{ margin: 0 }}>
                O GitHub redireciona para <code>https://codehero.web.app/projeto/githubOauthCallback</code>. Clientes
                não precisam saber disso — é configuração do admin geral.
              </p>
            </div>
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
                  Painel <em>Avaliação</em>: lista de findings (compliance / non-compliance). Também sobe para{" "}
                  <em>Problems</em> com severidade. Status bar mostra o andamento.
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
                SARIF também pode aparecer em Security / Code scanning.
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
            <h2>MCP — Cursor, Claude e GitHub Copilot</h2>
            <p>
              O servidor MCP do CodeHero conecta agentes de IA às issues reais e ao scanner. O agente não “chuta” o
              fix: ele segue o contrato SDD e valida com um novo scan.
            </p>

            <h3>Ferramentas expostas</h3>
            <ul>
              <li>
                <code>get_issues</code> — lista findings do projeto
              </li>
              <li>
                <code>get_sdd_spec</code> — contrato de correção verificável
              </li>
              <li>
                <code>run_scan</code> — roda o scanner (com regras do servidor quando configurado)
              </li>
              <li>
                <code>submit_fix_result</code> — reporta o resultado da correção
              </li>
              <li>
                <code>apply_sdd_workflow</code> — roteiro completo verified-fix
              </li>
            </ul>

            <h3>Passo a passo</h3>
            <ol className="cr-docs-steps">
              <li>
                <strong>Aba MCP na página do projeto</strong>
                <p>Copie o bloco JSON já preenchido (URL, token, org, project).</p>
              </li>
              <li>
                <strong>Cole na IDE de IA</strong>
                <ul style={{ marginTop: "0.4rem" }}>
                  <li>
                    <strong>Claude Desktop</strong> — <code>claude_desktop_config.json</code>
                  </li>
                  <li>
                    <strong>Cursor</strong> — MCP settings / <code>mcp.json</code>
                  </li>
                  <li>
                    <strong>GitHub Copilot</strong> — configuração MCP do agente (ver exemplos em{" "}
                    <code>integrations/mcp/</code> no repo)
                  </li>
                </ul>
              </li>
              <li>
                <strong>Peça ao agente</strong>
                <p>
                  Ex.: “Liste as issues CRITICAL do projeto e aplique o SDD da primeira; rode o scan de novo e
                  confirme.”
                </p>
              </li>
            </ol>
            <p>
              O token é o mesmo da Action e do plugin. Se vazar: <strong>Rotacionar token</strong> na página do
              projeto.
            </p>
          </section>

          <section id="dress-code">
            <h2>Dress code do time</h2>
            <p>
              Descreva a política em português (“sem console.log em produção”, “sem Math.random em token”). O Genkit
              interpreta; o motor determinístico aplica como regra auditável.
            </p>
            <ul>
              <li>
                <strong>Admin de projeto</strong> — dress code no escopo do projeto.
              </li>
              <li>
                <strong>Admin geral</strong> — dress code global (vale para a plataforma).
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
                  <code>hero-scanner</code> na borda (CI/IDE). <code>hero-ruleforge</code> evolui regras offline.
                </span>
              </div>
              <div className="cr-docs-module-card">
                <strong>Painel &amp; SDD</strong>
                <span>Ingestão SARIF, SQALE, quality gates, contratos de correção verificáveis.</span>
              </div>
              <div className="cr-docs-module-card">
                <strong>Integrações</strong>
                <span>VS Code, GitHub Action, MCP — API pública em <code>codehero.web.app/api</code>.</span>
              </div>
            </div>
            <p>
              Multi-tenant: <code>orgs/{"{orgId}"}/projects/{"{projectId}"}</code>. Admin de plataforma é papel
              separado, gerenciado fora do signup. Detalhes técnicos:{" "}
              <a href="https://github.com/nbsjunior/codehero/blob/main/docs/ARCHITECTURE.md" target="_blank" rel="noreferrer">
                docs/ARCHITECTURE.md
              </a>
              .
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
                  href="https://github.com/nbsjunior/codehero/blob/main/docs/GITHUB_ACTION_ONE_CLICK.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  One-click GitHub Action (ops)
                </a>
              </li>
              <li>
                <a href="https://github.com/nbsjunior/codehero/blob/main/docs/ARCHITECTURE.md" target="_blank" rel="noreferrer">
                  Arquitetura completa
                </a>
              </li>
            </ul>
          </section>
        </article>
      </div>
    </div>
  );
}
