"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Callout } from "@/components/AdminUi";
import {
  inviteOrgMember,
  listOrgMembers,
  removeOrgMember,
  setOrgMemberRole,
  type OrgInviteRow,
  type OrgMemberRow,
} from "@/lib/api";

export default function OrgMembersPanel({ orgId }: { orgId: string }) {
  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [invites, setInvites] = useState<OrgInviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listOrgMembers(orgId);
      setMembers(res.members);
      setInvites(res.invites);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar membros.");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    setLastInviteLink(null);
    try {
      const res = await inviteOrgMember({ orgId, email: email.trim(), role });
      const link = `${typeof window !== "undefined" ? window.location.origin : ""}/admin/?inviteOrg=${orgId}&inviteId=${res.inviteId}&token=${res.acceptToken}#instalacao`;
      setLastInviteLink(link);
      setMsg(`Convite criado para ${res.email}. Copie o link — ele só aparece uma vez.`);
      setEmail("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao convidar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hero-panel" style={{ padding: "1.25rem", marginTop: "1.25rem" }}>
      <h2 style={{ fontSize: "1.2rem", margin: "0 0 0.35rem" }}>Membros da org</h2>
      <p className="hero-caption" style={{ marginTop: 0 }}>
        Convites por email (owner/admin). O convidado precisa estar logado com o mesmo email.
      </p>

      <form onSubmit={onInvite} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
        <input
          className="hero-input"
          type="email"
          required
          placeholder="email@empresa.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <select className="hero-input" value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")}>
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit" className="hero-btn hero-btn-accent" disabled={busy}>
          {busy ? "Convidando…" : "Convidar"}
        </button>
      </form>

      {error && <div className="hero-error">{error}</div>}
      {msg && <Callout tone="ok">{msg}</Callout>}
      {lastInviteLink && (
        <pre className="hero-code" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {lastInviteLink}
        </pre>
      )}

      {loading ? (
        <p className="hero-caption">Carregando…</p>
      ) : (
        <>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.5rem" }}>
            {members.map((m) => (
              <li
                key={m.uid}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: "1px solid var(--line)",
                  paddingBottom: "0.5rem",
                }}
              >
                <div>
                  <strong>{m.displayName || m.email || m.uid}</strong>
                  <span className="hero-caption" style={{ display: "block", margin: 0 }}>
                    {m.email} · {m.role}
                  </span>
                </div>
                {m.role !== "owner" ? (
                  <div style={{ display: "flex", gap: "0.35rem" }}>
                    <button
                      type="button"
                      className="hero-btn hero-btn-outline"
                      style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
                      onClick={async () => {
                        try {
                          await setOrgMemberRole({
                            orgId,
                            memberUid: m.uid,
                            role: m.role === "admin" ? "member" : "admin",
                          });
                          await load();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Falha ao alterar role.");
                        }
                      }}
                    >
                      {m.role === "admin" ? "Tornar member" : "Tornar admin"}
                    </button>
                    <button
                      type="button"
                      className="hero-btn hero-btn-outline"
                      style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
                      onClick={async () => {
                        if (!window.confirm(`Remover ${m.email || m.uid}?`)) return;
                        try {
                          await removeOrgMember({ orgId, memberUid: m.uid });
                          await load();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Falha ao remover.");
                        }
                      }}
                    >
                      Remover
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {invites.length > 0 ? (
            <p className="hero-caption" style={{ marginTop: "1rem" }}>
              Pendentes: {invites.map((i) => `${i.email} (${i.role})`).join(", ")}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
