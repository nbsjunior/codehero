import Link from "next/link";

export const metadata = {
  title: "Docs — CodeHero",
  description: "Como o CodeHero funciona, arquitetura dos três módulos e como usar a plataforma do zero.",
};

const TOC = [
  { href: "#o-que-e", label: "O que é o CodeHero" },
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#arquitetura", label: "Arquitetura" },
  { href: "#como-usar", label: "Como usar" },
  { href: "#vscode", label: "Plugin VS Code" },
  { href: "#github-action", label: "GitHub Action" },
  { href: "#mcp", label: "MCP (Claude)" },
  { href: "#comparacao", label: "Comparação com o mercado" },
  { href: "#links", label: "Links e referências" },
];

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
            Como a plataforma funciona por baixo do capô, e o passo a passo para colocar seu time protegido — do
            cadastro ao primeiro Quality Gate.
          </p>

          <section id="o-que-e">
            <h2>O que é o CodeHero</h2>
            <p>
              CodeHero é uma plataforma de análise estática e correção de código no modelo conceitual do SonarQube,
              reconstruída com um eixo diferente: o catálogo de regras <strong>evolui continuamente</strong> por um
              motor de busca determinístico validado contra um corpus de teste, e cada issue encontrada já nasce com
              um contrato de correção (<strong>SDD Spec</strong>) que um agente de IA — via MCP — pode aplicar e
              provar que resolveu.
            </p>
            <p>
              O princípio central: <strong>a IA generativa nunca está no caminho crítico da inspeção</strong>. O
              motor que roda a cada commit é 100% determinístico — sem chamada de rede, sem custo de inferência por
              arquivo, sem resultado não-reprodutível. A IA entra em dois lugares específicos e controlados: na
              evolução offline das regras (<code>hero-ruleforge</code>), e na geração sob demanda de especificações
              de correção verificáveis.
            </p>
          </section>

          <section id="como-funciona">
            <h2>Como funciona — os três módulos</h2>
            <div className="cr-docs-module-grid">
              <div className="cr-docs-module-card">
                <strong>1. Motor de Inspeção</strong>
                <span>
                  <code>hero-scanner</code> roda na borda (CI/IDE), determinístico e instantâneo.{" "}
                  <code>hero-ruleforge</code> evolui as regras offline, validado por corpus.
                </span>
              </div>
              <div className="cr-docs-module-card">
                <strong>2. Painel &amp; SDD</strong>
                <span>
                  Ingestão de SARIF, cálculo de débito técnico (modelo SQALE), quality gates, e geração de
                  especificações de correção (SDD Spec).
                </span>
              </div>
              <div className="cr-docs-module-card">
                <strong>3. Integrações</strong>
                <span>Plugin VS Code, GitHub Action, e servidor MCP nativo para agentes de IA como o Claude.</span>
              </div>
            </div>
            <p>
              O fluxo completo: o scanner detecta um problema → o backend calcula o impacto no débito técnico e
              avalia o quality gate → se você (ou um agente) pedir uma correção, o backend monta um SDD Spec com
              localização exata, contexto e critérios de aceite → o agente aplica o fix → o scanner roda de novo para{" "}
              <strong>provar objetivamente</strong> que o problema foi resolvido, sem introduzir um novo.
            </p>
          </section>

          <section id="arquitetura">
            <h2>Arquitetura</h2>
            <p>
              Stack: <code>Rust/tree-sitter</code> (roadmap) e matcher determinístico em TypeScript (hoje) para o
              scanner; <code>Firebase Functions + Firestore</code> para o backend; <code>Next.js</code> para este
              painel; <code>MCP SDK</code> para a integração com agentes.
            </p>
            <p>
              O modelo de dados é multi-tenant por organização (<code>orgs/{"{orgId}"}/projects/{"{projectId}"}</code>
              ), com um papel de <strong>admin de plataforma</strong> separado (gerenciado fora da aplicação, nunca
              auto-concedido) para a visão global de todos os projetos.
            </p>
            <p>
              A documentação técnica completa — diagramas C4, fórmulas de débito técnico, especificação formal do SDD
              Spec, e o funcionamento do motor evolutivo de regras — está no repositório:
            </p>
            <ul>
              <li>
                <a href="https://github.com/nbsjunior/codehero/blob/main/docs/ARCHITECTURE.md" target="_blank" rel="noreferrer">
                  docs/ARCHITECTURE.md
                </a>{" "}
                — arquitetura completa, diagramas e roadmap
              </li>
              <li>
                <a href="https://github.com/nbsjunior/codehero/wiki" target="_blank" rel="noreferrer">
                  Wiki
                </a>{" "}
                — guias de uso: rodar o scanner, evoluir regras, deploy, multi-linguagem
              </li>
            </ul>
          </section>

          <section id="como-usar">
            <h2>Como usar — do zero ao primeiro Quality Gate</h2>
            <ol className="cr-docs-steps">
              <li>
                <strong>Crie sua conta</strong>
                <p>Email e senha, ou Google — leva menos de um minuto.</p>
              </li>
              <li>
                <strong>Provisione um projeto</strong>
                <p>
                  No dashboard, clique em <em>Novo projeto</em>. Isso cria sua organização e gera o token de acesso
                  usado por CI, IDE e MCP.
                </p>
              </li>
              <li>
                <strong>Escreva o dress code (opcional)</strong>
                <p>Descreva sua política em português — a IA propõe as regras, o motor determinístico as aplica.</p>
              </li>
              <li>
                <strong>Escolha como escanear</strong>
                <p>
                  Localmente com o plugin de IDE, ou remotamente via GitHub Action — veja as seções abaixo. Você pode
                  usar os dois ao mesmo tempo.
                </p>
              </li>
              <li>
                <strong>Configure na página do projeto</strong>
                <p>
                  Abra <em>Configurar</em> no seu projeto para pegar as credenciais e os passos de cada integração
                  (VS Code, GitHub Action, MCP) já preenchidos com seus dados reais.
                </p>
              </li>
            </ol>
          </section>

          <section id="vscode">
            <h2>Plugin VS Code / Cursor</h2>
            <p>
              Baixe o <code>.vsix</code> na página do projeto (aba <em>Plugin VS Code</em>) e instale via{" "}
              <em>Extensions → … → Install from VSIX</em>. A aba já gera o trecho de configuração (
              <code>.vscode/settings.json</code>) com a URL do servidor, token e IDs do seu projeto prontos para
              colar.
            </p>
            <p>
              Sem instalar plugin, também dá para rodar o scanner via linha de comando:{" "}
              <code>node packages/scanner/src/index.ts .</code> — ver{" "}
              <a href="https://github.com/nbsjunior/codehero/wiki/Running-the-Scanner" target="_blank" rel="noreferrer">
                Running the Scanner
              </a>{" "}
              na Wiki.
            </p>
          </section>

          <section id="github-action">
            <h2>GitHub Action — vínculo em 1 clique</h2>
            <p>
              Na aba <em>GitHub Action</em> da página do projeto, clique em <strong>Adicionar workflow no GitHub</strong>
              : isso abre o GitHub já com o arquivo <code>.github/workflows/codehero.yml</code> preenchido com seu
              orgId/projectId — você só confirma o commit. Depois, configure os dois valores restantes em{" "}
              <em>Settings → Secrets and variables → Actions</em>: <code>HERO_CORE_URL</code> (variável) e{" "}
              <code>HERO_TOKEN</code> (secret) — ambos com botão de copiar na mesma aba.
            </p>
            <p>
              O quality gate roda a cada PR e bloqueia o merge se houver issue BLOCKER nova ou rating de
              segurança/manutenibilidade abaixo de A no código novo — ver{" "}
              <a href="https://github.com/nbsjunior/codehero/wiki/GitHub-Action-Setup" target="_blank" rel="noreferrer">
                GitHub Action Setup
              </a>{" "}
              na Wiki para os detalhes.
            </p>
          </section>

          <section id="mcp">
            <h2>MCP — conectar ao Claude</h2>
            <p>
              A aba <em>MCP (Claude)</em> da página do projeto gera o bloco pronto para colar em{" "}
              <code>claude_desktop_config.json</code>, com a URL do servidor, seu token e IDs já preenchidos. O
              servidor MCP expõe <code>get_issues</code>, <code>get_sdd_spec</code>, <code>run_scan</code> e{" "}
              <code>submit_fix_result</code> — o agente consulta issues, recebe o contrato de correção, aplica o fix,
              roda o scanner de novo para verificar, e reporta o resultado.
            </p>
            <p>
              O token de acesso é o mesmo para CI, IDE e MCP — a mesma aba tem o botão{" "}
              <strong>Rotacionar token</strong> caso precise invalidar um token vazado.
            </p>
          </section>

          <section id="comparacao">
            <h2>Comparação com o mercado</h2>
            <p>
              Ver a tabela comparativa completa (CodeHero vs Sonar/CodeQL/Coverity vs scanners só-de-IA vs linters
              soltos) na{" "}
              <Link href="/#missao">página inicial</Link>.
            </p>
          </section>

          <section id="links">
            <h2>Links e referências</h2>
            <ul>
              <li>
                <a href="https://github.com/nbsjunior/codehero" target="_blank" rel="noreferrer">
                  Repositório no GitHub
                </a>
              </li>
              <li>
                <a href="https://github.com/nbsjunior/codehero/wiki" target="_blank" rel="noreferrer">
                  Wiki — guias de uso
                </a>
              </li>
              <li>
                <a href="https://github.com/nbsjunior/codehero/blob/main/docs/ARCHITECTURE.md" target="_blank" rel="noreferrer">
                  Arquitetura técnica completa
                </a>
              </li>
            </ul>
          </section>
        </article>
      </div>
    </div>
  );
}
