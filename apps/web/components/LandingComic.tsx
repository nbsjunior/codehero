"use client";
import { useEffect, useRef, type ReactNode } from "react";
import LandingFlow from "@/components/LandingFlow";

/**
 * A landing contada em quadros.
 *
 * A versão anterior falava a língua de fornecedor de ferramenta: thresholds,
 * drift, lock in, custo de GenAI na curva de LOC. Quem decide compra não lê
 * isso como benefício, lê como esforço de tradução.
 *
 * Aqui a ordem é a de uma história: primeiro a dor que a pessoa reconhece,
 * depois o sistema que ninguém encosta, só então a ferramenta. E no fim, o que
 * ela NÃO faz, porque quem avalia ferramenta desconfia de quem só tem virtude.
 */

/**
 * Liga a animação de entrada dos quadros. UM observer para a página toda.
 *
 * A animação é enfeite. O texto é o produto, e por isso o CSS mostra tudo por
 * padrão: a classe `hq-anima` é que introduz o estado escondido, e ela só entra
 * daqui, depois de confirmar que dá para animar.
 *
 * Duas coisas que só apareceram testando no navegador de verdade:
 *
 *  1. Onde a página não compõe quadros, o IntersectionObserver não entrega
 *     nada. Escondendo por CSS e revelando por JS, a landing inteira fica em
 *     branco com build verde e DOM correto.
 *  2. Não adianta a rede de segurança medir a opacidade logo depois de pôr a
 *     classe: nesse instante a transição está no começo e o valor lido é o
 *     inicial. Isso é corrida, não garantia.
 *
 * Então a garantia aqui é outra: se o observer não entregou NADA até o prazo,
 * a animação é desligada na raiz. Sem `hq-anima` não existe estado escondido
 * nem transição no caminho, e o conteúdo simplesmente aparece.
 */
function useAnimacaoDosQuadros(raizRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const raiz = raizRef.current;
    if (!raiz) return;
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const alvos = raiz.querySelectorAll<HTMLElement>("[data-anima]");
    if (alvos.length === 0) return;

    let entregou = false;
    let obs: IntersectionObserver;
    try {
      obs = new IntersectionObserver(
        (entradas) => {
          entregou = true;
          for (const e of entradas) {
            if (!e.isIntersecting) continue;
            e.target.classList.add("is-in");
            obs.unobserve(e.target);
          }
        },
        { threshold: 0.15, rootMargin: "0px 0px -60px 0px" },
      );
    } catch {
      return; // sem observer, sem animação, tudo visível
    }

    raiz.classList.add("hq-anima");
    for (const a of alvos) obs.observe(a);

    const socorro = window.setTimeout(() => {
      if (entregou) return;
      raiz.classList.remove("hq-anima");
      obs.disconnect();
    }, 1200);

    return () => {
      window.clearTimeout(socorro);
      obs.disconnect();
    };
  }, [raizRef]);
}

function Quadro({
  n,
  titulo,
  children,
  tom = "normal",
  id,
}: {
  n?: string;
  titulo: string;
  children: ReactNode;
  tom?: "normal" | "virada" | "calmo";
  id?: string;
}) {
  return (
    <section id={id} data-anima className={`hq-quadro hq-quadro--${tom}`}>
      {n ? (
        <span className="hq-num" aria-hidden>
          {n}
        </span>
      ) : null}
      <h2 className="hq-titulo">{titulo}</h2>
      <div className="hq-corpo">{children}</div>
    </section>
  );
}

/** Fala de gente. Serve para dizer em voz alta o que o texto formal não diz. */
function Fala({ children, de }: { children: ReactNode; de: string }) {
  return (
    <figure className="hq-balao">
      <blockquote>{children}</blockquote>
      <figcaption>{de}</figcaption>
    </figure>
  );
}

export default function LandingComic({
  onSignup,
  onLogin,
}: {
  onSignup: () => void;
  onLogin: () => void;
}) {
  const raiz = useRef<HTMLDivElement | null>(null);
  useAnimacaoDosQuadros(raiz);

  return (
    <div className="hq" ref={raiz}>
      {/* Capa */}
      <section data-anima className="hq-capa" aria-labelledby="hq-capa-titulo">
        <div className="hq-capa-inner">
          <p className="hq-kicker">Análise de código para quem responde pelo risco</p>
          <h1 id="hq-capa-titulo" className="hq-marca">
            CodeHero
          </h1>
          <p className="hq-chamada">
            Seu time não precisa de mais alertas. Precisa saber quais importam.
          </p>
          <p className="hq-lede">
            O CodeHero junta o que as suas ferramentas já encontram, tira o que está repetido e decide
            o que segura o merge. Sempre do mesmo jeito.
          </p>
          <div className="hq-ctas">
            <button type="button" className="hq-btn hq-btn--primario" onClick={onSignup}>
              Criar conta
            </button>
            <a className="hq-btn hq-btn--fantasma" href="#historia">
              Ver como funciona
            </a>
          </div>
        </div>
        <div className="hq-capa-arte" aria-hidden>
          <span className="hq-raio" />
          <span className="hq-raio" />
          <span className="hq-raio" />
        </div>
      </section>

      <div id="historia" className="hq-tira">
        <Quadro n="01" titulo="Cinco ferramentas. Três mil alertas. Ninguém abre.">
          <p>
            Cada scanner encontra o mesmo problema e chama por um nome diferente. A lista cresce, a
            confiança cai, e o time passa a ignorar tudo. Inclusive o que era grave de verdade.
          </p>
          <Fala de="todo mundo, toda terça">Depois a gente olha esse relatório.</Fala>
        </Quadro>

        <Quadro n="02" titulo="E tem o batch que roda às duas da manhã.">
          <p>
            COBOL conversando com DB2. Funciona há vinte anos. Quase ninguém sabe explicar. E nenhuma
            ferramenta do seu contrato olha para ele.
          </p>
          <p>
            Quando esse job quebra, não é um alerta no painel. É o fechamento do dia que não saiu.
          </p>
          <Fala de="a regra não escrita">Nisso aí a gente não mexe.</Fala>
        </Quadro>

        <Quadro n="03" tom="virada" titulo="O CodeHero olha justamente a junta.">
          <p>
            Ferramenta de COBOL lê o programa. Ferramenta de SQL lê a consulta. O defeito mora entre
            os dois, e é ali que o batch quebra. O CodeHero lê os dois lados ao mesmo tempo.
          </p>
          <ul className="hq-lista">
            <li>
              <strong>Um número que não cabe no campo</strong> e é cortado em silêncio, sem erro
              nenhum.
            </li>
            <li>
              <strong>Um cursor aberto</strong> que ninguém fechou, segurando trava até o fim do
              processo.
            </li>
            <li>
              <strong>Uma consulta dentro do laço</strong>, uma ida ao banco por linha. No mainframe
              isso vai direto para a fatura.
            </li>
            <li>
              <strong>Um COMMIT que fecha o cursor</strong> e derruba a volta seguinte do laço.
            </li>
          </ul>
          <p className="hq-nota">
            O último só aparece quando o volume passa de um certo ponto. Ou seja, aparece em produção.
          </p>
        </Quadro>

        <Quadro n="04" titulo="A resposta é sempre a mesma.">
          <p>
            Nenhum modelo de linguagem decide nada durante a análise. O mesmo código entra, o mesmo
            resultado sai. Isso significa que você pode versionar a política, repetir o resultado de
            seis meses atrás e defender a decisão numa auditoria.
          </p>
          <Fala de="a conversa que passa a ser possível">
            Por que reprovou? Por esta regra, nesta linha, com este trecho.
          </Fala>
        </Quadro>

        <Quadro n="05" titulo="Do push ao merge, sem etapa escondida.">
          <p>
            Cada fase só consome o que a anterior publicou. Nada acontece fora do caminho que você vê
            aqui.
          </p>
          <div className="hq-fluxo">
            <LandingFlow detailed />
          </div>
        </Quadro>

        <Quadro n="06" titulo="Falso positivo vira número, não discussão.">
          <p>
            Quando alguém marca um apontamento como falso, isso entra na estatística daquela regra. O
            time deixa de reexplicar a mesma exceção toda semana, e a regra que erra demais perde
            espaço sozinha.
          </p>
        </Quadro>

        <Quadro n="07" tom="calmo" titulo="Onde ela se destaca e onde ainda não vai." id="limites">
          <div className="hq-duas">
            <div className="hq-coluna hq-coluna--forte">
              <h3>Se destaca</h3>
              <ul>
                <li>COBOL e DB2 lidos como uma coisa só, que é como eles quebram</li>
                <li>Junta o sinal das ferramentas que você já paga e remove o que está repetido</li>
                <li>Decisão que não muda de humor entre uma execução e outra</li>
              </ul>
            </div>
            <div className="hq-coluna hq-coluna--fraco">
              <h3>Ainda não vai</h3>
              <ul>
                <li>
                  Rastreamento profundo de fluxo de dados hoje só em JavaScript e TypeScript
                </li>
                <li>
                  Para as demais linguagens, traga o relatório do seu SAST e o gate unifica tudo num
                  resultado só
                </li>
              </ul>
            </div>
          </div>
          <p className="hq-nota">
            Preferimos dizer isso agora a você descobrir depois da assinatura.
          </p>
        </Quadro>
      </div>

      <section className="hq-fim" aria-labelledby="hq-fim-titulo">
        <h2 id="hq-fim-titulo">Rode no seu pior repositório.</h2>
        <p>
          Aquele que ninguém quer abrir. É onde a diferença aparece mais rápido, e é o único teste que
          vale alguma coisa.
        </p>
        <div className="hq-ctas">
          <button type="button" className="hq-btn hq-btn--primario" onClick={onSignup}>
            Criar conta
          </button>
          <button type="button" className="hq-btn hq-btn--fantasma" onClick={onLogin}>
            Já tenho acesso
          </button>
        </div>
      </section>
    </div>
  );
}
