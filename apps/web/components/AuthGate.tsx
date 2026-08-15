"use client";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithCustomToken,
  sendPasswordResetEmail,
  sendEmailVerification,
  GoogleAuthProvider,
  type AuthError,
} from "firebase/auth";
import type { FunctionsError } from "firebase/functions";
import { auth } from "@/lib/firebaseCore";
import { useAuth } from "@/lib/useAuth";
import LandingComic from "@/components/LandingComic";

type Mode = "login" | "signup" | "forgot";

function extractErrorCode(err: unknown): string {
  const direct =
    (err as AuthError)?.code ??
    (err as FunctionsError)?.code ??
    (err as { customData?: { code?: string } })?.customData?.code ??
    "";
  if (direct) return direct;
  const message = (err as Error)?.message ?? "";
  const fromMsg = message.match(/\((auth\/[\w.-]+)\)/)?.[1] ?? message.match(/(functions\/[\w-]+)/)?.[1];
  return fromMsg ?? "";
}

function translateAuthError(err: unknown): string {
  const code = extractErrorCode(err);
  const message = (err as Error)?.message ?? "";
  const map: Record<string, string> = {
    "auth/invalid-email": "Email inválido.",
    "auth/user-not-found": "Não existe conta com esse email.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/invalid-credential": "Email ou senha incorretos.",
    "auth/invalid-login-credentials": "Email ou senha incorretos.",
    "auth/email-already-in-use": "Já existe uma conta com esse email — tente entrar.",
    "auth/weak-password": "A senha precisa ter pelo menos 8 caracteres.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um momento e tente de novo.",
    "auth/operation-not-allowed":
      "Cadastro por email está desativado nesta plataforma. Use Criar conta ou Google.",
    "auth/unauthorized-domain": "Este domínio não está autorizado na autenticação da plataforma.",
    "auth/network-request-failed":
      "Falha de rede ao autenticar. Verifique a conexão e tente novamente em instantes.",
    "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
      "Configuração de autenticação inválida para este domínio. Contate o administrador da plataforma.",
    "already-exists": "Já existe uma conta com esse email — use Entrar.",
    "invalid-argument": message || "Dados inválidos.",
    unauthenticated: "Email ou senha incorretos.",
    "functions/already-exists": "Já existe uma conta com esse email — use Entrar.",
    "functions/invalid-argument": message.replace(/^.*?:\s*/, "") || "Dados inválidos.",
    "functions/unauthenticated": "Email ou senha incorretos.",
    "functions/internal": "Não foi possível concluir. Tente de novo em instantes.",
  };
  if (map[code]) return map[code];
  if (/referer|referrer|API_KEY_HTTP_REFERRER/i.test(message)) {
    return "Este domínio não está autorizado na autenticação da plataforma.";
  }
  if (message && !message.startsWith("Firebase:")) return message;
  if (code) return `Falha de autenticação (${code}).`;
  return "Algo deu errado. Tente novamente.";
}

async function registerViaPortal(email: string, password: string): Promise<void> {
  const [{ httpsCallable }, { functions }] = await Promise.all([
    import("firebase/functions"),
    import("@/lib/firebaseFunctions"),
  ]);
  const fn = httpsCallable<{ email: string; password: string }, { customToken: string }>(
    functions,
    "registerAccount",
  );
  const res = await fn({ email, password });
  await signInWithCustomToken(auth, res.data.customToken);
  await sendVerificationBestEffort();
}

/** Fire-and-forget — a failure here shouldn't block sign-in; the AppShell banner offers a resend. */
async function sendVerificationBestEffort(): Promise<void> {
  try {
    if (auth.currentUser && !auth.currentUser.emailVerified) {
      await sendEmailVerification(auth.currentUser);
    }
  } catch {
    /* ignore — user can resend from the post-login banner */
  }
}

export default function AuthGate({
  children,
  landingDurantePreload = false,
}: {
  children: ReactNode;
  /**
   * Mostra a landing ENQUANTO o estado de login carrega, em vez da tela de
   * espera.
   *
   * Existe por um defeito medido em producao: como o site e exportado
   * estatico, o servidor nao sabe se ha sessao, entao o HTML publicado
   * continha apenas a palavra "Carregando". A landing so aparecia depois do
   * JavaScript rodar. Em carga lenta a pagina parecia vazia, e o Google
   * indexava uma pagina sem conteudo, o que anulava o trabalho de SEO.
   *
   * Na home isso vem ligado: quem chega deslogado e a maioria, e a landing
   * nao depende de sessao para nada. No painel fica desligado, senao a
   * landing piscaria antes do conteudo de quem ja esta logado.
   */
  landingDurantePreload?: boolean;
}) {
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    function onResize() {
      if (window.matchMedia("(min-width: 881px)").matches) setNavOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [navOpen]);

  if (loading && !landingDurantePreload) return <FullPageSplash>Carregando…</FullPageSplash>;
  if (user && !loading) return <>{children}</>;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        try {
          await registerViaPortal(email.trim(), password);
        } catch (portalErr) {
          const code = (portalErr as FunctionsError)?.code ?? "";
          if (code === "functions/not-found" || code === "functions/unavailable") {
            await createUserWithEmailAndPassword(auth, email.trim(), password);
            await sendVerificationBestEffort();
          } else {
            throw portalErr;
          }
        }
      } else if (mode === "login") {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await sendPasswordResetEmail(auth, email.trim());
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

  function goAuth(next: Mode) {
    setMode(next);
    setError(null);
    setNavOpen(false);
    requestAnimationFrame(() => {
      document.getElementById("auth")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <div className="lx-page" id="top">
      <header className="lx-nav">
        <a className="lx-nav-brand" href="#top" onClick={() => setNavOpen(false)}>
          <span className="lx-nav-mark" aria-hidden>
            H
          </span>
          <span className="lx-nav-name">CodeHero</span>
        </a>

        <button
          type="button"
          className="lx-nav-toggle"
          aria-expanded={navOpen}
          aria-controls="lx-nav-menu"
          aria-label={navOpen ? "Fechar menu" : "Abrir menu"}
          onClick={() => setNavOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>

        <nav id="lx-nav-menu" className={`lx-nav-links${navOpen ? " is-open" : ""}`} aria-label="Principal">
          <a href="#historia" onClick={() => setNavOpen(false)}>
            Como funciona
          </a>
          <a href="#limites" onClick={() => setNavOpen(false)}>
            Onde ela vai
          </a>
          <a href="/docs" onClick={() => setNavOpen(false)}>
            Docs
          </a>
          <button type="button" className="lx-nav-cta" onClick={() => goAuth("login")}>
            Entrar
          </button>
          <button
            type="button"
            className="lx-nav-cta lx-nav-cta--primary"
            onClick={() => goAuth("signup")}
          >
            Começar grátis
          </button>
        </nav>
      </header>

      <main>
        <LandingComic onSignup={() => goAuth("signup")} onLogin={() => goAuth("login")} />

        <section className="lx-auth" id="auth" aria-labelledby="auth-title">
          <div className="lx-auth-panel">
            <div className="lx-auth-tabs" role="tablist" aria-label="Autenticação">
              <TabButton active={mode === "login"} onClick={() => setMode("login")}>
                Entrar
              </TabButton>
              <TabButton active={mode === "signup"} onClick={() => setMode("signup")}>
                Começar grátis
              </TabButton>
              <TabButton active={mode === "forgot"} onClick={() => setMode("forgot")}>
                Recuperar
              </TabButton>
            </div>

            <h2 id="auth-title" className="lx-auth-title">
              {mode === "login" && "Acesso à plataforma"}
              {mode === "signup" && "Começar no CodeHero — grátis"}
              {mode === "forgot" && "Recuperar senha"}
            </h2>
            <p className="lx-auth-sub">
              {mode === "forgot"
                ? "Enviamos um link de redefinição se o email existir na base."
                : mode === "signup"
                  ? "Grátis. Sem cartão. Open source (Apache-2.0). Google SSO disponível."
                  : "Email corporativo. Google SSO disponível."}
            </p>

            <form onSubmit={handleSubmit} className="lx-auth-form">
              <label className="lx-field">
                <span>Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="você@empresa.com"
                />
              </label>

              {mode !== "forgot" && (
                <label className="lx-field">
                  <span>Senha</span>
                  <input
                    type="password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="mín. 8 caracteres"
                  />
                </label>
              )}

              {error && (
                <p className="lx-banner lx-banner-error" role="alert">
                  {error}
                </p>
              )}
              {notice && (
                <p className="lx-banner lx-banner-ok" role="status">
                  {notice}
                </p>
              )}

              <button type="submit" className="lx-btn lx-btn-primary lx-btn-block" disabled={busy}>
                {busy
                  ? "Aguarde…"
                  : mode === "login"
                    ? "Entrar"
                    : mode === "signup"
                      ? "Começar grátis"
                      : "Enviar link"}
              </button>
            </form>

            {mode !== "forgot" && (
              <>
                <div className="lx-auth-divider">
                  <span>ou</span>
                </div>
                <button
                  type="button"
                  className="lx-btn lx-btn-ghost lx-btn-block"
                  onClick={handleGoogle}
                  disabled={busy}
                >
                  Continuar com Google
                </button>
              </>
            )}
          </div>
        </section>
      </main>

      <footer className="lx-footer">
        <span>CodeHero</span>
        <span className="lx-footer-sep" aria-hidden>
          ·
        </span>
        <a href="/docs">Documentação</a>
        <span className="lx-footer-sep" aria-hidden>
          ·
        </span>
        <a href="https://github.com/nsborges/CodeHero" rel="noopener noreferrer" target="_blank">
          GitHub
        </a>
      </footer>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`lx-tab${active ? " is-active" : ""}`}>
      {children}
    </button>
  );
}

function FullPageSplash({ children }: { children: ReactNode }) {
  return (
    <div className="lx-page lx-splash">
      <span className="lx-kicker">{children}</span>
    </div>
  );
}
