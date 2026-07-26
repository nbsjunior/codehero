"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithCustomToken,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  type AuthError,
} from "firebase/auth";
import { httpsCallable, type FunctionsError } from "firebase/functions";
import { auth, functions } from "@/lib/firebase";
import { useAuth } from "@/lib/useAuth";

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
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um momento e tente de novo.",
    "auth/operation-not-allowed":
      "Cadastro por email está desativado neste projeto Firebase. Use Criar conta ou Google.",
    "auth/unauthorized-domain": "Este domínio não está autorizado no Firebase Auth.",
    "auth/network-request-failed": "Falha de rede. Verifique sua conexão e tente de novo.",
    "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
      "Este domínio não está autorizado na API key do Firebase. Peça para liberar codehero.web.app.",
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
    return "Este domínio não está autorizado na API key do Firebase (codehero.web.app).";
  }
  if (message && !message.startsWith("Firebase:")) return message;
  if (code) return `Falha de autenticação (${code}).`;
  return "Algo deu errado. Tente novamente.";
}

async function registerViaPortal(email: string, password: string): Promise<void> {
  const fn = httpsCallable<{ email: string; password: string }, { customToken: string }>(
    functions,
    "registerAccount",
  );
  const res = await fn({ email, password });
  await signInWithCustomToken(auth, res.data.customToken);
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  if (loading) return <FullPageSplash>Carregando…</FullPageSplash>;
  if (user) return <>{children}</>;

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
    <div className="cr-page">
      <header className="cr-nav">
        <a className="cr-nav-brand" href="#top" onClick={() => setNavOpen(false)}>
          <span className="cr-nav-mark" aria-hidden>
            H
          </span>
          <span className="cr-nav-name">CodeHero</span>
        </a>

        <button
          type="button"
          className="cr-nav-toggle"
          aria-expanded={navOpen}
          aria-controls="cr-nav-menu"
          onClick={() => setNavOpen((v) => !v)}
        >
          <span className="cr-sr-only">Menu</span>
          <span aria-hidden>{navOpen ? "✕" : "☰"}</span>
        </button>

        <nav id="cr-nav-menu" className={`cr-nav-links${navOpen ? " is-open" : ""}`}>
          <a href="#poderes" onClick={() => setNavOpen(false)}>
            Poderes
          </a>
          <a href="#missao" onClick={() => setNavOpen(false)}>
            Missão
          </a>
          <a href="#como" onClick={() => setNavOpen(false)}>
            Como funciona
          </a>
          <button type="button" className="cr-btn cr-btn-ghost" onClick={() => goAuth("login")}>
            Entrar
          </button>
          <button type="button" className="cr-btn cr-btn-primary" onClick={() => goAuth("signup")}>
            Começar grátis
          </button>
        </nav>
      </header>

      <main id="top">
        <section className="cr-hero">
          <div className="cr-hero-copy cr-rise">
            <p className="cr-eyebrow">gratuito · agêntico + determinístico</p>
            <h1 className="cr-brand">CodeHero</h1>
            <p className="cr-headline">
              Corte bugs e dívida técnica pela metade.
              <span className="cr-headline-accent"> Seja o herói do PR.</span>
            </p>
            <p className="cr-subhead">
              Escreva o dress code do time em português. A IA propõe as regras — o scanner determinístico aplica em
              cada arquivo, sem alucinar no caminho crítico.
            </p>
            <div className="cr-cta-row">
              <button type="button" className="cr-btn cr-btn-primary cr-btn-lg" onClick={() => goAuth("signup")}>
                Começar grátis
              </button>
              <button type="button" className="cr-btn cr-btn-secondary cr-btn-lg" onClick={() => goAuth("login")}>
                Já tenho conta
              </button>
            </div>
          </div>

          <div className="cr-hero-visual cr-float" aria-hidden>
            <div className="cr-panel-mock">
              <div className="cr-panel-bar">
                <span />
                <span />
                <span />
                <em>codehero · missao #4821</em>
              </div>
              <div className="cr-panel-body">
                <p className="cr-panel-title">Herói detectou 3 ameaças</p>
                <ul className="cr-findings">
                  <li>
                    <strong>CWE-79</strong> XSS refletido em <code>renderComment</code>
                  </li>
                  <li>
                    <strong>Dress code</strong> `console.log` em produção
                  </li>
                  <li>
                    <strong>CWE-338</strong> `Math.random` usado como token
                  </li>
                </ul>
                <div className="cr-panel-footer">
                  <span className="cr-chip">QG: falhou</span>
                  <span className="cr-chip cr-chip-ok">motor: determinístico</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="cr-trust">
          <p>Feito para times que querem velocidade de herói — com prova, não vibe.</p>
        </section>

        <section id="poderes" className="cr-section">
          <div className="cr-section-head">
            <h2>Por que times escolhem o CodeHero</h2>
            <p>IA no planejamento. Precisão de scanner na execução. Você no comando.</p>
          </div>
          <div className="cr-feature-grid">
            <article className="cr-feature">
              <h3>Dress code em português</h3>
              <p>
                “Sem console.log em prod”, “sem Math.random em token”. Genkit interpreta a política; o motor aplica
                como regra auditável.
              </p>
            </article>
            <article className="cr-feature">
              <h3>Zero IA no caminho crítico</h3>
              <p>
                Cada arquivo passa por padrão, AST e dataflow. Rápido no CI, repetível e sem surpresa de modelo.
              </p>
            </article>
            <article className="cr-feature">
              <h3>One-click de herói</h3>
              <p>Plugin VS Code/Cursor, prévia no Firebase, regras por repo ou para toda a plataforma — sem labirinto.</p>
            </article>
          </div>
        </section>

        <section id="missao" className="cr-section cr-section-alt">
          <div className="cr-section-head">
            <h2>Diferente do mercado</h2>
            <p>Mais leve que Sonar. Mais honesto que scanner só de IA.</p>
          </div>
          <div className="cr-compare">
            <div>
              <h3>Vs Sonar / CodeQL / Coverity</h3>
              <p>
                Potentes, caros e pesados. CodeHero é gratuito, focado em dress code + segurança no fluxo do
                desenvolvedor.
              </p>
            </div>
            <div>
              <h3>Vs scanners só de IA</h3>
              <p>
                Achados bonitos, falso positivo demais. Aqui a IA propõe; o corpus e o motor determinístico decidem o
                que entra em produção.
              </p>
            </div>
            <div>
              <h3>Vs linters soltos</h3>
              <p>ESLint não é política de plataforma. CodeHero une portal, plugin, runner e evolução agêntica num QG.</p>
            </div>
          </div>
        </section>

        <section id="como" className="cr-section">
          <div className="cr-section-head">
            <h2>Três passos para engajar o time</h2>
            <p>Do zero ao primeiro relatório — sem setup de herói cansado.</p>
          </div>
          <ol className="cr-steps">
            <li>
              <span>01</span>
              <div>
                <strong>Crie a conta</strong>
                <p>Escreva o dress code uma vez, em linguagem natural.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Instale o plugin</strong>
                <p>Baixe o VSIX no portal e proteja o editor com um clique.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Rode a prévia</strong>
                <p>Cole o GitHub público e mostre o relatório antes do PR.</p>
              </div>
            </li>
          </ol>
        </section>

        <section id="auth" className="cr-section cr-auth-section">
          <div className="cr-auth-layout">
            <div className="cr-auth-pitch">
              <p className="cr-eyebrow">missão aceita</p>
              <h2>Entre no portal. Vista a capa.</h2>
              <p>
                Conta gratuita em segundos. Depois: dress code, plugin e prévia Firebase — o time vê o herói em ação.
              </p>
            </div>

            <div className="cr-auth-card">
              <div className="cr-tabs">
                <TabButton
                  active={mode === "login"}
                  onClick={() => {
                    setMode("login");
                    setError(null);
                  }}
                >
                  Entrar
                </TabButton>
                <TabButton
                  active={mode === "signup"}
                  onClick={() => {
                    setMode("signup");
                    setError(null);
                  }}
                >
                  Criar conta
                </TabButton>
              </div>

              {mode === "forgot" ? (
                <p className="cr-auth-hint">Informe seu email — enviaremos um link para redefinir a senha.</p>
              ) : (
                <p className="cr-auth-hint">
                  {mode === "signup" ? "Conta grátis · ~30 segundos" : "Bem-vindo de volta, herói."}
                </p>
              )}

              <form onSubmit={handleSubmit} className="cr-form">
                <div>
                  <label className="cr-label" htmlFor="email">
                    Email
                  </label>
                  <input
                    id="email"
                    className="cr-input"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                {mode !== "forgot" && (
                  <div>
                    <label className="cr-label" htmlFor="password">
                      Senha
                    </label>
                    <input
                      id="password"
                      className="cr-input"
                      type="password"
                      required
                      minLength={6}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                )}

                {error && <div className="cr-error">{error}</div>}
                {notice && <div className="cr-notice">{notice}</div>}

                <button type="submit" className="cr-btn cr-btn-primary cr-btn-block" disabled={busy}>
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
                <button type="button" className="cr-text-btn" onClick={() => setMode("forgot")}>
                  Esqueci minha senha
                </button>
              )}
              {mode === "forgot" && (
                <button type="button" className="cr-text-btn" onClick={() => setMode("login")}>
                  Voltar para o login
                </button>
              )}

              <div className="cr-auth-or">ou</div>

              <button type="button" className="cr-btn cr-btn-secondary cr-btn-block" disabled={busy} onClick={handleGoogle}>
                Continuar com Google
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="cr-footer">
        <span className="cr-nav-name">CodeHero</span>
        <span>Dress code gratuito · motor determinístico</span>
      </footer>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`cr-tab${active ? " is-active" : ""}`}>
      {children}
    </button>
  );
}

function FullPageSplash({ children }: { children: ReactNode }) {
  return (
    <div className="cr-page cr-splash">
      <span className="cr-eyebrow">{children}</span>
    </div>
  );
}
