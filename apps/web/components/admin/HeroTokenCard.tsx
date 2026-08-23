"use client";

import CopyButton from "@/components/CopyButton";

/** Painel único de HERO_TOKEN — Action e MCP usam o mesmo bloco visual. */
export default function HeroTokenCard({
  hint,
  fullToken,
  ghCommand,
  rotating,
  rotateConfirm,
  rotateError,
  onRotate,
  onCancelConfirm,
  dense = false,
}: {
  hint: string;
  fullToken: string;
  ghCommand: string | null;
  rotating: boolean;
  rotateConfirm: boolean;
  rotateError: string | null;
  onRotate: () => void;
  onCancelConfirm: () => void;
  dense?: boolean;
}) {
  const masked = `••••••••${hint || fullToken.slice(-6) || "??????"}`;

  return (
    <aside className={`ex-cred${dense ? " ex-cred--dense" : ""}`} aria-labelledby="ex-cred-title">
      <div className="ex-cred__head">
        <div>
          <p className="ex-cred__eyebrow">Credencial do repositório</p>
          <h3 id="ex-cred-title" className="ex-cred__title">
            HERO_TOKEN
          </h3>
        </div>
        <code className="ex-cred__mask" title="Últimos dígitos do token">
          {masked}
        </code>
      </div>

      <p className="ex-cred__help">
        Secret da GitHub Action, do plugin e do MCP deste repo. Clique em{" "}
        <strong>Gerar novo token</strong> para ver o valor completo uma vez, copie e grave no GitHub.
        Não confundir com <code>HARNESS_TOKEN</code> (RoqueOS).
      </p>

      <div className="ex-cred__actions">
        {fullToken ? <CopyButton text={fullToken} label="Copiar token" /> : null}
        <button
          type="button"
          className={`hero-btn${rotateConfirm ? " hero-btn-accent" : " hero-btn-outline"}`}
          onClick={onRotate}
          disabled={rotating}
        >
          {rotating ? "Gerando…" : rotateConfirm ? "Confirmar novo token" : "Gerar novo token"}
        </button>
        {rotateConfirm && !rotating ? (
          <button type="button" className="ex-cred__cancel" onClick={onCancelConfirm}>
            Cancelar
          </button>
        ) : null}
        {!fullToken ? (
          <span className="ex-cred__hint">O valor completo só aparece depois de gerar.</span>
        ) : null}
      </div>

      {fullToken && ghCommand ? (
        <div className="ex-cred__gh">
          <p className="ex-cred__gh-label">Atualizar o secret no GitHub</p>
          <div className="hero-copyrow">
            <pre className="hero-code" style={{ maxHeight: 72 }}>
              {ghCommand}
            </pre>
            <CopyButton text={ghCommand} label="Copiar comando" />
          </div>
        </div>
      ) : null}

      {rotateError ? (
        <div className="hero-error" style={{ marginTop: "0.75rem" }}>
          {rotateError}
        </div>
      ) : null}
    </aside>
  );
}
