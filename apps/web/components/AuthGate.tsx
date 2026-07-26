"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  type AuthError,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/useAuth";

type Mode = "login" | "signup" | "forgot";

function translateAuthError(err: unknown): string {
  const code = (err as AuthError)?.code ?? "";
  const map: Record<string, string> = {
    "auth/invalid-email": "Email inválido.",
    "auth/user-not-found": "Não existe conta com esse email.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/invalid-credential": "Email ou senha incorretos.",
    "auth/email-already-in-use": "Já existe uma conta com esse email — tente entrar.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um momento e tente de novo.",
  };
  return map[code] ?? "Algo deu errado. Tente novamente.";
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (loading) return <FullPageSplash>Carregando…</FullPageSplash>;
  if (user) return <>{children}</>;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else if (mode === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await sendPasswordResetEmail(auth, email);
        setNotice("Se existir uma conta com esse email, enviamos um link para redefinir a senha.");
      }
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setBusy(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="hero-shell" style={{ display: "flex", justifyContent: "center", paddingTop: "3.5rem" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <span className="hero-burst" style={{ marginBottom: "0.75rem" }}>
            ⚡
          </span>
          <h1 className="hero-display" style={{ fontSize: "3rem", margin: "0.5rem 0 0.25rem" }}>
            CodeHero
          </h1>
          <p className="hero-caption">todo herói de código precisa de um QG</p>
        </div>

        <div className="hero-panel" style={{ padding: "1.75rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
            <TabButton active={mode === "login"} onClick={() => setMode("login")}>
              Entrar
            </TabButton>
            <TabButton active={mode === "signup"} onClick={() => setMode("signup")}>
              Criar conta
            </TabButton>
          </div>

          {mode === "forgot" ? (
            <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: 0 }}>
              Informe seu email — enviaremos um link para redefinir a senha.
            </p>
          ) : null}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: "1rem" }}>
              <label className="hero-label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                className="hero-input"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {mode !== "forgot" && (
              <div style={{ marginBottom: "1.25rem" }}>
                <label className="hero-label" htmlFor="password">
                  Senha
                </label>
                <input
                  id="password"
                  className="hero-input"
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}

            {error && (
              <div className="hero-error" style={{ marginBottom: "1rem" }}>
                {error}
              </div>
            )}
            {notice && (
              <div className="hero-badge" style={{ marginBottom: "1rem", display: "block" }}>
                {notice}
              </div>
            )}

            <button type="submit" className="hero-btn hero-btn-accent hero-btn-block" disabled={busy}>
              {busy
                ? "Um instante…"
                : mode === "signup"
                  ? "Criar minha conta"
                  : mode === "forgot"
                    ? "Enviar link"
                    : "Entrar"}
            </button>
          </form>

          {mode === "login" && (
            <button
              type="button"
              onClick={() => setMode("forgot")}
              className="hero-link"
              style={{ background: "none", border: "none", padding: 0, marginTop: "0.9rem", fontSize: "0.8rem", cursor: "pointer" }}
            >
              Esqueci minha senha
            </button>
          )}
          {mode === "forgot" && (
            <button
              type="button"
              onClick={() => setMode("login")}
              className="hero-link"
              style={{ background: "none", border: "none", padding: 0, marginTop: "0.9rem", fontSize: "0.8rem", cursor: "pointer" }}
            >
              Voltar para o login
            </button>
          )}

          <hr className="hero-divider" style={{ margin: "1.5rem 0" }} />

          <button type="button" onClick={handleGoogle} className="hero-btn hero-btn-outline hero-btn-block" disabled={busy}>
            Continuar com Google
          </button>
        </div>
      </div>
    </main>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hero-btn"
      style={{
        flex: 1,
        background: active ? "var(--ink)" : "transparent",
        color: active ? "var(--paper)" : "var(--ink)",
        boxShadow: active ? "var(--shadow-hard-sm)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function FullPageSplash({ children }: { children: ReactNode }) {
  return (
    <main
      className="hero-shell"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}
    >
      <span className="hero-caption">{children}</span>
    </main>
  );
}
