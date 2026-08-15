"use client";

import { useEffect, useMemo, useState } from "react";
import { Callout, DataSection, KpiCard, KpiGroup, PageHeader } from "@/components/AdminUi";
import { TimeSeriesChart, VerticalBars } from "@/components/RepoHealthCharts";
import type { AdminProjectRow, ArquiteturaRepoSummary } from "@/lib/api";
import {
  aggregateArquitetura,
  aggregateCodeGraphs,
  analyticsDailyToGatePoints,
  buildPortfolioTimeSeries,
  loadPlatformAnalyticsDaily,
  loadWorkspaceAnalysisHistory,
  type PortfolioHistorySeries,
} from "@/lib/workspaceInsights";

/**
 * Dashboard de manutenibilidade baseado no grafo (arquitetura + code-graph).
 *
 * Quantitativo: LOC, funções, módulos, arestas, ciclos, órfãos, MI, ciclomática,
 * cognitiva, fan-in, hops.
 * Qualitativo: faixas de MI, risco (complexidade × alcance), ciclos de importação,
 * exposição até entrypoint, hotspots.
 */

type Props = { projects: AdminProjectRow[]; isPlatformAdmin: boolean };

type AccLang = {
  linguagem: string;
  modulos: number;
  linhasDeCodigo: number;
  funcoes: number;
  modulosEmAtencao: number;
  modulosCriticos: number;
  somaMi: number;
  somaCiclo: number;
  somaCog: number;
  somaComent: number;
  pesoLoc: number;
};

const COR_MI = (mi: number) =>
  mi < 10 ? "var(--rating-e)" : mi < 20 ? "var(--rating-d)" : mi < 40 ? "var(--rating-c)" : "var(--rating-a)";

const faixa = (mi: number) => (mi < 10 ? "crítico" : mi < 20 ? "atenção" : mi < 40 ? "aceitável" : "bom");

function isArquitetura(a: unknown): a is ArquiteturaRepoSummary {
  return !!a && typeof a === "object" && !!(a as ArquiteturaRepoSummary).totais;
}

export default function ManutenibilidadePanel({ projects, isPlatformAdmin }: Props) {
  const [history, setHistory] = useState<PortfolioHistorySeries | null>(null);
  const [platformPts, setPlatformPts] = useState<
    Array<{ t: number; label: string; values: Record<string, number> }>
  >([]);
  const [loadingHist, setLoadingHist] = useState(true);
  const [histError, setHistError] = useState<string | null>(null);

  const projectKey = useMemo(
    () =>
      projects
        .map((p) => `${p.orgId}/${p.projectId}:${p.repos.map((r) => r.repoId).join(",")}`)
        .join("|"),
    [projects],
  );

  useEffect(() => {
    if (projects.length === 0) {
      setHistory(null);
      setLoadingHist(false);
      return;
    }
    let cancelled = false;
    setLoadingHist(true);
    setHistError(null);
    const tasks: Promise<void>[] = [
      loadWorkspaceAnalysisHistory(projects)
        .then((byRepo) => {
          if (!cancelled) setHistory(buildPortfolioTimeSeries(byRepo));
        })
        .catch((e) => {
          if (!cancelled) setHistError(e instanceof Error ? e.message : String(e));
        }),
    ];
    if (isPlatformAdmin) {
      tasks.push(
        loadPlatformAnalyticsDaily(45)
          .then((rows) => {
            if (!cancelled) setPlatformPts(analyticsDailyToGatePoints(rows));
          })
          .catch(() => {
            if (!cancelled) setPlatformPts([]);
          }),
      );
    }
    Promise.all(tasks).finally(() => {
      if (!cancelled) setLoadingHist(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projectKey, projects, isPlatformAdmin]);

  const arq = useMemo(() => aggregateArquitetura(projects), [projects]);
  const graph = useMemo(() => aggregateCodeGraphs(projects), [projects]);

  const { porLinguagem, pioresMi, topRisco, faixaMi, reposComArq } = useMemo(() => {
    const acc = new Map<string, AccLang>();
    const pioresMi: Array<{
      repo: string;
      arquivo: string;
      linguagem: string;
      mi: number;
      pior: number | null;
    }> = [];
    const topRisco: Array<{
      repo: string;
      arquivo: string;
      risco: number;
      cognitiva: number;
      ca: number;
      ce: number;
      mi: number | null;
    }> = [];
    const faixaMi = { critico: 0, atencao: 0, aceitavel: 0, bom: 0, semMi: 0 };
    let reposComArq = 0;

    for (const p of projects) {
      for (const r of p.repos) {
        if (!isArquitetura(r.arquitetura)) continue;
        const a = r.arquitetura;
        if ((a.totais?.modulos ?? 0) <= 0 && !(a.porLinguagem?.length)) continue;
        reposComArq += 1;

        for (const l of a.porLinguagem ?? []) {
          const cur = acc.get(l.linguagem) ?? {
            linguagem: l.linguagem,
            modulos: 0,
            linhasDeCodigo: 0,
            funcoes: 0,
            modulosEmAtencao: 0,
            modulosCriticos: 0,
            somaMi: 0,
            somaCiclo: 0,
            somaCog: 0,
            somaComent: 0,
            pesoLoc: 0,
          };
          const pesoLoc = Math.max(l.linhasDeCodigo, 1);
          const pesoFn = Math.max(l.funcoes, 1);
          cur.modulos += l.modulos;
          cur.linhasDeCodigo += l.linhasDeCodigo;
          cur.funcoes += l.funcoes;
          cur.modulosEmAtencao += l.modulosEmAtencao;
          cur.modulosCriticos += l.modulosCriticos;
          cur.somaMi += l.mi * pesoLoc;
          cur.somaCiclo += l.ciclomaticaMedia * pesoFn;
          cur.somaCog += l.cognitivaMedia * pesoFn;
          cur.somaComent += l.densidadeComentario * pesoLoc;
          cur.pesoLoc += pesoLoc;
          acc.set(l.linguagem, cur);
        }

        for (const m of a.modulos ?? []) {
          const mi = typeof m.mi === "number" ? m.mi : null;
          if (mi == null) faixaMi.semMi += 1;
          else if (mi < 10) faixaMi.critico += 1;
          else if (mi < 20) faixaMi.atencao += 1;
          else if (mi < 40) faixaMi.aceitavel += 1;
          else faixaMi.bom += 1;

          if (mi != null) {
            pioresMi.push({
              repo: r.name,
              arquivo: m.arquivo,
              linguagem: m.linguagem ?? "—",
              mi,
              pior: typeof m.piorFuncaoMi === "number" ? m.piorFuncaoMi : null,
            });
          }
          topRisco.push({
            repo: r.name,
            arquivo: m.arquivo,
            risco: m.risco,
            cognitiva: m.cognitiva,
            ca: m.ca,
            ce: m.ce,
            mi,
          });
        }
      }
    }

    const porLinguagem = [...acc.values()]
      .map((c) => ({
        linguagem: c.linguagem,
        modulos: c.modulos,
        linhasDeCodigo: c.linhasDeCodigo,
        funcoes: c.funcoes,
        mi: c.pesoLoc > 0 ? Math.round((c.somaMi / c.pesoLoc) * 10) / 10 : 0,
        ciclomaticaMedia: c.funcoes > 0 ? Math.round((c.somaCiclo / c.funcoes) * 10) / 10 : 0,
        cognitivaMedia: c.funcoes > 0 ? Math.round((c.somaCog / c.funcoes) * 10) / 10 : 0,
        densidadeComentario: c.pesoLoc > 0 ? Math.round((c.somaComent / c.pesoLoc) * 10) / 10 : 0,
        modulosEmAtencao: c.modulosEmAtencao,
        modulosCriticos: c.modulosCriticos,
      }))
      .sort((a, b) => b.linhasDeCodigo - a.linhasDeCodigo);

    return {
      porLinguagem,
      pioresMi: pioresMi.sort((a, b) => a.mi - b.mi).slice(0, 15),
      topRisco: topRisco.sort((a, b) => b.risco - a.risco).slice(0, 12),
      faixaMi,
      reposComArq,
    };
  }, [projects]);

  const miGeral = useMemo(() => {
    if (porLinguagem.length === 0) return null;
    let soma = 0;
    let peso = 0;
    for (const l of porLinguagem) {
      const w = Math.max(l.linhasDeCodigo, 1);
      soma += l.mi * w;
      peso += w;
    }
    return peso > 0 ? Math.round((soma / peso) * 10) / 10 : null;
  }, [porLinguagem]);

  const hopRows = useMemo(() => {
    const labels: Record<string, string> = {
      entry: "Entry (0)",
      hop1: "1 hop",
      hop2: "2 hops",
      hop3plus: "3+ hops",
      unknown: "Sem caminho",
    };
    const colors: Record<string, string> = {
      entry: "#3fb950",
      hop1: "#58a6ff",
      hop2: "#d29922",
      hop3plus: "#db6d28",
      unknown: "#8b949e",
    };
    return (["entry", "hop1", "hop2", "hop3plus", "unknown"] as const)
      .map((k) => ({ label: labels[k]!, value: graph.hopBuckets[k], color: colors[k] }))
      .filter((r) => r.value > 0);
  }, [graph]);

  const temGrafo = graph.reposWithGraph > 0 || reposComArq > 0;

  const complexitySeries = [
    { key: "cognitivaMedia", label: "Cognitiva média", color: "#a371f7" },
    { key: "ciclomaticaMedia", label: "Ciclomática média", color: "#388bfd" },
    { key: "modulosEmCiclo", label: "Módulos em ciclo", color: "#f85149" },
    { key: "maxFanIn", label: "Fan-in máx.", color: "#db6d28" },
  ];
  const smellSeries = [
    { key: "debtHours", label: "Débito (h)", color: "#db6d28" },
    { key: "findingsTotal", label: "Findings", color: "#8b949e" },
  ];
  const graphSizeSeries = [
    { key: "functions", label: "Funções", color: "#388bfd" },
    { key: "calls", label: "Calls", color: "#a371f7" },
    { key: "edges", label: "Arestas", color: "#3fb950" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Inteligência"
        title="Manutenibilidade"
        description="Dashboard do grafo: índice MI, acoplamento, complexidade e exposição — quantitativo e qualitativo, sem Gen AI."
      />

      {!temGrafo ? (
        <Callout tone="neutral" title="Ainda sem leitura de grafo nesta amostra">
          Rode o scan com métricas (plugin, Action ou CI). O mesmo pipeline grava code-graph e
          arquitetura; depois disso os painéis abaixo se preenchem. Repos analisados antes da correção
          do ingest precisam de um novo scan para trazer MI por linguagem.
        </Callout>
      ) : (
        <>
          <KpiGroup>
            <KpiCard
              label="Índice MI"
              value={miGeral != null ? String(miGeral) : "—"}
              sub={miGeral != null ? faixa(miGeral) : "aguardando scan com MI"}
              tone={
                miGeral == null ? undefined : miGeral < 20 ? "danger" : miGeral < 40 ? "warn" : "ok"
              }
            />
            <KpiCard
              label="Cognitiva média"
              value={arq.cognitivaMedia || "—"}
              sub="ponderada por função"
            />
            <KpiCard
              label="Ciclomática média"
              value={arq.ciclomaticaMedia || "—"}
              sub="ponderada por função"
            />
            <KpiCard
              label="Módulos · funções"
              value={`${arq.modulos.toLocaleString("pt-BR")} · ${arq.funcoes.toLocaleString("pt-BR")}`}
              sub={`${arq.linhasDeCodigo.toLocaleString("pt-BR")} LOC`}
            />
            <KpiCard
              label="Em ciclo · órfãos"
              value={`${arq.modulosEmCiclo} · ${arq.modulosOrfaos}`}
              tone={arq.modulosEmCiclo > 0 ? "warn" : "ok"}
              sub="circular · sem uso"
            />
            <KpiCard
              label="Grafo (fn · calls)"
              value={`${graph.functions.toLocaleString("pt-BR")} · ${graph.calls.toLocaleString("pt-BR")}`}
              sub={`${graph.reposWithGraph}/${graph.repoCount} repos`}
            />
          </KpiGroup>

          <div
            style={{
              display: "grid",
              gap: "1.25rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              margin: "1.25rem 0",
            }}
          >
            <DataSection title="Faixas de MI (módulos)" description="Qualidade estrutural por arquivo">
              <VerticalBars
                data={[
                  { label: "Crítico (<10)", value: faixaMi.critico, color: "var(--rating-e)" },
                  { label: "Atenção (10–20)", value: faixaMi.atencao, color: "var(--rating-d)" },
                  { label: "Aceitável (20–40)", value: faixaMi.aceitavel, color: "var(--rating-c)" },
                  { label: "Bom (≥40)", value: faixaMi.bom, color: "var(--rating-a)" },
                  ...(faixaMi.semMi > 0
                    ? [{ label: "Sem MI (scan antigo)", value: faixaMi.semMi, color: "#8b949e" }]
                    : []),
                ]}
                maxBars={5}
              />
            </DataSection>
            <DataSection title="Composição do grafo" description="Funções, calls, imports, entries">
              <VerticalBars data={graph.composition} maxBars={4} />
            </DataSection>
            <DataSection title="Exposição até entrypoint" description="Proximidade dos hotspots ao mundo externo">
              {hopRows.length === 0 ? (
                <p className="hero-caption">Sem hotspots com hops medidos.</p>
              ) : (
                <VerticalBars data={hopRows} maxBars={5} />
              )}
            </DataSection>
            <DataSection title="Acoplamento" description="Arestas e dependências do grafo de módulos">
              <VerticalBars
                data={[
                  { label: "Arestas internas", value: arq.arestasInternas, color: "#388bfd" },
                  { label: "Deps externas", value: arq.dependenciasExternas, color: "#d29922" },
                  { label: "Módulos em ciclo", value: arq.modulosEmCiclo, color: "#f85149" },
                  { label: "Órfãos", value: arq.modulosOrfaos, color: "#8b949e" },
                ]}
                maxBars={4}
              />
            </DataSection>
          </div>

          {porLinguagem.length > 0 ? (
            <DataSection
              title="Índice por linguagem"
              description="Linguagem anotada pelo parser (TypeScript ≠ TSX). MI ponderado por LOC."
            >
              <div
                style={{
                  display: "grid",
                  gap: "1.25rem",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                }}
              >
                <div className="ch-metric-card">
                  <h3>MI médio</h3>
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
                  <h3>Volume (LOC)</h3>
                  <VerticalBars
                    data={porLinguagem.map((l) => ({ label: l.linguagem, value: l.linhasDeCodigo }))}
                    maxBars={10}
                  />
                </div>
                <div className="ch-metric-card">
                  <h3>Complexidade cognitiva</h3>
                  <VerticalBars
                    data={porLinguagem.map((l) => ({
                      label: l.linguagem,
                      value: l.cognitivaMedia,
                      color: "#a371f7",
                    }))}
                    maxBars={10}
                  />
                </div>
              </div>

              <div style={{ overflowX: "auto", marginTop: "1rem" }}>
                <table className="arq-tabela">
                  <thead>
                    <tr>
                      <th>Linguagem</th>
                      <th>MI</th>
                      <th>Faixa</th>
                      <th>Módulos</th>
                      <th>LOC</th>
                      <th>Funções</th>
                      <th>Ciclo.</th>
                      <th>Cogn.</th>
                      <th>Coment.</th>
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
                        <td className="arq-num">{l.funcoes}</td>
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
          ) : (
            <Callout tone="neutral" title="Índice por linguagem ainda não gravado">
              Há grafo/arquitetura em {reposComArq} repo(s), mas <code>porLinguagem</code> / MI só
              persistem após um novo scan (o ingest antigo descartava esses campos). Acoplamento, risco e
              exposição acima já usam o que está disponível.
            </Callout>
          )}

          <div
            style={{
              display: "grid",
              gap: "1.25rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              marginTop: "0.5rem",
            }}
          >
            <DataSection
              title="Maior risco (complexidade × alcance)"
              description="Onde mexer custa caro — cognitiva cruzada com Ca/Ce"
            >
              {topRisco.length === 0 ? (
                <p className="hero-caption">Sem módulos de risco na amostra.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="arq-tabela" style={{ minWidth: 480 }}>
                    <thead>
                      <tr>
                        <th>Repo</th>
                        <th>Módulo</th>
                        <th>Risco</th>
                        <th>Ca/Ce</th>
                        <th>Cogn.</th>
                        <th>MI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topRisco.map((m) => (
                        <tr key={`${m.repo}-${m.arquivo}`}>
                          <td>{m.repo}</td>
                          <td className="arq-caminho" title={m.arquivo}>
                            {m.arquivo}
                          </td>
                          <td className="arq-num" style={{ fontWeight: 700 }}>
                            {m.risco}
                          </td>
                          <td className="arq-num">
                            {m.ca}/{m.ce}
                          </td>
                          <td className="arq-num">{m.cognitiva}</td>
                          <td
                            className="arq-num"
                            style={m.mi != null ? { color: COR_MI(m.mi), fontWeight: 600 } : undefined}
                          >
                            {m.mi ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DataSection>

            <DataSection
              title="Menor índice MI"
              description="Arquivo frágil; 'pior função' é o gargalo real"
            >
              {pioresMi.length === 0 ? (
                <p className="hero-caption">Sem MI por módulo — rode um scan novo para popular.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="arq-tabela" style={{ minWidth: 480 }}>
                    <thead>
                      <tr>
                        <th>Repo</th>
                        <th>Módulo</th>
                        <th>Lang</th>
                        <th>MI</th>
                        <th>Pior fn</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pioresMi.map((m) => (
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
                            style={m.pior != null ? { color: COR_MI(m.pior), fontWeight: 600 } : undefined}
                          >
                            {m.pior ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DataSection>
          </div>

          {arq.ciclos.length > 0 && (
            <DataSection
              title="Ciclos de importação"
              description="Componentes fortemente conexos — extrair um módulo exige os outros"
            >
              <ul style={{ margin: 0, paddingLeft: "1.1rem", display: "grid", gap: "0.45rem" }}>
                {arq.ciclos.map((c) => (
                  <li key={`${c.repoName}-${c.id}`}>
                    <strong>{c.repoName}</strong>
                    <span className="hero-caption"> · ciclo #{c.id}: </span>
                    <code style={{ fontSize: "0.78rem" }}>{c.modulos.join(" → ")}</code>
                  </li>
                ))}
              </ul>
            </DataSection>
          )}

          {graph.hotspots.length > 0 && (
            <DataSection title="Hotspots de fan-in" description="Funções mais chamadas no code-graph">
              <VerticalBars
                data={graph.hotspots.slice(0, 10).map((h) => ({
                  label: `${h.name} (${h.repoName})`,
                  value: h.fanIn,
                  color: "#db6d28",
                }))}
                maxBars={10}
              />
            </DataSection>
          )}
        </>
      )}

      <DataSection
        title="Evolução no tempo"
        description="Séries a partir das analyses do workspace. Débito, complexidade e tamanho do grafo."
      >
        {loadingHist ? (
          <p className="hero-caption">Carregando histórico de analyses…</p>
        ) : histError ? (
          <Callout tone="warn" title="Histórico indisponível">
            {histError}
          </Callout>
        ) : !history || history.complexityPoints.length === 0 ? (
          <Callout tone="neutral" title="Sem série temporal ainda">
            Cada analysis sincronizada vira um ponto. Rode scans ao longo do tempo para ver se
            cognitiva, ciclos e débito sobem ou descem.
          </Callout>
        ) : (
          <div
            style={{
              display: "grid",
              gap: "1.25rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            }}
          >
            <div className="ch-metric-card">
              <h3>Complexidade e ciclos</h3>
              <TimeSeriesChart points={history.complexityPoints} series={complexitySeries} />
            </div>
            <div className="ch-metric-card">
              <h3>Débito e findings</h3>
              <TimeSeriesChart points={history.smellPoints} series={smellSeries} />
            </div>
            <div className="ch-metric-card" style={{ gridColumn: "1 / -1" }}>
              <h3>Tamanho do grafo</h3>
              <TimeSeriesChart points={history.complexityPoints} series={graphSizeSeries} height={160} />
            </div>
          </div>
        )}
      </DataSection>

      {isPlatformAdmin && platformPts.length > 0 && (
        <DataSection
          title="Rollup da plataforma (analyticsDaily)"
          description="Builds e gate no agregado global — sobrevive ao purge de analyses."
        >
          <TimeSeriesChart
            points={platformPts}
            series={[
              { key: "buildsDay", label: "Builds", color: "#8b949e" },
              { key: "buildsFailedDay", label: "Gate FAIL", color: "#f85149" },
              { key: "debtHours", label: "Débito (h)", color: "#db6d28" },
            ]}
            height={180}
          />
        </DataSection>
      )}

      <Callout tone="neutral" title="Como ler estes números">
        <p style={{ marginTop: 0 }}>
          <strong>MI</strong> (0–100, Microsoft/Visual Studio):{" "}
          <code>max(0, (171 − 5.2·ln(V) − 0.23·G − 16.2·ln(LOC)) · 100/171)</code> por função,
          agregado por linha. Faixas: &lt;10 crítico, &lt;20 atenção, &lt;40 aceitável.
        </p>
        <p style={{ marginBottom: 0, opacity: 0.9 }}>
          <strong>Risco</strong> = complexidade cognitiva × alcance no grafo de módulos.{" "}
          <strong>Fan-in / hops</strong> vêm do code-graph de funções. As duas metades não se
          substituem.
        </p>
      </Callout>
    </>
  );
}
