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
          <a href="/docs/" onClick={() => setNavOpen(false)}>
            Docs
          </a>
          <a href="https://produtech.web.app" target="_blank" rel="noreferrer" onClick={() => setNavOpen(false)}>
            Estimativa Build
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
            <p className="cr-eyebrow">regras que evoluem · gate que não mente</p>
            <h1 className="cr-brand">CodeHero</h1>
            <p className="cr-headline">
              Corte bugs e dívida técnica pela metade.
              <span className="cr-headline-accent"> Seja o herói do PR.</span>
            </p>
            <p className="cr-subhead">
              As regras se atualizam sozinhas a partir do uso real do time — e só entram no CI depois de provar
              precisão no corpus. Mesmo código, mesmo resultado: sem incoerência entre PRs e sem falso positivo que
              vira ruído.
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
                    <strong>Política</strong> `console.log` em produção
                  </li>
                  <li>
                    <strong>CWE-338</strong> `Math.random` usado como token
                  </li>
                </ul>
                <div className="cr-panel-footer">
                  <span className="cr-chip">QG: falhou</span>
                  <span className="cr-chip cr-chip-ok">0 FP no corpus</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="cr-trust">
          <p>Regras que sobem sozinhas. Resultado estável. Falso positivo fica do lado de fora do gate.</p>
        </section>

        <section id="poderes" className="cr-section">
          <div className="cr-section-head">
            <h2>Por que times escolhem o CodeHero</h2>
            <p>O catálogo aprende com o time. O gate só promove o que passa no teste.</p>
          </div>
          <div className="cr-feature-grid">
            <article className="cr-feature">
              <h3>Regras que se atualizam sozinhas</h3>
              <p>
                Feedback, gaps e novas políticas alimentam o próximo ciclo. Candidatas boas sobem; as que pioram
                precisão ou geram regressão ficam de fora — sem release manual do vendor.
              </p>
            </article>
            <article className="cr-feature">
              <h3>Sem incoerência entre scans</h3>
              <p>
                O mesmo trecho de código produz o mesmo finding no CI, no editor e na prévia. Nada de “passou ontem,
                falhou hoje” por variação de modelo.
              </p>
            </article>
            <article className="cr-feature">
              <h3>Falso positivo sob controle</h3>
              <p>
                Toda regra nova é medida contra um corpus rotulado (precisão, recall, F1). Só o que melhora o score
                sem regressão chega ao quality gate do time.
              </p>
            </article>
          </div>
        </section>

        <section id="missao" className="cr-section cr-section-alt">
          <div className="cr-section-head">
            <h2>Diferente do mercado</h2>
            <p>Mais leve que suites enterprise. Mais estável que scanner só de IA. Comparação direta abaixo.</p>
          </div>
          <div className="cr-compare-wrap">
            <table className="cr-compare-table">
              <thead>
                <tr>
                  <th scope="col">Critério</th>
                  <th scope="col" className="cr-compare-highlight">
                    CodeHero
                  </th>
                  <th scope="col">Suites enterprise clássicas</th>
                  <th scope="col">Scanners só de IA</th>
                  <th scope="col">Linters soltos</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Custo</th>
                  <td className="cr-compare-highlight">Gratuito</td>
                  <td>Licença enterprise</td>
                  <td>Custo por token/arquivo</td>
                  <td>Gratuito</td>
                </tr>
                <tr>
                  <th scope="row">Motor de detecção</th>
                  <td className="cr-compare-highlight">Reproduzível (padrão / AST)</td>
                  <td>Reproduzível</td>
                  <td>LLM por arquivo</td>
                  <td>Reproduzível</td>
                </tr>
                <tr>
                  <th scope="row">Evolução das regras</th>
                  <td className="cr-compare-highlight">Busca evolutiva com prova no corpus</td>
                  <td>Releases do vendor</td>
                  <td>Depende do modelo</td>
                  <td>Comunidade/config manual</td>
                </tr>
                <tr>
                  <th scope="row">Consistência</th>
                  <td className="cr-compare-highlight">Mesmo input → mesmo resultado</td>
                  <td>Alta</td>
                  <td>Varia por execução</td>
                  <td>Alta</td>
                </tr>
                <tr>
                  <th scope="row">Controle de falso positivo</th>
                  <td className="cr-compare-highlight">Promoção só com ganho de precisão</td>
                  <td>Curadoria do vendor</td>
                  <td>Fraco / opaco</td>
                  <td>Manual</td>
                </tr>
                <tr>
                  <th scope="row">Política do time</th>
                  <td className="cr-compare-highlight">Sim — em linguagem natural</td>
                  <td>Não</td>
                  <td>Não</td>
                  <td>Não</td>
                </tr>
                <tr>
                  <th scope="row">Correção verificável</th>
                  <td className="cr-compare-highlight">SDD Spec + critérios de aceite</td>
                  <td>Quick fix limitado</td>
                  <td>Sugestão sem verificação</td>
                  <td>Nenhuma</td>
                </tr>
                <tr>
                  <th scope="row">Agente nativo (MCP)</th>
                  <td className="cr-compare-highlight">Sim</td>
                  <td>Add-on comercial</td>
                  <td>Variável</td>
                  <td>Não</td>
                </tr>
                <tr>
                  <th scope="row">Linguagens legadas</th>
                  <td className="cr-compare-highlight">COBOL, DB2, T-SQL, VB.Net inclusos</td>
                  <td>Add-on separado</td>
                  <td>Raro</td>
                  <td>Não</td>
                </tr>
                <tr>
                  <th scope="row">Apontamento pronto para autofix</th>
                  <td className="cr-compare-highlight">Risco, motivo e correção no próprio SARIF</td>
                  <td>Só o achado</td>
                  <td>Texto sem estrutura</td>
                  <td>Só o achado</td>
                </tr>
                <tr>
                  <th scope="row">Tempo de scan</th>
                  <td className="cr-compare-highlight">Segundos</td>
                  <td>Minutos</td>
                  <td>Minutos + custo por token</td>
                  <td>Segundos</td>
                </tr>
                {/* Linha em que perdemos, deliberadamente mantida. Uma tabela
                    em que um lado vence tudo é descontada inteira por comprador
                    técnico — e esta é a limitação real do motor L0. */}
                <tr>
                  <th scope="row">Fluxo entre arquivos</th>
                  <td className="cr-compare-highlight">Taint dentro do arquivo (JS/TS)</td>
                  <td>Taint entre arquivos</td>
                  <td>Varia</td>
                  <td>Não faz</td>
                </tr>
                <tr>
                  <th scope="row">Setup</th>
                  <td className="cr-compare-highlight">1 clique (plugin/prévia)</td>
                  <td>Servidor próprio</td>
                  <td>Chave de API</td>
                  <td>Config por repo</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="cr-compare-note">
            Onde a análise profunda entre arquivos é o requisito, o CodeHero ingere o SARIF de
            motores como CodeQL e Semgrep e continua sendo a camada de política, gate e autofix —
            complementar, não substituto.
          </p>
        </section>

        <section id="como" className="cr-section">
          <div className="cr-section-head">
            <h2>Três passos para engajar o time</h2>
            <p>Do zero ao primeiro relatório — sem setup cansado.</p>
          </div>
          <ol className="cr-steps">
            <li>
              <span>01</span>
              <div>
                <strong>Crie a conta</strong>
                <p>Defina a política do time uma vez; o catálogo começa a evoluir a partir daí.</p>
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
                Conta em segundos. Depois: política do time, plugin e prévia na Cloud — o gate só bloqueia o que já
                passou pelo filtro de precisão.
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
        <span>By Nelson Borges</span>
        <a href="/docs/" style={{ color: "inherit" }}>
          Docs
        </a>
        <a href="https://produtech.web.app" target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
          Estimativa Build
        </a>
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
