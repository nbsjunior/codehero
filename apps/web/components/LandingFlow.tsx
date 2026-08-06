"use client";

/**
 * Esteira animada — Scan → Gate → Correção → Esteira → (feedback) Scan.
 * Mostra o payload que atravessa cada integração entre fases.
 */
const STEPS = [
  {
    id: "scan",
    label: "Scan",
    sub: "Motores paralelos · SARIF",
    out: "Findings normalizados",
  },
  {
    id: "gate",
    label: "Gate",
    sub: "Política · suppress auditável",
    out: "Veredito + escopo",
  },
  {
    id: "fix",
    label: "Correção",
    sub: "Agentes pós-gate · diff no PR",
    out: "Patch + telemetria",
  },
  {
    id: "learn",
    label: "Esteira",
    sub: "FP · custo · próximo ciclo",
    out: "Memória de regra",
  },
] as const;

const EDGES = [
  { from: "Scan", to: "Gate", label: "envelope SARIF" },
  { from: "Gate", to: "Correção", label: "só o que a política libera" },
  { from: "Correção", to: "Esteira", label: "qualidade · custo · FP" },
  { from: "Esteira", to: "Scan", label: "política atualizada", loop: true },
] as const;

export default function LandingFlow({
  compact = false,
  detailed = false,
}: {
  compact?: boolean;
  /** Mostra legendas de integração e loop de feedback (seção Fluxo). */
  detailed?: boolean;
}) {
  const cls = [
    "lx-flow",
    compact ? "lx-flow--compact" : "",
    detailed ? "lx-flow--detailed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} role="img" aria-label="Fluxo CodeHero: Scan, Gate, Correção, Esteira, com feedback para o próximo scan">
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
        {detailed
          ? "Cada seta é um contrato: o estágio seguinte só consome o que o anterior publicou. A Esteira devolve memória ao Scan — o loop fecha."
          : "Detecção → decisão → remediação → memória — feedback no próximo scan"}
      </p>
    </div>
  );
}
