"use client";
import { useState, type FormEvent, type ReactNode } from "react";
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
import { httpsCallable, type FunctionsError } from "firebase/functions";
import { auth, functions } from "@/lib/firebase";
import { useAuth } from "@/lib/useAuth";
import LearningLoopStory from "@/components/LearningLoopStory";
import LandingFlow from "@/components/LandingFlow";

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
          <a href="#produto" onClick={() => setNavOpen(false)}>
            Produto
          </a>
          <a href="#fluxo" onClick={() => setNavOpen(false)}>
            Fluxo
          </a>
          <a href="#mercado" onClick={() => setNavOpen(false)}>
            Mercado
          </a>
          <a href="/docs" onClick={() => setNavOpen(false)}>
            Docs
          </a>
          <button type="button" className="lx-nav-cta" onClick={() => goAuth("login")}>
            Entrar
          </button>
        </nav>
      </header>

      <main>
        {/* 1 · Hook — brand + outcome only */}
        <section className="lx-hero" aria-labelledby="lx-hero-title">
          <div className="lx-hero-copy">
            <p className="lx-kicker">Engenharia de qualidade · AppSec · Mainframe</p>
            <h1 id="lx-hero-title" className="lx-brand">
              CodeHero
            </h1>
            <p className="lx-headline">
              Gate de merge sob o seu comando — com esteira que aprende o que o time já decidiu.
            </p>
            <p className="lx-lede">
              A camada de controle entre scanners, política e correção com IA. Menos ruído no PR. Mais
              velocidade com risco explícito.
            </p>
            <div className="lx-cta-row">
              <button type="button" className="lx-btn lx-btn-primary" onClick={() => goAuth("signup")}>
                Solicitar acesso
              </button>
              <a className="lx-btn lx-btn-ghost" href="#produto">
                Conhecer o produto
              </a>
            </div>
          </div>
        </section>

        {/* 2 · Product story — read before seeing the flow */}
        <section className="lx-section lx-product" id="produto" aria-labelledby="lx-product-title">
          <div className="lx-section-inner">
            <p className="lx-kicker">O produto</p>
            <h2 id="lx-product-title">Não é mais um scanner. É o sistema que decide o que importa.</h2>
            <p className="lx-prose lx-prose-lead">
              Suítes enterprise acumulam findings. O CodeHero transforma esse sinal em{" "}
              <em>governança operacional</em>: o que bloqueia merge, o que a IA pode corrigir, o que o time
              marcou como falso positivo — e como essa memória acelera o próximo ciclo.
            </p>

            <div className="lx-promise-grid">
              <article className="lx-promise">
                <span className="lx-promise-num" aria-hidden>
                  01
                </span>
                <h3>Um contrato de gate</h3>
                <p>
                  Presence, Opengrep, Semgrep Community, Trivy, Gitleaks, Checkov e SARIF importado — score
                  único, thresholds por org, suppress auditável. O CI e o cockpit falam a mesma política.
                </p>
              </article>
              <article className="lx-promise">
                <span className="lx-promise-num" aria-hidden>
                  02
                </span>
                <h3>IA depois da política</h3>
                <p>
                  Correção automática só no que o gate liberou. Custo por projeto e execução — não por linha
                  de código. Diff no PR, telemetria no cockpit.
                </p>
              </article>
              <article className="lx-promise">
                <span className="lx-promise-num" aria-hidden>
                  03
                </span>
                <h3>Memória que reduz ruído</h3>
                <p>
                  Falso positivo vira estatística de regra. A esteira devolve aprendizado ao próximo scan —
                  o time para de reexplicar a mesma exceção.
                </p>
              </article>
            </div>

            <p className="lx-product-bridge">
              Abaixo, o caminho completo — do push ao merge — e o que cada fase entrega à seguinte.
            </p>
          </div>
        </section>

        {/* 3 · Flow — proof after narrative */}
        <section className="lx-section lx-flow-section" id="fluxo" aria-labelledby="lx-flow-title">
          <div className="lx-section-inner">
            <p className="lx-kicker">Como opera</p>
            <h2 id="lx-flow-title">Scan → Gate → Correção → Esteira</h2>
            <p className="lx-prose">
              Quatro estágios, um feedback loop. Cada seta é um contrato: a fase seguinte só consome o que a
              anterior publicou. A Esteira não fecha o ciclo em relatório — devolve memória ao Scan.
            </p>
            <LandingFlow detailed />
          </div>
        </section>

        {/* 4 · Why CodeHero — sharp differentiators */}
        <section className="lx-section lx-strengths" id="porque" aria-labelledby="lx-str-title">
          <div className="lx-section-inner">
            <p className="lx-kicker">Por que CodeHero</p>
            <h2 id="lx-str-title">O que o board e o time de engenharia ganham juntos</h2>
            <div className="lx-strength-grid lx-strength-grid--4">
              <article>
                <h3>Custo de IA desacoplado do tamanho do repo</h3>
                <p>
                  Você escala análise estática sem inflar GenAI na curva de LOC. Orçamento por execução,
                  visível no cockpit.
                </p>
              </article>
              <article>
                <h3>Policy como produto</h3>
                <p>
                  Thresholds e suppressões versionados com auditoria. Sem drift entre a planilha “oficial” e
                  o que o YAML do CI realmente faz.
                </p>
              </article>
              <article>
                <h3>Multi-engine sem lock-in</h3>
                <p>
                  Motores open no núcleo; SARIF do scanner que você já paga. Trocar um engine não redefine o
                  produto.
                </p>
              </article>
              <article>
                <h3>Cloud e mainframe no mesmo gate</h3>
                <p>
                  COBOL, JCL, CICS, DB2 no mesmo contrato de finding e correção assistida — modernização sem
                  silo de ferramenta.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* 5 · Market frame */}
        <section className="lx-section lx-market" id="mercado" aria-labelledby="lx-mkt-title">
          <div className="lx-section-inner">
            <p className="lx-kicker">Mercado</p>
            <h2 id="lx-mkt-title">Complementa a suíte. Não compete com o PDF dela.</h2>
            <p className="lx-prose">
              O CodeHero orquestra, governa e remedia em cima do sinal — inclusive do SAST que você já
              contratou.
            </p>
            <div className="lx-table-wrap">
              <table className="lx-table">
                <thead>
                  <tr>
                    <th scope="col">Capacidade</th>
                    <th scope="col">Suítes enterprise</th>
                    <th scope="col">CodeHero</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Modelo de custo</th>
                    <td>Seats + LOC / contributors</td>
                    <td>Projetos, execuções e orçamento de IA</td>
                  </tr>
                  <tr>
                    <th scope="row">Decisão de merge</th>
                    <td>Policy packs; FP muitas vezes só no UI</td>
                    <td>Gate versionado + suppress com estatística na esteira</td>
                  </tr>
                  <tr>
                    <th scope="row">Correção</th>
                    <td>Sugestão em IDE ou ticket</td>
                    <td>Agentes pós-gate, diff no PR, custo medido</td>
                  </tr>
                  <tr>
                    <th scope="row">Scanners heterogêneos</th>
                    <td>Ecossistema do vendor</td>
                    <td>Open + SARIF de terceiros no mesmo score</td>
                  </tr>
                  <tr>
                    <th scope="row">Mainframe</th>
                    <td>Produto ou parceiro à parte</td>
                    <td>Mesmo job model e políticas</td>
                  </tr>
                  <tr>
                    <th scope="row">Dataflow inter-file</th>
                    <td>Forte em engines proprietários</td>
                    <td>Presence intra-procedural; complemente via SARIF do seu SAST</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="lx-footnote">
              Leitura para o CTO: use o CodeHero como <strong>camada de controle e remediação</strong>.
              Mantenha o SAST enterprise onde o dataflow profundo for requisito — importe o SARIF e unifique
              o gate.
            </p>
          </div>
        </section>

        {/* 6 · Learning loop */}
        <div className="lx-section lx-esteira" id="esteira">
          <div className="lx-section-inner">
            <p className="lx-kicker">Esteira que aprende</p>
            <p className="lx-prose lx-esteira-intro">
              O aprendizado não é “um LLM lê cada arquivo no PR”. É um ciclo com prova: observar → propor →
              validar no corpus → publicar só o que melhora precisão.
            </p>
            <LearningLoopStory id="esteira-ciclo" />
          </div>
        </div>

        {/* 7 · Close */}
        <section className="lx-section lx-close" aria-labelledby="lx-close-title">
          <div className="lx-section-inner lx-close-inner">
            <h2 id="lx-close-title">Coloque o gate sob o seu comando.</h2>
            <p className="lx-prose">
              Crie a conta, conecte a org, rode o primeiro job. Em poucos ciclos: baseline, política de merge
              e telemetria de custo — o kit mínimo para defender velocidade com segurança.
            </p>
            <div className="lx-cta-row">
              <button type="button" className="lx-btn lx-btn-primary" onClick={() => goAuth("signup")}>
                Criar conta
              </button>
              <a className="lx-btn lx-btn-ghost" href="/docs">
                Documentação
              </a>
            </div>
          </div>
        </section>

        <section className="lx-auth" id="auth" aria-labelledby="auth-title">
          <div className="lx-auth-panel">
            <div className="lx-auth-tabs" role="tablist" aria-label="Autenticação">
              <TabButton active={mode === "login"} onClick={() => setMode("login")}>
                Entrar
              </TabButton>
              <TabButton active={mode === "signup"} onClick={() => setMode("signup")}>
                Criar conta
              </TabButton>
              <TabButton active={mode === "forgot"} onClick={() => setMode("forgot")}>
                Recuperar
              </TabButton>
            </div>

            <h2 id="auth-title" className="lx-auth-title">
              {mode === "login" && "Acesso à plataforma"}
              {mode === "signup" && "Criar conta CodeHero"}
              {mode === "forgot" && "Recuperar senha"}
            </h2>
            <p className="lx-auth-sub">
              {mode === "forgot"
                ? "Enviamos um link de redefinição se o email existir na base."
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
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="mín. 6 caracteres"
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
                      ? "Criar conta"
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
