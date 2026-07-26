"use client";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, type User } from "firebase/auth";
import { collectionGroup, getDocs, query, where } from "firebase/firestore";
import { auth, dbClient } from "@/lib/firebase";

interface ProjectRow {
  id: string;
  name: string;
  debtMinutes: number;
  maintainabilityRating: string;
  securityRating: string;
  qualityGateStatus: string;
  openIssues: number;
}

const ratingColor: Record<string, string> = {
  A: "#22c55e",
  B: "#84cc16",
  C: "#eab308",
  D: "#f97316",
  E: "#ef4444",
};

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    // Requires the user to be a member of the owning org (enforced by rules).
    getDocs(query(collectionGroup(dbClient, "projects")))
      .then((snap) => setProjects(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProjectRow, "id">) }))))
      .finally(() => setLoading(false));
  }, [user]);

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.25rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>🛡️ CodeHero</h1>
        {user ? (
          <button onClick={() => signOut(auth)} style={btn}>
            Sair ({user.displayName ?? user.email})
          </button>
        ) : (
          <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} style={btn}>
            Entrar com Google
          </button>
        )}
      </header>

      {!user && <p style={{ opacity: 0.7 }}>Faça login para ver seus projetos.</p>}

      {user && loading && <p>Carregando…</p>}

      {user && !loading && projects.length === 0 && (
        <p style={{ opacity: 0.7 }}>Nenhum projeto ainda. Provisione um via a função <code>provisionProject</code>.</p>
      )}

      {projects.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1.5rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #1f2937" }}>
              <th style={th}>Projeto</th>
              <th style={th}>Gate</th>
              <th style={th}>Segurança</th>
              <th style={th}>Manutenib.</th>
              <th style={th}>Débito</th>
              <th style={th}>Issues</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid #111827" }}>
                <td style={td}>{p.name}</td>
                <td style={{ ...td, color: p.qualityGateStatus === "PASSED" ? "#22c55e" : "#ef4444" }}>
                  {p.qualityGateStatus}
                </td>
                <td style={td}>
                  <span style={badge(ratingColor[p.securityRating])}>{p.securityRating}</span>
                </td>
                <td style={td}>
                  <span style={badge(ratingColor[p.maintainabilityRating])}>{p.maintainabilityRating}</span>
                </td>
                <td style={td}>{Math.round((p.debtMinutes ?? 0) / 60)}h</td>
                <td style={td}>{p.openIssues ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

const btn: React.CSSProperties = {
  background: "#2563eb",
  color: "white",
  border: 0,
  borderRadius: 8,
  padding: "0.5rem 0.9rem",
  cursor: "pointer",
};
const th: React.CSSProperties = { padding: "0.5rem 0.75rem", fontWeight: 600, fontSize: "0.85rem", opacity: 0.8 };
const td: React.CSSProperties = { padding: "0.6rem 0.75rem", fontSize: "0.9rem" };
function badge(color?: string): React.CSSProperties {
  return { background: color ?? "#374151", color: "#0b1120", fontWeight: 700, borderRadius: 6, padding: "2px 8px" };
}
