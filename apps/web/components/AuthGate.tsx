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
          <a href="#fluxo" onClick={() => setNavOpen(false)}>
            Fluxo
          </a>
          <a href="#mercado" onClick={() => setNavOpen(false)}>
            Mercado
          </a>
          <a href="#esteira" onClick={() => setNavOpen(false)}>
            Esteira
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
        <section className="lx-hero" aria-labelledby="lx-hero-title">
          <div className="lx-hero-copy">
            <p className="lx-kicker">Plataforma de engenharia · scan → gate → correção</p>
            <h1 id="lx-hero-title" className="lx-brand">
              CodeHero
            </h1>
            <p className="lx-headline">
              O controle de qualidade que o board exige — e a esteira que o time consegue operar.
            </p>
            <p className="lx-lede">
              Unifique SAST, SCA, secrets, IaC e mainframe num contrato único de gate. Trate falso positivo
              como dado de produto. Deixe a IA corrigir o que o policy engine já classificou — sem cobrar
              por linha de código, sem depender de um único fornecedor de scanner.
            </p>
            <div className="lx-cta-row">
              <button type="button" className="lx-btn lx-btn-primary" onClick={() => goAuth("signup")}>
                Solicitar acesso
              </button>
              <a className="lx-btn lx-btn-ghost" href="#fluxo">
                Ver o fluxo
              </a>
            </div>
          </div>
          <div className="lx-hero-visual">
            <LandingFlow compact />
          </div>
        </section>

        <section className="lx-section lx-thesis" aria-labelledby="lx-thesis-title">
          <div className="lx-section-inner">
            <p className="lx-kicker">Tese para o CTO</p>
            <h2 id="lx-thesis-title">Segurança de aplicação não é um scanner. É um sistema de decisão.</h2>
            <p className="lx-prose">
              Ferramentas de mercado entregam volume de findings. O CodeHero entrega <em>governança
              operacional</em>: o que bloqueia merge, o que a IA pode corrigir, o que o time marcou como
              falso positivo — e como essa memória reduz o próximo ciclo. O resultado não é um PDF de
              compliance. É um pipeline que acelera release com risco controlado.
            </p>
            <div className="lx-pillars">
              <article className="lx-pillar" style={{ animationDelay: "0.05s" }}>
                <h3>Gate multi-motor</h3>
                <p>
                  Presence, Opengrep, Semgrep Community, Trivy, Gitleaks, Checkov e SARIF importado —
                  score único, thresholds por org, suppress auditável.
                </p>
              </article>
              <article className="lx-pillar" style={{ animationDelay: "0.12s" }}>
                <h3>IA com orçamento</h3>
                <p>
                  Correção automática só depois do gate. Custo por projeto e por execução — não por LOC.
                  Telemetria de tokens e qualidade no cockpit.
                </p>
              </article>
              <article className="lx-pillar" style={{ animationDelay: "0.19s" }}>
                <h3>Memória institucional</h3>
                <p>
                  Falso positivo vira estatística de regra. A esteira aprende o que o time já decidiu —
                  menos ruído no próximo PR, mais velocidade no review.
                </p>
              </article>
              <article className="lx-pillar" style={{ animationDelay: "0.26s" }}>
                <h3>Um contrato, duas eras</h3>
                <p>
                  Repositórios cloud e mainframe (COBOL, JCL, CICS, DB2) no mesmo modelo de job, finding e
                  política. Modernização sem silo de ferramenta.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="lx-section lx-flow-section" id="fluxo" aria-labelledby="lx-flow-title">
          <div className="lx-section-inner">
            <p className="lx-kicker">Arquitetura operacional</p>
            <h2 id="lx-flow-title">Quatro estágios. Integrações explícitas. Um loop.</h2>
            <p className="lx-prose">
              Do push ao merge, cada fase publica um contrato para a seguinte. A Esteira não é um relatório —
              devolve memória de regra ao próximo Scan.
            </p>
            <LandingFlow detailed />
          </div>
        </section>

        <section className="lx-section lx-strengths" aria-labelledby="lx-str-title">
          <div className="lx-section-inner">
            <p className="lx-kicker">Fortalezas</p>
            <h2 id="lx-str-title">O que diferencia o CodeHero na mesa do board</h2>
            <div className="lx-strength-grid">
              <article>
                <h3>Desacoplamento de custo de IA e tamanho do repo</h3>
                <p>
                  Modelos cobram por token de correção — não por milhão de linhas indexadas. Você escala
                  análise estática sem inflar a fatura de GenAI na mesma curva.
                </p>
              </article>
              <article>
                <h3>Policy como produto, não como planilha</h3>
                <p>
                  Thresholds, allowlists e suppressões vivem no banco com auditoria. O gate do CI é a mesma
                  regra que o CTO vê no cockpit — sem drift entre “política oficial” e “o que o YAML faz”.
                </p>
              </article>
              <article>
                <h3>Multi-engine sem lock-in narrativo</h3>
                <p>
                  Presence e Opengrep cobrem o núcleo open; Semgrep Community e SARIF importado fecham o
                  gap de regras e ferramentas já contratadas. Trocar um motor não redefine o produto.
                </p>
              </article>
              <article>
                <h3>Observabilidade de engenharia de segurança</h3>
                <p>
                  Jobs, findings, FP por regra, custo de agentes e status de PR — telemetria executiva para
                  AppSec e para o VP de Engenharia na mesma tela.
                </p>
              </article>
              <article>
                <h3>Mainframe no mesmo SLA de gate</h3>
                <p>
                  Inventário, parsers e políticas para COBOL/JCL não são um “módulo aparte de consultoria”.
                  Entram no contrato de finding e no mesmo fluxo de correção assistida.
                </p>
              </article>
              <article>
                <h3>Open core auditável</h3>
                <p>
                  Código e contratos abertos para inspeção de segurança. Você avalia a superfície antes de
                  confiar o gate do monorepo crítico à plataforma.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="lx-section lx-market" id="mercado" aria-labelledby="lx-mkt-title">
          <div className="lx-section-inner">
            <p className="lx-kicker">Comparativo de mercado</p>
            <h2 id="lx-mkt-title">Onde as suítes enterprise param — e o CodeHero continua</h2>
            <p className="lx-prose">
              Comparação honesta com o padrão de mercado (SAST/SCA cloud com billing por LOC, UI de
              findings, plugin de IDE). O CodeHero não substitui o seu scanner favorito: orquestra,
              governa e remedia em cima do sinal.
            </p>
            <div className="lx-table-wrap">
              <table className="lx-table">
                <thead>
                  <tr>
                    <th scope="col">Capacidade</th>
                    <th scope="col">Suítes enterprise típicas</th>
                    <th scope="col">CodeHero</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Modelo de custo</th>
                    <td>Frequente: seats + LOC / contributors</td>
                    <td>Projetos, execuções e orçamento de IA — sem taxar tamanho do monorepo</td>
                  </tr>
                  <tr>
                    <th scope="row">Decisão de merge</th>
                    <td>Policy packs genéricos; FP muitas vezes só no UI</td>
                    <td>Gate versionado + suppress com estatística de regra na esteira</td>
                  </tr>
                  <tr>
                    <th scope="row">Correção</th>
                    <td>Sugestão em IDE ou ticket; pouco amarrado ao gate</td>
                    <td>Agentes pós-gate, diff no PR, custo e qualidade medidos</td>
                  </tr>
                  <tr>
                    <th scope="row">Heterogeneidade de scanners</th>
                    <td>Ecossistema do vendor; import limitado</td>
                    <td>Motores open + SARIF de terceiros no mesmo score</td>
                  </tr>
                  <tr>
                    <th scope="row">Mainframe / legado</th>
                    <td>Produto separado ou parceiro</td>
                    <td>Mesmo job model e políticas</td>
                  </tr>
                  <tr>
                    <th scope="row">Taint / dataflow profundo</th>
                    <td>Forte em engines proprietários inter-file</td>
                    <td>
                      Intra-procedural sólido via Presence; inter-file profundo — complemente com SARIF do
                      seu SAST atual
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Lock-in</th>
                    <td>Alto (regras, UI, billing)</td>
                    <td>Contrato aberto; motores substituíveis; dados na sua cloud</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="lx-footnote">
              Leitura para o CTO: use o CodeHero como <strong>camada de controle e remediação</strong>.
              Mantenha o SAST enterprise onde o dataflow inter-file for requisito regulatório — importe o
              SARIF e unifique o gate.
            </p>
          </div>
        </section>

        <section className="lx-section lx-mainframe" aria-labelledby="lx-mf-title">
          <div className="lx-section-inner lx-mf-grid">
            <div>
              <p className="lx-kicker">Portfólio híbrido</p>
              <h2 id="lx-mf-title">Cloud e mainframe. Mesmo rigor de engenharia.</h2>
              <p className="lx-prose">
                Inventário de programas, copybooks, JCL e dependências DB2/CICS — com findings e políticas
                no mesmo cockpit que o time de produto já usa para o monorepo. Modernização deixa de ser um
                projeto paralelo de ferramenta.
              </p>
            </div>
            <ul className="lx-mf-list">
              <li>COBOL, JCL, CICS, DB2 no contrato de análise</li>
              <li>Gates e correção assistida alinhados ao restante do SDLC</li>
              <li>Visibilidade executiva do risco legado junto do cloud-native</li>
            </ul>
          </div>
        </section>

        <div className="lx-section lx-esteira" id="esteira">
          <div className="lx-section-inner">
            <p className="lx-kicker">Esteira que aprende</p>
            <LearningLoopStory id="esteira-ciclo" />
          </div>
        </div>

        <section className="lx-section lx-close" aria-labelledby="lx-close-title">
          <div className="lx-section-inner lx-close-inner">
            <h2 id="lx-close-title">Pronto para colocar o gate sob o seu comando?</h2>
            <p className="lx-prose">
              Crie a conta, conecte a org e rode o primeiro job. Em poucos ciclos você tem baseline de
              findings, política de merge e telemetria de custo de correção — o kit mínimo que um CTO
              precisa para defender velocidade com segurança.
            </p>
            <div className="lx-cta-row">
              <button type="button" className="lx-btn lx-btn-primary" onClick={() => goAuth("signup")}>
                Criar conta
              </button>
              <a className="lx-btn lx-btn-ghost" href="/docs">
                Ler a documentação
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
