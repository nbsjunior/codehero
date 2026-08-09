"use client";

/**
 * Esteira animada — Scan → Gate → Correção → Esteira → (feedback) Scan.
 * Uma única instância na home, abaixo do descritivo do produto.
 */
const STEPS = [
  {
    id: "scan",
    label: "Scan",
    sub: "Nativo + suas ferramentas",
    out: "Uma lista só, sem repetidos",
  },
  {
    id: "gate",
    label: "Gate",
    sub: "Sem IA no juiz do merge",
    out: "Passa ou não passa",
  },
  {
    id: "fix",
    label: "Correção",
    sub: "SDD + agente; scanner prova",
    out: "Contrato verificável no PR",
  },
  {
    id: "learn",
    label: "Esteira",
    sub: "FP/FN viram evolução offline",
    out: "Regra ajustada com portão F1",
  },
] as const;

const EDGES: ReadonlyArray<{
  from: string;
  to: string;
  label: string;
  loop?: boolean;
}> = [
  { from: "Scan", to: "Gate", label: "os achados" },
  { from: "Gate", to: "Correção", label: "só o que passou" },
  { from: "Correção", to: "Esteira", label: "o que deu certo" },
  { from: "Esteira", to: "Scan", label: "regra melhor", loop: true },
];

export default function LandingFlow({ detailed = false }: { detailed?: boolean }) {
  const cls = ["lx-flow", detailed ? "lx-flow--detailed" : ""].filter(Boolean).join(" ");

  return (
    <div
      className={cls}
      role="img"
      aria-label="Fluxo CodeHero: Scan, Gate, Correção, Esteira, com feedback para o próximo scan"
    >
      <div className="lx-flow__track" aria-hidden="true">
        <div className="lx-flow__spine">
          <span className="lx-flow__packet" />
        </div>

        <ol className="lx-flow__rail">
          {STEPS.map((step, i) => (
            <li key={step.id} className={`lx-flow__node lx-flow__node--${i + 1}`}>
              <span className="lx-flow__pulse" />
              <span className="lx-flow__index">{String(i + 1).padStart(2, "0")}</span>
              <strong className="lx-flow__label">{step.label}</strong>
              <span className="lx-flow__sub">{step.sub}</span>
              {i < STEPS.length - 1 ? (
                <span className="lx-flow__edge">
                  <span className="lx-flow__edge-line" />
                  <span className="lx-flow__edge-label">{step.out}</span>
                </span>
              ) : (
                <span className="lx-flow__edge lx-flow__edge--loop">
                  <span className="lx-flow__edge-line" />
                  <span className="lx-flow__edge-label">{step.out} → Scan</span>
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>

      {detailed ? (
        <ul className="lx-flow__integrations">
          {EDGES.map((edge) => (
            <li key={`${edge.from}-${edge.to}`} className={edge.loop ? "is-loop" : undefined}>
              <span className="lx-flow__int-path">
                {edge.from}
                <span aria-hidden="true"> → </span>
                {edge.to}
              </span>
              <span className="lx-flow__int-label">{edge.label}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="lx-flow__caption">
        Cada seta é uma promessa: a etapa seguinte só usa o que a anterior entregou. E o que o time
        aprende volta para o começo, então o próximo scan já chega mais afiado.
      </p>
    </div>
  );
}
