"use client";
import { useMemo, useState, type FormEvent } from "react";
import { PageHeader, DataSection, Callout } from "@/components/AdminUi";
import { adminCreateProject, type AdminCreatedRepo, type AdminProjectRow } from "@/lib/api";

type Step = 1 | 2 | 3 | 4;

export default function WorkspaceWizard({
  projects,
  onOpenWorkspace,
}: {
  projects: AdminProjectRow[];
  onOpenWorkspace: (orgId: string, projectId: string, repoId?: string) => void;
}) {
  const orgs = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.orgId, p.orgName);
    return [...map.entries()].map(([orgId, orgName]) => ({ orgId, orgName }));
  }, [projects]);

  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<"new" | "existing">(orgs.length ? "existing" : "new");
  const [orgId, setOrgId] = useState(orgs[0]?.orgId ?? "");
  const [orgName, setOrgName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [repoUrls, setRepoUrls] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    orgId: string;
    projectId: string;
    slug: string;
    repos: AdminCreatedRepo[];
  } | null>(null);

  async function finish(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const urls = repoUrls.map((u) => u.trim()).filter(Boolean);
      const res = await adminCreateProject({
        orgId: mode === "existing" ? orgId : undefined,
        orgName: mode === "new" ? orgName.trim() : undefined,
        projectName: projectName.trim(),
        repoUrls: urls,
      });
      setCreated(res);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não consegui criar o workspace. Nada foi salvo — revise o nome e tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Projetos"
        title="Novo workspace"
        description="Organização, projeto e repositórios em quatro passos. Os tokens aparecem só no final, uma vez."
      />

      <ol className="hero-wizard-steps" aria-label="Passos">
        {[
          { n: 1, label: "Organização" },
          { n: 2, label: "Projeto" },
          { n: 3, label: "Repositórios" },
          { n: 4, label: "Tokens" },
        ].map((s) => (
          <li key={s.n} className={step === s.n ? "is-active" : step > s.n ? "is-done" : ""}>
            <span>{s.n}</span> {s.label}
          </li>
        ))}
      </ol>

      {error && <div className="hero-error" style={{ marginBottom: "1rem" }}>{error}</div>}

      {step === 1 && (
        <DataSection title="Organização" description="Onde o projeto vai viver">
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <label className="hero-radio-row">
              <input
                type="radio"
                checked={mode === "existing"}
                disabled={!orgs.length}
                onChange={() => setMode("existing")}
              />
              <span>Usar organização existente</span>
            </label>
            {mode === "existing" && (
              <select className="hero-input" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                {orgs.map((o) => (
                  <option key={o.orgId} value={o.orgId}>
                    {o.orgName}
                  </option>
                ))}
              </select>
            )}
            <label className="hero-radio-row">
              <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} />
              <span>Criar nova organização</span>
            </label>
            {mode === "new" && (
              <input
                className="hero-input"
                placeholder="Nome da organização"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
              />
            )}
            <button
              type="button"
              className="hero-btn hero-btn-accent"
              disabled={mode === "existing" ? !orgId : !orgName.trim()}
              onClick={() => setStep(2)}
            >
              Continuar
            </button>
          </div>
        </DataSection>
      )}

      {step === 2 && (
        <DataSection title="Projeto" description="Agrupa um ou mais repositórios sob a mesma configuração">
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <input
              className="hero-input"
              placeholder="Nome do projeto"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="button" className="hero-btn hero-btn-outline" onClick={() => setStep(1)}>
                Voltar
              </button>
              <button
                type="button"
                className="hero-btn hero-btn-accent"
                disabled={!projectName.trim()}
                onClick={() => setStep(3)}
              >
                Continuar
              </button>
            </div>
          </div>
        </DataSection>
      )}

      {step === 3 && (
        <DataSection title="Repositórios" description="URLs do GitHub. Dá para adicionar mais depois.">
          <form onSubmit={finish} style={{ display: "grid", gap: "0.75rem" }}>
            {repoUrls.map((url, i) => (
              <div key={i} style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  className="hero-input"
                  style={{ flex: 1 }}
                  placeholder="https://github.com/org/repo"
                  value={url}
                  onChange={(e) => {
                    const next = [...repoUrls];
                    next[i] = e.target.value;
                    setRepoUrls(next);
                  }}
                />
                {repoUrls.length > 1 && (
                  <button
                    type="button"
                    className="hero-btn hero-btn-outline"
                    aria-label={`Remover repositório ${i + 1}`}
                    onClick={() => setRepoUrls(repoUrls.filter((_, j) => j !== i))}
                  >
                    −
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="hero-btn hero-btn-outline" onClick={() => setRepoUrls([...repoUrls, ""])}>
              + Adicionar repositório
            </button>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="button" className="hero-btn hero-btn-outline" onClick={() => setStep(2)} disabled={busy}>
                Voltar
              </button>
              <button type="submit" className="hero-btn hero-btn-accent" disabled={busy}>
                {busy ? "Criando…" : "Criar workspace"}
              </button>
            </div>
          </form>
        </DataSection>
      )}

      {step === 4 && created && (
        <DataSection
          title="Copie os tokens antes de sair"
          description="Cada token aparece uma única vez. Se sair sem copiar, será preciso rotacionar o token do repositório para gerar outro."
        >
          <Callout tone="ok" title="Workspace criado">
            Projeto <code>{created.slug}</code> · {created.repos.length} repositório(s)
          </Callout>
          {created.repos.length === 0 ? (
            <p className="hero-caption">Nenhum repositório vinculado ainda. Adicione um no workspace.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
              {created.repos.map((r) => (
                <div key={r.repoId} className="hero-panel-sm" style={{ padding: "0.85rem 1rem" }}>
                  <strong>{r.name}</strong>
                  <p className="hero-caption" style={{ margin: "0.25rem 0" }}>
                    {r.repoUrl}
                  </p>
                  <code style={{ wordBreak: "break-all", fontSize: "0.8rem" }}>{r.ingestToken}</code>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1.25rem" }}>
            <button
              type="button"
              className="hero-btn hero-btn-accent"
              onClick={() =>
                onOpenWorkspace(created.orgId, created.projectId, created.repos[0]?.repoId)
              }
            >
              Abrir workspace
            </button>
            <button
              type="button"
              className="hero-btn hero-btn-outline"
              onClick={() => {
                setStep(1);
                setCreated(null);
                setProjectName("");
                setRepoUrls([""]);
              }}
            >
              Criar outro
            </button>
          </div>
        </DataSection>
      )}
    </>
  );
}
