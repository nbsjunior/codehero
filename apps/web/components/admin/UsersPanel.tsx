"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Callout, DataSection, PageHeader } from "@/components/AdminUi";
import {
  adminListUsers,
  adminResetUserPassword,
  adminSetPlatformAdmin,
  adminUpdateUser,
  type PlatformUserRow,
} from "@/lib/api";
import { useAuth } from "@/lib/useAuth";

export default function UsersPanel() {
  const { user } = useAuth();
  const [users, setUsers] = useState<PlatformUserRow[]>([]);
  const [pageToken, setPageToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlatformUserRow | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetLink, setResetLink] = useState<string | null>(null);

  const load = useCallback(async (token?: string | null, append = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminListUsers({ pageToken: token ?? undefined, pageSize: 50 });
      setUsers((prev) => (append ? [...prev, ...res.users] : res.users));
      setPageToken(res.pageToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao listar usuários.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(u: PlatformUserRow) {
    setSelected(u);
    setDisplayName(u.displayName ?? "");
    setEmail(u.email ?? "");
    setNewPassword("");
    setResetLink(null);
    setMsg(null);
    setError(null);
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const updated = await adminUpdateUser({
        targetUid: selected.uid,
        displayName,
        email,
      });
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === selected.uid
            ? { ...u, displayName: updated.displayName, email: updated.email, disabled: updated.disabled }
            : u,
        ),
      );
      setSelected((s) =>
        s ? { ...s, displayName: updated.displayName, email: updated.email, disabled: updated.disabled } : s,
      );
      setMsg("Dados atualizados.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAdmin(u: PlatformUserRow) {
    const next = !u.isPlatformAdmin;
    if (!window.confirm(next ? `Tornar ${u.email ?? u.uid} admin da plataforma?` : `Remover admin de ${u.email ?? u.uid}?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await adminSetPlatformAdmin({ targetUid: u.uid, isAdmin: next });
      setUsers((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, isPlatformAdmin: next } : x)));
      if (selected?.uid === u.uid) setSelected({ ...u, isPlatformAdmin: next });
      setMsg(next ? "Perfil de admin concedido." : "Perfil de admin removido.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao alterar admin.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDisabled(u: PlatformUserRow) {
    const next = !u.disabled;
    if (!window.confirm(next ? `Desativar ${u.email ?? u.uid}?` : `Reativar ${u.email ?? u.uid}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await adminUpdateUser({ targetUid: u.uid, disabled: next });
      setUsers((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, disabled: updated.disabled } : x)));
      if (selected?.uid === u.uid) setSelected({ ...u, disabled: updated.disabled });
      setMsg(next ? "Conta desativada." : "Conta reativada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(opts: { setNew?: boolean; link?: boolean }) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    setResetLink(null);
    try {
      const res = await adminResetUserPassword({
        targetUid: selected.uid,
        newPassword: opts.setNew ? newPassword : undefined,
        generateResetLink: opts.link,
      });
      if (res.passwordUpdated) {
        setMsg("Senha redefinida.");
        setNewPassword("");
      }
      if (res.resetLink) {
        setResetLink(res.resetLink);
        setMsg((m) => (m ? `${m} Link gerado abaixo.` : "Link de redefinição gerado."));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao redefinir senha.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Usuários"
        title="Usuários da plataforma"
        description="Contas Auth · perfil de admin · dados e senha"
      />
      {error && <div className="hero-error">{error}</div>}
      {msg && <Callout tone="ok">{msg}</Callout>}

      <DataSection title={`${users.length} usuário(s)`} flush>
        {loading && users.length === 0 ? (
          <p className="hero-caption">Carregando…</p>
        ) : users.length === 0 ? (
          <p className="hero-caption">Nenhum usuário encontrado.</p>
        ) : (
          <div className="hero-panel" style={{ overflowX: "auto" }}>
            <table className="hero-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Email</th>
                  <th>Admin</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.uid} style={{ background: selected?.uid === u.uid ? "color-mix(in srgb, var(--accent) 8%, transparent)" : undefined }}>
                    <td style={{ fontWeight: 650 }}>{u.displayName || "—"}</td>
                    <td>{u.email || u.uid}</td>
                    <td>
                      <span className="hero-badge" style={u.isPlatformAdmin ? { background: "var(--accent)", color: "#fff" } : undefined}>
                        {u.isPlatformAdmin ? "Admin" : "Membro"}
                      </span>
                    </td>
                    <td>{u.disabled ? "Desativado" : "Ativo"}</td>
                    <td>
                      <button
                        type="button"
                        className="hero-btn hero-btn-outline"
                        style={{ padding: "0.3rem 0.65rem", fontSize: "0.75rem" }}
                        onClick={() => openEdit(u)}
                      >
                        Gerir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pageToken && (
          <button type="button" className="hero-btn hero-btn-outline" style={{ marginTop: "0.75rem" }} disabled={loading} onClick={() => void load(pageToken, true)}>
            Carregar mais
          </button>
        )}
      </DataSection>

      {selected && (
        <DataSection title={`Editar · ${selected.email ?? selected.uid}`}>
          <form onSubmit={saveProfile} style={{ display: "grid", gap: "0.75rem", maxWidth: 480 }}>
            <label style={{ display: "grid", gap: "0.3rem" }}>
              <span className="hero-label">Nome</span>
              <input className="hero-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: "0.3rem" }}>
              <span className="hero-label">Email</span>
              <input className="hero-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <p className="hero-caption">UID: {selected.uid}</p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="submit" className="hero-btn hero-btn-accent" disabled={busy}>
                Salvar dados
              </button>
              <button type="button" className="hero-btn" disabled={busy || selected.uid === user?.uid} onClick={() => void toggleAdmin(selected)}>
                {selected.isPlatformAdmin ? "Remover admin" : "Tornar admin"}
              </button>
              <button type="button" className="hero-btn hero-btn-outline" disabled={busy || selected.uid === user?.uid} onClick={() => void toggleDisabled(selected)}>
                {selected.disabled ? "Reativar" : "Desativar"}
              </button>
            </div>
          </form>

          <hr className="hero-divider" />

          <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Redefinir senha</h3>
          <div style={{ display: "grid", gap: "0.75rem", maxWidth: 480 }}>
            <label style={{ display: "grid", gap: "0.3rem" }}>
              <span className="hero-label">Nova senha (mín. 6)</span>
              <input
                className="hero-input"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
              />
            </label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="hero-btn hero-btn-accent"
                disabled={busy || newPassword.length < 6}
                onClick={() => void resetPassword({ setNew: true })}
              >
                Definir senha
              </button>
              <button type="button" className="hero-btn hero-btn-outline" disabled={busy} onClick={() => void resetPassword({ link: true })}>
                Gerar link de reset
              </button>
            </div>
            {resetLink && (
              <Callout tone="warn" title="Link (copie e envie ao usuário)">
                <code style={{ wordBreak: "break-all", fontSize: "0.78rem" }}>{resetLink}</code>
              </Callout>
            )}
          </div>
        </DataSection>
      )}
    </>
  );
}
