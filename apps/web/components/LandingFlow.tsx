"use client";

/**
 * Fluxo animado — Scan → Gate → Correção → Esteira.
 * Plano visual dominante da home (sem cards).
 */
export default function LandingFlow({ compact = false }: { compact?: boolean }) {
  const steps = [
    { id: "scan", label: "Scan", sub: "Motores paralelos · SARIF" },
    { id: "gate", label: "Gate", sub: "Política · suppress auditável" },
    { id: "fix", label: "Correção", sub: "Agentes pós-gate · diff no PR" },
    { id: "learn", label: "Esteira", sub: "FP · custo · próximo ciclo" },
  ] as const;

  return (
    <div className={`lx-flow${compact ? " lx-flow--compact" : ""}`} aria-hidden="true">
      <div className="lx-flow__rail">
        {steps.map((step, i) => (
          <div key={step.id} className={`lx-flow__node lx-flow__node--${i + 1}`}>
            <span className="lx-flow__pulse" />
            <span className="lx-flow__index">{String(i + 1).padStart(2, "0")}</span>
            <strong className="lx-flow__label">{step.label}</strong>
            <span className="lx-flow__sub">{step.sub}</span>
            {i < steps.length - 1 ? <span className="lx-flow__connector" /> : null}
          </div>
        ))}
      </div>
      <p className="lx-flow__caption">
        Detecção → decisão → remediação → memória institucional — um contrato de gate para cloud e mainframe
      </p>
    </div>
  );
}
