"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { Callout, DataSection, KpiCard, KpiGroup, PageHeader } from "@/components/AdminUi";
import { TimeSeriesChart, VerticalBars, type TimeSeriesPoint } from "@/components/RepoHealthCharts";
import { dbClient } from "@/lib/firebaseDb";
import type { AdminProjectRow } from "@/lib/api";

// ---------------------------------------------------------------------------
// Manutenibilidade: o índice, por linguagem, com histórico.
//
// O que este numero e, exatamente
// ---------------------------------------------------------------------------
// Indice de Manutenibilidade na escala 0–100 da Microsoft:
//
//   MI = max(0, (171 − 5.2·ln(V) − 0.23·G − 16.2·ln(LOC)) · 100/171)
//
// com V = volume de Halstead, G = complexidade ciclomatica, LOC = linhas.
// Calculado POR FUNÇÃO e agregado por linha, que e a unidade que o Visual
// Studio usa. Calcular por arquivo daria outro numero com o mesmo nome, e o
// time nao conseguiria comparar com o que ja viu em outra ferramenta.
//
// Por que separado por LINGUAGEM ANOTADA
// ---------------------------------------------------------------------------
// Nao por extensao: `.ts` e `.tsx` sao gramaticas diferentes, e a de
// TypeScript REJEITA sintaxe JSX. Juntar as duas esconderia que metade do
// codigo passou por outro analisador — e, medido neste repositorio, esconderia
// tambem que o TSX tem quase metade do indice do TypeScript.
//
// De onde vem cada metade
// ---------------------------------------------------------------------------
//   ponto no tempo  do relatorio arquitetural gravado no repo pelo scan
//   historico       de `analyticsDaily`, que ja acumula desde antes disto
//
// O historico mostra debito e achados, nao MI: o indice comecou a ser gravado
// agora e nao existe retroativo. Dizer "sem dados" e melhor que desenhar uma
// linha reta inventada.
// ---------------------------------------------------------------------------

type Props = { projects: AdminProjectRow[]; isPlatformAdmin: boolean };

type LinhaLinguagem = {
  linguagem: string;
  modulos: number;
  linhasDeCodigo: number;
  funcoes: number;
  mi: number;
  ciclomaticaMedia: number;
  cognitivaMedia: number;
  densidadeComentario: number;
  modulosEmAtencao: number;
  modulosCriticos: number;
};

const COR_MI = (mi: number) =>
  mi < 10 ? "var(--rating-e)" : mi < 20 ? "var(--rating-d)" : mi < 40 ? "var(--rating-c)" : "var(--rating-a)";

const faixa = (mi: number) => (mi < 10 ? "crítico" : mi < 20 ? "atenção" : mi < 40 ? "aceitável" : "bom");

export default function ManutenibilidadePanel({ projects, isPlatformAdmin }: Props) {
  const [serie, setSerie] = useState<TimeSeriesPoint[]>([]);
  const [serieErro, setSerieErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  // --- histórico ------------------------------------------------------------
  useEffect(() => {
    if (!isPlatformAdmin) {
      setCarregando(false);
      return;
    }
    let vivo = true;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(dbClient, "analyticsDaily"), orderBy("__name__", "desc"), limit(60)),
        );
        const pts: TimeSeriesPoint[] = [];
        snap.forEach((d) => {
          const v = d.data() as Record<string, number>;
          const loc = Number(v.linesOfCode) || 0;
          const debito = Number(v.debtMinutes) || 0;
          pts.push({
            t: Date.parse(d.id),
            label: d.id.slice(5), // MM-DD
            values: {
              // Débito por mil linhas: débito cru sobe junto com o tamanho do
              // portfólio e não diz se a qualidade piorou. Normalizado, diz.
              debitoPorKloc: loc > 0 ? Math.round((debito / (loc / 1000)) * 10) / 10 : 0,
              achados: Number(v.findings) || 0,
              builds: Number(v.builds) || 0,
            },
          });
        });
        pts.sort((a, b) => a.t - b.t);
        if (vivo) setSerie(pts.filter((p) => Number.isFinite(p.t)));
      } catch (e) {
        if (vivo) setSerieErro(e instanceof Error ? e.message : String(e));
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [isPlatformAdmin]);

  // --- ponto no tempo, do relatório gravado por repositório ------------------
  const { porLinguagem, reposComLeitura, piores, totais } = useMemo(() => {
    const acc = new Map<string, LinhaLinguagem & { somaMi: number; peso: number }>();
    const piores: Array<{ repo: string; arquivo: string; linguagem: string; mi: number; pior: number | null }> = [];
    let repos = 0;
    let modulos = 0;
    let linhas = 0;
    let funcoes = 0;
    let somaMiGeral = 0;
    let pesoGeral = 0;

    for (const p of projects) {
      for (const r of p.repos) {
        const a = r.arquitetura as
          | { porLinguagem?: LinhaLinguagem[]; modulos?: Array<Record<string, unknown>>; totais?: Record<string, number> }
          | null
          | undefined;
        if (!a?.porLinguagem?.length) continue;
        repos++;
        for (const l of a.porLinguagem) {
          const cur =
            acc.get(l.linguagem) ??
            acc
              .set(l.linguagem, {
                ...l,
                modulos: 0,
                linhasDeCodigo: 0,
                funcoes: 0,
                modulosEmAtencao: 0,
                modulosCriticos: 0,
                somaMi: 0,
                peso: 0,
              })
              .get(l.linguagem)!;
          cur.modulos += l.modulos;
          cur.linhasDeCodigo += l.linhasDeCodigo;
          cur.funcoes += l.funcoes;
          cur.modulosEmAtencao += l.modulosEmAtencao;
          cur.modulosCriticos += l.modulosCriticos;
          // Ponderação por linha em toda soma: um repositório de dez arquivos
          // não pode pesar igual a um de mil.
          const peso = Math.max(l.linhasDeCodigo, 1);
          cur.somaMi += l.mi * peso;
          cur.peso += peso;
          somaMiGeral += l.mi * peso;
          pesoGeral += peso;
          modulos += l.modulos;
          linhas += l.linhasDeCodigo;
          funcoes += l.funcoes;
        }
        for (const m of a.modulos ?? []) {
          const mi = typeof m.mi === "number" ? m.mi : null;
          if (mi === null) continue;
          piores.push({
            repo: r.name,
            arquivo: String(m.arquivo ?? ""),
            linguagem: String(m.linguagem ?? "—"),
            mi,
            pior: typeof m.piorFuncaoMi === "number" ? m.piorFuncaoMi : null,
          });
        }
      }
    }

    const linhasLang = [...acc.values()]
      .map((c) => ({ ...c, mi: c.peso > 0 ? Math.round((c.somaMi / c.peso) * 10) / 10 : 0 }))
      .sort((a, b) => b.linhasDeCodigo - a.linhasDeCodigo);

    return {
      porLinguagem: linhasLang,
      reposComLeitura: repos,
      piores: piores.sort((a, b) => a.mi - b.mi).slice(0, 15),
      totais: {
        modulos,
        linhas,
        funcoes,
        mi: pesoGeral > 0 ? Math.round((somaMiGeral / pesoGeral) * 10) / 10 : 0,
        atencao: linhasLang.reduce((s, l) => s + l.modulosEmAtencao, 0),
        criticos: linhasLang.reduce((s, l) => s + l.modulosCriticos, 0),
      },
    };
  }, [projects]);

  return (
    <>
      <PageHeader
        eyebrow="Inteligência"
        title="Manutenibilidade"
        description="Índice 0–100 por função, agregado por linguagem anotada, com o histórico da plataforma. Determinístico: mesmo código, mesmo número."
      />

      {reposComLeitura === 0 ? (
        <Callout tone="neutral" title="Nenhum repositório com índice ainda">
          O índice sai do mesmo scan do grafo, com métricas ligadas. Repositórios analisados antes desta
          versão só passam a mostrar o dado no próximo scan.
        </Callout>
      ) : (
        <>
          <KpiGroup>
            <KpiCard
              label="Índice geral"
              value={String(totais.mi)}
              sub={faixa(totais.mi)}
              tone={totais.mi < 20 ? "danger" : totais.mi < 40 ? "warn" : "ok"}
            />
            <KpiCard label="Linguagens" value={porLinguagem.length} sub="anotadas pelo parser" />
            <KpiCard label="Módulos" value={totais.modulos.toLocaleString("pt-BR")} />
            <KpiCard label="Funções" value={totais.funcoes.toLocaleString("pt-BR")} />
            <KpiCard
              label="Em atenção"
              value={totais.atencao}
              sub="índice entre 10 e 20"
              tone={totais.atencao > 0 ? "warn" : "ok"}
            />
            <KpiCard
              label="Críticos"
              value={totais.criticos}
              sub="índice abaixo de 10"
              tone={totais.criticos > 0 ? "danger" : "ok"}
            />
          </KpiGroup>

          <DataSection
            title="Índice por linguagem"
            description="Separado pela linguagem que o parser anotou, não pela extensão do arquivo. TypeScript e TSX são gramáticas diferentes — a de TypeScript rejeita sintaxe JSX — e juntá-las esconderia que metade do código passou por outro analisador."
          >
            <div
              style={{
                display: "grid",
                gap: "1.25rem",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              }}
            >
              <div className="ch-metric-card">
                <h3>Índice médio</h3>
                <VerticalBars
                  data={porLinguagem.map((l) => ({
                    label: l.linguagem,
                    value: l.mi,
                    color: COR_MI(l.mi),
                  }))}
                  maxBars={10}
                />
              </div>
              <div className="ch-metric-card">
                <h3>Volume de código</h3>
                <VerticalBars
                  data={porLinguagem.map((l) => ({ label: l.linguagem, value: l.linhasDeCodigo }))}
                  maxBars={10}
                />
              </div>
              <div className="ch-metric-card">
                <h3>Densidade de comentário</h3>
                <VerticalBars
                  data={porLinguagem.map((l) => ({ label: l.linguagem, value: l.densidadeComentario }))}
                  maxBars={10}
                />
              </div>
            </div>

            <div style={{ overflowX: "auto", marginTop: "1rem" }}>
              <table className="arq-tabela">
                <thead>
                  <tr>
                    <th>Linguagem</th>
                    <th>Índice</th>
                    <th>Faixa</th>
                    <th>Módulos</th>
                    <th>Linhas</th>
                    <th>Funções</th>
                    <th title="Complexidade ciclomática média por função">Ciclo.</th>
                    <th title="Complexidade cognitiva média por função">Cogn.</th>
                    <th title="Linhas de comentário sobre linhas de código">Coment.</th>
                    <th>Atenção</th>
                    <th>Crítico</th>
                  </tr>
                </thead>
                <tbody>
                  {porLinguagem.map((l) => (
                    <tr key={l.linguagem}>
                      <td style={{ fontWeight: 600 }}>{l.linguagem}</td>
                      <td className="arq-num" style={{ color: COR_MI(l.mi), fontWeight: 600 }}>
                        {l.mi}
                      </td>
                      <td>
                        <span className="hero-badge" style={{ background: COR_MI(l.mi), color: "#fff" }}>
                          {faixa(l.mi)}
                        </span>
                      </td>
                      <td className="arq-num">{l.modulos}</td>
                      <td className="arq-num">{l.linhasDeCodigo.toLocaleString("pt-BR")}</td>
                      <td className="arq-num">{l.funcoes.toLocaleString("pt-BR")}</td>
                      <td className="arq-num">{l.ciclomaticaMedia}</td>
                      <td className="arq-num">{l.cognitivaMedia}</td>
                      <td className="arq-num">{l.densidadeComentario}%</td>
                      <td className="arq-num">{l.modulosEmAtencao}</td>
                      <td className="arq-num">{l.modulosCriticos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataSection>

          <DataSection
            title="Módulos com o menor índice"
            description="A coluna 'pior função' costuma ser o alarme de verdade: um arquivo com índice razoável na média pode esconder uma função sozinha em zero, e é ela que trava a manutenção."
          >
            <div style={{ overflowX: "auto" }}>
              <table className="arq-tabela">
                <thead>
                  <tr>
                    <th>Repositório</th>
                    <th>Módulo</th>
                    <th>Linguagem</th>
                    <th>Índice</th>
                    <th>Pior função</th>
                  </tr>
                </thead>
                <tbody>
                  {piores.map((m) => (
                    <tr key={`${m.repo}-${m.arquivo}`}>
                      <td>{m.repo}</td>
                      <td className="arq-caminho" title={m.arquivo}>
                        {m.arquivo}
                      </td>
                      <td>{m.linguagem}</td>
                      <td className="arq-num" style={{ color: COR_MI(m.mi), fontWeight: 600 }}>
                        {m.mi}
                      </td>
                      <td
                        className="arq-num"
                        style={m.pior !== null ? { color: COR_MI(m.pior), fontWeight: 600 } : undefined}
                      >
                        {m.pior === null ? "—" : m.pior}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataSection>
        </>
      )}

      <DataSection
        title="Histórico da plataforma"
        description="Débito por mil linhas, achados e builds por dia. Débito cru sobe junto com o tamanho do portfólio e não diz se a qualidade piorou; normalizado por linha, diz."
      >
        {!isPlatformAdmin ? (
          <Callout tone="neutral" title="Histórico restrito">
            A série diária é agregada da plataforma inteira e só o administrador consegue lê-la.
          </Callout>
        ) : carregando ? (
          <p className="hero-caption">Carregando o histórico…</p>
        ) : serieErro ? (
          <Callout tone="warn" title="Histórico indisponível">
            {serieErro}
          </Callout>
        ) : (
          <>
            <TimeSeriesChart
              points={serie}
              series={[
                { key: "debitoPorKloc", label: "Débito / KLOC (min)", color: "var(--rating-d)" },
                { key: "achados", label: "Achados", color: "#388bfd" },
                { key: "builds", label: "Builds", color: "var(--rating-a)" },
              ]}
              height={220}
            />
            <p className="hero-caption" style={{ marginTop: "0.75rem" }}>
              O histórico mostra débito e achados, não o índice: ele passou a ser gravado agora e não
              existe retroativo. Desenhar uma linha reta para trás seria inventar dado.
            </p>
          </>
        )}
      </DataSection>

      <Callout tone="neutral" title="Como o índice é calculado">
        <p style={{ marginTop: 0 }}>
          <code>MI = max(0, (171 − 5.2·ln(V) − 0.23·G − 16.2·ln(LOC)) · 100/171)</code>, com V = volume
          de Halstead, G = complexidade ciclomática e LOC = linhas. É a variante 0–100 da Microsoft, a
          mesma que o Visual Studio mostra.
        </p>
        <p style={{ marginBottom: 0, opacity: 0.85 }}>
          Calculado <strong>por função</strong> e agregado por linha, não sobre o arquivo inteiro. O
          termo <code>16.2·ln(LOC)</code> sozinho vale mais de cem pontos num arquivo de novecentas
          linhas: no cálculo por arquivo, todo arquivo grande dá zero, inclusive um bem organizado em
          funções pequenas. Faixas: abaixo de 10 crítico, até 20 atenção, até 40 aceitável.
        </p>
      </Callout>
    </>
  );
}
