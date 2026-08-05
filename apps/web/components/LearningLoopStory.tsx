"use client";

import MermaidDiagram from "@/components/MermaidDiagram";

const DIAGRAM_LOOP = `flowchart LR
  subgraph O["1 · Observar"]
    S["Scan CI / IDE / prévia"]
    F["Feedback FP / FN"]
  end
  subgraph P["2 · Propor"]
    D["Dress code / Genkit\\nlote offline"]
    M["Pool de mutações"]
  end
  subgraph V["3 · Provar"]
    C["Corpus golden"]
    G["Busca evolutiva\\nP · R · F1"]
  end
  subgraph U["4 · Publicar"]
    Q{"ΔF1>0 ∧ P≥0.85?"}
    R["RuleSet ativo"]
    X["REJECTED\\nauditável"]
  end
  S --> F --> D --> M --> G
  C --> G
  G --> Q
  Q -->|sim| R
  Q -->|não| X
  R --> S`;

const DIAGRAM_VS = `flowchart TB
  subgraph other["Ferramentas clássicas / só-IA"]
    A1["Vendor solta release"]
    A2["ou LLM lê cada arquivo no PR"]
    A1 --> A3["Time engole FP ou espera patch"]
    A2 --> A4["Resultado muda entre execuções"]
  end
  subgraph hero["CodeHero"]
    B1["Telemetria + política do time"]
    B2["IA só propõe offline"]
    B3["Corpus decide com F1"]
    B4["CI usa regra determinística"]
    B1 --> B2 --> B3 --> B4
  end`;

/**
 * Bloco educativo da esteira ruleforge — landing e docs.
 */
export default function LearningLoopStory({
  compact = false,
  id = "esteira-regras",
  variant = "landing",
}: {
  compact?: boolean;
  id?: string;
  variant?: "landing" | "docs";
}) {
  const sectionClass =
    variant === "docs" ? undefined : `cr-section${compact ? "" : " cr-section-alt"}`;

  return (
    <section id={id} className={sectionClass}>
      <div className={variant === "docs" ? undefined : "cr-section-head"}>
        {variant === "docs" ? (
          <>
            <h2>Como o sistema aprende de forma contínua</h2>
            <p>
              O aprendizado <em>não</em> é “um LLM lê cada arquivo no PR”. É um ciclo com prova: observar → propor →
              provar no corpus → publicar só o que melhora precisão.
            </p>
          </>
        ) : (
          <>
            <h2>A esteira que aprende regras — passo a passo</h2>
            <p>
              Não é um LLM no PR. É um ciclo com prova: observar → propor → provar no corpus → publicar só o que
              melhora precisão.
            </p>
          </>
        )}
      </div>

      <ol className="cr-loop-steps" aria-label="Quatro passos da esteira">
        <li>
          <figure className="cr-loop-card">
            <div className="cr-loop-illus" aria-hidden>
              <span className="cr-loop-num">1</span>
              <svg viewBox="0 0 120 72" className="cr-loop-svg">
                <rect x="8" y="14" width="40" height="44" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M18 28h20M18 38h14M18 48h18" stroke="currentColor" strokeWidth="2" />
                <circle cx="78" cy="36" r="18" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M70 36l6 6 12-14" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
            </div>
            <figcaption>
              <strong>Observar</strong>
              <p>
                Action, IDE e prévia geram findings. Quando alguém marca falso positivo ou confirma um achado, isso vira
                telemetria rotulada — combustível do próximo ciclo.
              </p>
            </figcaption>
          </figure>
        </li>
        <li>
          <figure className="cr-loop-card">
            <div className="cr-loop-illus" aria-hidden>
              <span className="cr-loop-num">2</span>
              <svg viewBox="0 0 120 72" className="cr-loop-svg">
                <path
                  d="M20 50 Q40 10 60 36 T100 28"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <circle cx="20" cy="50" r="4" fill="currentColor" />
                <circle cx="60" cy="36" r="4" fill="currentColor" />
                <circle cx="100" cy="28" r="4" fill="currentColor" />
                <text x="48" y="66" fontSize="10" fill="currentColor">
                  Genkit · offline
                </text>
              </svg>
            </div>
            <figcaption>
              <strong>Propor</strong>
              <p>
                Em lote (fora do PR), Dress Code Tools / Genkit sugerem mutações ou regras novas a partir de política do
                time, gaps e feedback. A IA <em>não</em> fecha o gate.
              </p>
            </figcaption>
          </figure>
        </li>
        <li>
          <figure className="cr-loop-card">
            <div className="cr-loop-illus" aria-hidden>
              <span className="cr-loop-num">3</span>
              <svg viewBox="0 0 120 72" className="cr-loop-svg">
                <rect x="10" y="12" width="100" height="48" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                <text x="20" y="32" fontSize="11" fill="currentColor">
                  P = TP/(TP+FP)
                </text>
                <text x="20" y="48" fontSize="11" fill="currentColor">
                  F1 · portão ≥ 0,85
                </text>
              </svg>
            </div>
            <figcaption>
              <strong>Provar</strong>
              <p>
                Busca evolutiva reproduzível mede precisão, recall e F1 no corpus golden. Candidata ruim sai com motivo
                auditável — sem “opinião” do modelo.
              </p>
            </figcaption>
          </figure>
        </li>
        <li>
          <figure className="cr-loop-card">
            <div className="cr-loop-illus" aria-hidden>
              <span className="cr-loop-num">4</span>
              <svg viewBox="0 0 120 72" className="cr-loop-svg">
                <path d="M24 40h48" stroke="currentColor" strokeWidth="2" />
                <polygon points="72,32 88,40 72,48" fill="currentColor" />
                <rect x="92" y="24" width="18" height="32" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                <text x="16" y="64" fontSize="10" fill="currentColor">
                  RuleSet → CI
                </text>
              </svg>
            </div>
            <figcaption>
              <strong>Publicar</strong>
              <p>
                Só entra no RuleSet ativo se ΔF1 &gt; 0, P ≥ 0,85 e zero regressão. No próximo scan o time já usa a regra —
                sem republicar plugin.
              </p>
            </figcaption>
          </figure>
        </li>
      </ol>

      {!compact && (
        <>
          <MermaidDiagram
            chart={DIAGRAM_LOOP}
            caption="Figura — Esteira completa: a IA alimenta o pool; o corpus e o F1 decidem o que chega ao CI."
          />

          <div className="cr-section-head" style={{ marginTop: "2.5rem" }}>
            <h3 style={{ fontSize: "1.35rem", margin: 0 }}>Por que isso é diferente</h3>
            <p>Outras ferramentas ou esperam release do vendor, ou colocam LLM no caminho crítico do PR.</p>
          </div>

          <MermaidDiagram
            chart={DIAGRAM_VS}
            caption="Figura — À esquerda, ciclo opaco ou instável; à direita, proposta offline + prova determinística."
          />

          <div className="cr-compare-wrap" style={{ marginTop: "1.5rem" }}>
            <table className="cr-compare-table">
              <thead>
                <tr>
                  <th scope="col">No PR / CI</th>
                  <th scope="col" className="cr-compare-highlight">
                    CodeHero
                  </th>
                  <th scope="col">Suite enterprise</th>
                  <th scope="col">Scanner só de IA</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Quem decide a regra</th>
                  <td className="cr-compare-highlight">Corpus + F1 (auditável)</td>
                  <td>Release do vendor</td>
                  <td>Prompt / modelo</td>
                </tr>
                <tr>
                  <th scope="row">LLM no arquivo do PR?</th>
                  <td className="cr-compare-highlight">Não</td>
                  <td>Não (em geral)</td>
                  <td>Sim</td>
                </tr>
                <tr>
                  <th scope="row">Mesmo commit, mesmo resultado</th>
                  <td className="cr-compare-highlight">Sim</td>
                  <td>Sim</td>
                  <td>Não garantido</td>
                </tr>
                <tr>
                  <th scope="row">Política do time em PT</th>
                  <td className="cr-compare-highlight">Dress code → regra</td>
                  <td>Raro</td>
                  <td>Não estruturado</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      <article className="cr-scenario">
        <header>
          <p className="cr-eyebrow">cenário exercitado</p>
          <h3>O que aconteceu de verdade no motor</h3>
        </header>
        <div className="cr-scenario-body">
          <p>
            Rodamos <code>npm run ruleforge:evaluate</code> e <code>npm run ruleforge:evolve-all</code> no corpus
            golden. Vinte regras de segurança/smell (ex.:{" "}
            <code>HERO-SEC-0798-hardcoded-secret</code>, <code>HERO-SEC-0089-sql-injection</code>) mediram{" "}
            <strong>P = R = F1 = 1,00</strong> — zero falso positivo no corpus.
          </p>
          <ol>
            <li>
              <strong>Observar / baseline</strong> — o evaluate listou TP/FP/FN por regra; o catálogo já estava “no
              teto” de precisão nos casos rotulados.
            </li>
            <li>
              <strong>Propor</strong> — o evolve montou população de mutações (máscaras sobre o padrão) por 5 gerações,
              seed fixo, sem chamar LLM no caminho crítico.
            </li>
            <li>
              <strong>Provar</strong> — o melhor candidato ficou com F1 = 1,000, igual ao baseline. O portão exige{" "}
              <em>ganho</em> (ΔF1 &gt; 0) e P ≥ 0,85.
            </li>
            <li>
              <strong>Publicar — REJECTED</strong> — decisão registrada:{" "}
              <em>“sem ganho de F1 (baseline=1.000, melhor=1.000)”</em> ou{" "}
              <em>“sem mutações registradas para esta regra”</em>. Nenhuma regra “quase boa” entrou no RuleSet.
            </li>
          </ol>
          <p>
            Em paralelo, o cenário de produto completa o ciclo: o time escreve dress code (“proibido{" "}
            <code>console.log</code> em produção”) → Genkit propõe regra → casos entram no corpus → se F1 subir com P ≥
            0,85, aí sim promove. O reject do evolve-all prova a metade crítica:{" "}
            <strong>o motor sabe dizer não</strong> — o que suites só-IA e releases opacos raramente mostram.
          </p>
        </div>
        <footer className="cr-scenario-foot">
          <a href="/docs/#aprendizado-continuo">Ver detalhe nas docs</a>
          <span aria-hidden>·</span>
          <a href="https://github.com/nbsjunior/codehero/blob/main/docs/wiki/Esteira-de-aprendizado-de-regras.md">
            Página wiki (markdown)
          </a>
        </footer>
      </article>
    </section>
  );
}
