"use client";

import { useEffect, useMemo, useState } from "react";
import { Callout, DataSection, PageHeader } from "@/components/AdminUi";

// ---------------------------------------------------------------------------
// Leitura arquitetural do repositório — determinística, sem modelo nenhum.
//
// Por que esta tela existe separada do relatório de apontamentos
// ---------------------------------------------------------------------------
// Apontamento responde "o que está errado". Esta tela responde "onde mexer
// custa caro", que é outra pergunta e vem antes na conversa com quem paga.
//
// O número que ela existe para mostrar não é complexidade, é complexidade
// CRUZADA com alcance. Uma função complicada que ninguém importa custa zero
// para deixar quieta; a mesma função com quarenta dependentes é onde toda
// mudança dói. Complexidade sozinha ordena errado o trabalho.
// ---------------------------------------------------------------------------

interface Modulo {
  arquivo: string;
  ca: number;
  ce: number;
  externas: number;
  instabilidade: number | null;
  abstracao: number | null;
  distanciaDaSequencia: number | null;
  linhasDeCodigo: number;
  ciclomatica: number;
  cognitiva: number;
  funcoes: number;
  maiorFuncao: number;
  risco: number;
  ciclo: number | null;
}

interface Relatorio {
  versao: 1;
  geradoEm: string;
  raiz: string;
  totais: {
    modulos: number;
    linhasDeCodigo: number;
    funcoes: number;
    ciclomaticaMedia: number;
    cognitivaMedia: number;
    arestasInternas: number;
    dependenciasExternas: number;
    modulosEmCiclo: number;
    modulosOrfaos: number;
  };
  modulos: Modulo[];
  ciclos: Array<{ id: number; modulos: string[] }>;
}

type Ordem = "risco" | "ca" | "ce" | "cognitiva" | "instabilidade";

const num = (n: number) => n.toLocaleString("pt-BR");

/** Rocha = muita gente depende e ele quase não depende de ninguém. */
function papel(m: Modulo): { rotulo: string; tom: "ok" | "warn" | "danger" | "neutro" } {
  if (m.ciclo !== null) return { rotulo: "em ciclo", tom: "danger" };
  if (m.instabilidade === null) return { rotulo: "isolado", tom: "neutro" };
  if (m.instabilidade <= 0.25 && m.ca >= 2) {
    return m.cognitiva >= 60
      ? { rotulo: "rocha complicada", tom: "danger" }
      : { rotulo: "rocha", tom: "ok" };
  }
  if (m.instabilidade >= 0.75) return { rotulo: "folha", tom: "neutro" };
  return { rotulo: "intermediário", tom: "neutro" };
}

export default function ArquiteturaPanel() {
  const [dados, setDados] = useState<Relatorio | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ordem, setOrdem] = useState<Ordem>("risco");
  const [filtro, setFiltro] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch("/arquitetura.json")
      .then((r) => {
        if (!r.ok) throw new Error(`relatório não encontrado (${r.status})`);
        return r.json();
      })
      .then((j) => vivo && setDados(j))
      .catch((e) => vivo && setErro(String(e.message ?? e)));
    return () => {
      vivo = false;
    };
  }, []);

  const modulos = useMemo(() => {
    if (!dados) return [];
    const f = filtro.trim().toLowerCase();
    const lista = f ? dados.modulos.filter((m) => m.arquivo.toLowerCase().includes(f)) : dados.modulos;
    const chave = (m: Modulo) =>
      ordem === "instabilidade" ? (m.instabilidade ?? -1) : (m[ordem] as number);
    return [...lista].sort((a, b) => chave(b) - chave(a)).slice(0, 60);
  }, [dados, ordem, filtro]);

  if (erro) {
    return (
      <>
        <PageHeader
          eyebrow="Inteligência"
          title="Leitura arquitetural"
          description="Acoplamento, complexidade e alcance — sem modelo nenhum no caminho."
        />
        <Callout tone="warn" title="Relatório ainda não gerado">
          Rode <code>node scripts/relatorio-arquitetura.mjs . -o apps/web/public/arquitetura.json</code> e
          recarregue. O relatório é um artefato determinístico: mesmo código, mesmos números.
          <br />
          <span style={{ opacity: 0.75 }}>Detalhe: {erro}</span>
        </Callout>
      </>
    );
  }

  if (!dados) {
    return (
      <>
        <PageHeader eyebrow="Inteligência" title="Leitura arquitetural" />
        <p style={{ opacity: 0.7 }}>Carregando o relatório…</p>
      </>
    );
  }

  const t = dados.totais;
  const emCiclo = t.modulosEmCiclo > 0;

  return (
    <>
      <PageHeader
        eyebrow="Inteligência"
        title="Leitura arquitetural"
        description="Quem depende de quem, o que custa mexer, e onde as duas coisas se encontram. Determinístico: mesmo código, mesmos números."
      />

      <DataSection title="O repositório em números">
        <div className="arq-grade">
          <Metrica rotulo="Módulos" valor={num(t.modulos)} nota={`${num(t.linhasDeCodigo)} linhas`} />
          <Metrica rotulo="Funções" valor={num(t.funcoes)} nota={`ciclomática média ${t.ciclomaticaMedia}`} />
          <Metrica
            rotulo="Complexidade cognitiva"
            valor={String(t.cognitivaMedia)}
            nota="média por função — esforço de LER"
          />
          <Metrica rotulo="Arestas internas" valor={num(t.arestasInternas)} nota={`${t.dependenciasExternas} pacotes externos`} />
          <Metrica
            rotulo="Módulos em ciclo"
            valor={num(t.modulosEmCiclo)}
            nota={emCiclo ? "importação circular" : "nenhum"}
            tom={emCiclo ? "danger" : "ok"}
          />
          <Metrica
            rotulo="Módulos órfãos"
            valor={num(t.modulosOrfaos)}
            nota="ninguém importa e não são entrada"
            tom={t.modulosOrfaos > t.modulos / 2 ? "warn" : "neutro"}
          />
        </div>
      </DataSection>

      {dados.ciclos.length > 0 && (
        <DataSection
          title="Importação circular"
          description="O achado arquitetural mais caro e o mais fácil de não enxergar: cada arquivo, olhado sozinho, parece razoável. Só o grafo mostra que eles se seguram em pé mutuamente e nenhum sai sem os outros."
        >
          {dados.ciclos.map((c) => (
            <div key={c.id} className="arq-ciclo">
              <strong>Ciclo {c.id}</strong>
              <span className="arq-ciclo__n">{c.modulos.length} módulos</span>
              <div className="arq-ciclo__lista">
                {c.modulos.map((m, i) => (
                  <span key={m}>
                    <code>{m}</code>
                    {i < c.modulos.length - 1 && <span className="arq-seta"> → </span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </DataSection>
      )}

      <DataSection
        title="Onde mexer custa caro"
        description="Ordenado por risco = complexidade cognitiva × (1 + acoplamento aferente). Complexidade sozinha ordena errado: uma função complicada que ninguém importa custa zero para deixar quieta."
        actions={
          <div className="arq-controles">
            <input
              className="arq-busca"
              type="search"
              placeholder="filtrar por caminho"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              aria-label="Filtrar módulos por caminho"
            />
            <select
              className="arq-ordem"
              value={ordem}
              onChange={(e) => setOrdem(e.target.value as Ordem)}
              aria-label="Ordenar por"
            >
              <option value="risco">Risco</option>
              <option value="ca">Acoplamento aferente (Ca)</option>
              <option value="ce">Acoplamento eferente (Ce)</option>
              <option value="cognitiva">Complexidade cognitiva</option>
              <option value="instabilidade">Instabilidade (I)</option>
            </select>
          </div>
        }
      >
        <div className="arq-rolagem">
          <table className="arq-tabela">
            <thead>
              <tr>
                <th>Módulo</th>
                <th title="Acoplamento aferente: quantos módulos dependem deste">Ca</th>
                <th title="Acoplamento eferente: de quantos módulos este depende">Ce</th>
                <th title="Instabilidade = Ce / (Ca + Ce). 0 é rocha, 1 é folha">I</th>
                <th title="Complexidade cognitiva do arquivo">Cogn.</th>
                <th title="Maior complexidade ciclomática entre as funções">Pior fn</th>
                <th>Linhas</th>
                <th>Risco</th>
                <th>Papel</th>
              </tr>
            </thead>
            <tbody>
              {modulos.map((m) => {
                const p = papel(m);
                return (
                  <tr key={m.arquivo}>
                    <td className="arq-caminho" title={m.arquivo}>
                      {m.arquivo}
                    </td>
                    <td className="arq-num">{m.ca}</td>
                    <td className="arq-num">{m.ce}</td>
                    <td className="arq-num">{m.instabilidade === null ? "—" : m.instabilidade.toFixed(2)}</td>
                    <td className="arq-num">{m.cognitiva}</td>
                    <td className="arq-num">{m.maiorFuncao}</td>
                    <td className="arq-num">{num(m.linhasDeCodigo)}</td>
                    <td className="arq-num arq-risco">{num(Math.round(m.risco))}</td>
                    <td>
                      <span className={`arq-papel arq-papel--${p.tom}`}>{p.rotulo}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {modulos.length === 0 && <p style={{ opacity: 0.7 }}>Nenhum módulo casa com o filtro.</p>}
      </DataSection>

      <Callout tone="neutral" title="Como ler estes números">
        <p>
          <strong>Ca</strong> (aferente) é quanta gente depende deste módulo — alto significa que mexer
          aqui quebra outros. <strong>Ce</strong> (eferente) é de quanta coisa ele depende — alto
          significa que ele quebra fácil quando os outros mudam. <strong>I = Ce/(Ca+Ce)</strong>:
          zero é rocha, um é folha. Nenhuma ponta é errada sozinha; o que é errado é a{" "}
          <em>rocha complicada</em>, porque aí mexer é caro <em>e</em> arriscado.
        </p>
        <p style={{ marginBottom: 0, opacity: 0.8 }}>
          Abstração e a distância da sequência principal são <strong>aproximadas</strong> por contagem
          de exportações só-de-tipo, não por análise do sistema de tipos. Estão no arquivo do
          relatório e ficaram fora desta tabela justamente por serem aproximação — preferimos não
          mostrar do que mostrar sem a ressalva. Relatório gerado em{" "}
          {new Date(dados.geradoEm).toLocaleString("pt-BR")}.
        </p>
      </Callout>
    </>
  );
}

function Metrica({
  rotulo,
  valor,
  nota,
  tom = "neutro",
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  tom?: "neutro" | "ok" | "warn" | "danger";
}) {
  return (
    <div className={`arq-metrica arq-metrica--${tom}`}>
      <span className="arq-metrica__rot">{rotulo}</span>
      <span className="arq-metrica__val">{valor}</span>
      {nota && <span className="arq-metrica__nota">{nota}</span>}
    </div>
  );
}
