type FichaLike = {
  risk: string;
  reason: string;
  howToFix: string;
  strategy?: string;
  constraints?: string[];
  referenceExample?: { before: string; after: string };
  cwe?: string[];
  effortMin?: number;
  ruleId?: string;
  ruleName?: string;
  severity?: string;
  file?: string;
  line?: number;
  snippet?: string;
};

/** Ficha do apontamento: risco, motivo e como corrigir. */
export default function FindingFichaCard({
  ficha,
  compact = false,
}: {
  ficha: FichaLike;
  compact?: boolean;
}) {
  return (
    <article className={`hero-ficha${compact ? " is-compact" : ""}`}>
      {(ficha.ruleName || ficha.ruleId) && (
        <header className="hero-ficha-head">
          <strong>{ficha.ruleName ?? ficha.ruleId}</strong>
          {ficha.severity ? <span className="hero-badge">{ficha.severity}</span> : null}
          {ficha.file != null && ficha.line != null ? (
            <span className="hero-caption">
              {ficha.file}:{ficha.line}
            </span>
          ) : null}
        </header>
      )}

      <div className="hero-ficha-block">
        <h4>Risco</h4>
        <p>{ficha.risk}</p>
      </div>
      <div className="hero-ficha-block">
        <h4>Motivo do apontamento</h4>
        <p>{ficha.reason}</p>
        {ficha.snippet ? (
          <pre className="hero-code" style={{ marginTop: "0.5rem", maxHeight: 120 }}>
            {ficha.snippet}
          </pre>
        ) : null}
      </div>
      <div className="hero-ficha-block">
        <h4>Como corrigir</h4>
        <p>{ficha.howToFix}</p>
        {ficha.referenceExample ? (
          <div className="hero-ficha-example">
            <div>
              <span className="hero-caption">Antes</span>
              <pre className="hero-code">{ficha.referenceExample.before}</pre>
            </div>
            <div>
              <span className="hero-caption">Depois</span>
              <pre className="hero-code">{ficha.referenceExample.after}</pre>
            </div>
          </div>
        ) : null}
        {ficha.constraints?.length ? (
          <ul className="hero-ficha-constraints">
            {ficha.constraints.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
