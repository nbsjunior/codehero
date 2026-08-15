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
  somaCa: number;
  somaCe: number;
  classes: number;
  metodos: number;
  funcoesLivres: number;
  paragrafos: number;
  procedimentos: number;
};

const LABEL_LANG: Record<string, string> = {
  java: "Java",
  cobol: "COBOL",
  typescript: "TypeScript",
  tsx: "TSX",
  javascript: "JavaScript",
  python: "Python",
  csharp: "C#",
  go: "Go",
  tsql: "T-SQL",
  sqlpl: "SQL PL",
  desconhecida: "Desconhecida",
};

function nomeLang(id: string): string {
  return LABEL_LANG[id.toLowerCase()] ?? id;
}

const COR_MI = (mi: number) =>
  mi < 10 ? "var(--rating-e)" : mi < 20 ? "var(--rating-d)" : mi < 40 ? "var(--rating-c)" : "var(--rating-a)";

const faixa = (mi: number) => (mi < 10 ? "crítico" : mi < 20 ? "atenção" : mi < 40 ? "aceitável" : "bom");

function emptyAcc(linguagem: string): AccLang {
  return {
    linguagem,
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
    somaCa: 0,
    somaCe: 0,
    classes: 0,
    metodos: 0,
    funcoesLivres: 0,
    paragrafos: 0,
    procedimentos: 0,
  };
}

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

  const { porLinguagem, pioresMi, topRisco, faixaMi, reposComArq, totaisQ } = useMemo(() => {
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
    const totaisQ = {
      loc: 0,
      funcoes: 0,
      classes: 0,
      metodos: 0,
      paragrafos: 0,
      procedimentos: 0,
      funcoesLivres: 0,
      ca: 0,
      ce: 0,
      modulos: 0,
    };

    for (const p of projects) {
      for (const r of p.repos) {
        if (!isArquitetura(r.arquitetura)) continue;
        const a = r.arquitetura;
        if ((a.totais?.modulos ?? 0) <= 0 && !(a.porLinguagem?.length)) continue;
        reposComArq += 1;

        for (const l of a.porLinguagem ?? []) {
          const cur = acc.get(l.linguagem) ?? emptyAcc(l.linguagem);
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
          if (l.caTotal != null || l.caMedia != null) {
            cur.somaCa += l.caTotal ?? (l.caMedia ?? 0) * l.modulos;
            cur.somaCe += l.ceTotal ?? (l.ceMedia ?? 0) * l.modulos;
          }
          cur.classes += l.classes ?? 0;
          cur.metodos += l.metodos ?? 0;
          cur.funcoesLivres += l.funcoesLivres ?? 0;
          cur.paragrafos += l.paragrafos ?? 0;
          cur.procedimentos += l.procedimentos ?? 0;
          acc.set(l.linguagem, cur);
        }

        const langsComCa = new Set(
          (a.porLinguagem ?? [])
            .filter((l) => l.caTotal != null || l.caMedia != null)
            .map((l) => l.linguagem),
        );

        for (const m of a.modulos ?? []) {
          const lang = m.linguagem || "desconhecida";
          if (!acc.has(lang)) {
            const cur = emptyAcc(lang);
            cur.modulos += 1;
            cur.linhasDeCodigo += m.linhasDeCodigo || 0;
            cur.funcoes += 0;
            if (typeof m.mi === "number") {
              const peso = Math.max(m.linhasDeCodigo, 1);
              cur.somaMi += m.mi * peso;
              cur.pesoLoc += peso;
            }
            acc.set(lang, cur);
          }
          if (!langsComCa.has(lang)) {
            const cur = acc.get(lang)!;
            cur.somaCa += m.ca;
            cur.somaCe += m.ce;
          }

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

        totaisQ.loc += a.totais?.linhasDeCodigo ?? 0;
        totaisQ.funcoes += a.totais?.funcoes ?? 0;
        totaisQ.modulos += a.totais?.modulos ?? 0;
      }
    }

    for (const c of acc.values()) {
      totaisQ.classes += c.classes;
      totaisQ.metodos += c.metodos;
      totaisQ.paragrafos += c.paragrafos;
      totaisQ.procedimentos += c.procedimentos;
      totaisQ.funcoesLivres += c.funcoesLivres;
      totaisQ.ca += c.somaCa;
      totaisQ.ce += c.somaCe;
    }

    const porLinguagem = [...acc.values()]
      .map((c) => ({
        linguagem: c.linguagem,
        label: nomeLang(c.linguagem),
        modulos: c.modulos,
        linhasDeCodigo: c.linhasDeCodigo,
        funcoes: c.funcoes,
        mi: c.pesoLoc > 0 ? Math.round((c.somaMi / c.pesoLoc) * 10) / 10 : 0,
        ciclomaticaMedia: c.funcoes > 0 ? Math.round((c.somaCiclo / c.funcoes) * 10) / 10 : 0,
        cognitivaMedia: c.funcoes > 0 ? Math.round((c.somaCog / c.funcoes) * 10) / 10 : 0,
        densidadeComentario: c.pesoLoc > 0 ? Math.round((c.somaComent / c.pesoLoc) * 10) / 10 : 0,
        modulosEmAtencao: c.modulosEmAtencao,
        modulosCriticos: c.modulosCriticos,
        caMedia: c.modulos > 0 ? Math.round((c.somaCa / c.modulos) * 10) / 10 : 0,
        ceMedia: c.modulos > 0 ? Math.round((c.somaCe / c.modulos) * 10) / 10 : 0,
        caTotal: Math.round(c.somaCa * 10) / 10,
        ceTotal: Math.round(c.somaCe * 10) / 10,
        classes: c.classes,
        metodos: c.metodos,
        funcoesLivres: c.funcoesLivres,
        paragrafos: c.paragrafos,
        procedimentos: c.procedimentos,
      }))
      .sort((a, b) => b.linhasDeCodigo - a.linhasDeCodigo);

    return {
      porLinguagem,
      pioresMi: pioresMi.sort((a, b) => a.mi - b.mi).slice(0, 15),
      topRisco: topRisco.sort((a, b) => b.risco - a.risco).slice(0, 12),
      faixaMi,
      reposComArq,
      totaisQ,
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
              label="Linhas de código"
              value={totaisQ.loc.toLocaleString("pt-BR")}
              sub={`${totaisQ.modulos.toLocaleString("pt-BR")} módulos`}
            />
            <KpiCard
              label="Unidades (fn/mét/par)"
              value={totaisQ.funcoes.toLocaleString("pt-BR")}
              sub={
                [
                  totaisQ.classes ? `${totaisQ.classes} classes` : null,
                  totaisQ.metodos ? `${totaisQ.metodos} métodos` : null,
                  totaisQ.paragrafos ? `${totaisQ.paragrafos} parágrafos` : null,
                  totaisQ.funcoesLivres ? `${totaisQ.funcoesLivres} fn livres` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "todas as linguagens"
              }
            />
            <KpiCard
              label="Ca · Ce (totais)"
              value={`${Math.round(totaisQ.ca)} · ${Math.round(totaisQ.ce)}`}
              sub="aferente · eferente (Martin)"
            />
            <KpiCard
              label="Cognitiva · ciclomática"
              value={`${arq.cognitivaMedia || "—"} · ${arq.ciclomaticaMedia || "—"}`}
              sub="médias ponderadas"
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
              title="Quantitativo por linguagem"
              description="Java, COBOL, TypeScript e demais — LOC, MI, acoplamento aferente (Ca) e eferente (Ce), classes, métodos, funções e parágrafos. Linguagem anotada pelo parser, não pela extensão."
            >
              <div
                style={{
                  display: "grid",
                  gap: "1.25rem",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  marginBottom: "1rem",
                }}
              >
                <div className="ch-metric-card">
                  <h3>LOC por linguagem</h3>
                  <VerticalBars
                    data={porLinguagem.map((l) => ({
                      label: l.label,
                      value: l.linhasDeCodigo,
                      color: "#388bfd",
                    }))}
                    maxBars={12}
                  />
                </div>
                <div className="ch-metric-card">
                  <h3>Índice MI</h3>
                  <VerticalBars
                    data={porLinguagem.map((l) => ({
                      label: l.label,
                      value: l.mi,
                      color: COR_MI(l.mi),
                    }))}
                    maxBars={12}
                  />
                </div>
                <div className="ch-metric-card">
                  <h3>Ca médio (aferente)</h3>
                  <VerticalBars
                    data={porLinguagem.map((l) => ({
                      label: l.label,
                      value: l.caMedia,
                      color: "#d29922",
                    }))}
                    maxBars={12}
                  />
                </div>
                <div className="ch-metric-card">
                  <h3>Ce médio (eferente)</h3>
                  <VerticalBars
                    data={porLinguagem.map((l) => ({
                      label: l.label,
                      value: l.ceMedia,
                      color: "#a371f7",
                    }))}
                    maxBars={12}
                  />
                </div>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table className="arq-tabela" style={{ minWidth: 1100 }}>
                  <thead>
                    <tr>
                      <th>Linguagem</th>
                      <th title="Linhas de código">LOC</th>
                      <th title="Índice de manutenibilidade 0–100">MI</th>
                      <th>Faixa</th>
                      <th title="Acoplamento aferente médio — quem depende deste módulo">Ca</th>
                      <th title="Acoplamento eferente médio — de quem este módulo depende">Ce</th>
                      <th>Módulos</th>
                      <th title="Classes / interfaces / records (0 em COBOL)">Classes</th>
                      <th title="Métodos de classe (Java, C#, TS…)">Métodos</th>
                      <th title="Funções livres / top-level">Fn livres</th>
                      <th title="Parágrafos COBOL">Parágrafos</th>
                      <th title="Procedures SQL">Procs</th>
                      <th title="Total de unidades medidas (fn+métodos+parágrafos)">Unidades</th>
                      <th>Ciclo.</th>
                      <th>Cogn.</th>
                      <th>Atenção</th>
                      <th>Crítico</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porLinguagem.map((l) => (
                      <tr key={l.linguagem}>
                        <td style={{ fontWeight: 600 }}>{l.label}</td>
                        <td className="arq-num">{l.linhasDeCodigo.toLocaleString("pt-BR")}</td>
                        <td className="arq-num" style={{ color: COR_MI(l.mi), fontWeight: 600 }}>
                          {l.mi}
                        </td>
                        <td>
                          <span className="hero-badge" style={{ background: COR_MI(l.mi), color: "#fff" }}>
                            {faixa(l.mi)}
                          </span>
                        </td>
                        <td className="arq-num">{l.caMedia}</td>
                        <td className="arq-num">{l.ceMedia}</td>
                        <td className="arq-num">{l.modulos}</td>
                        <td className="arq-num">{l.classes || "—"}</td>
                        <td className="arq-num">{l.metodos || "—"}</td>
                        <td className="arq-num">{l.funcoesLivres || "—"}</td>
                        <td className="arq-num">{l.paragrafos || "—"}</td>
                        <td className="arq-num">{l.procedimentos || "—"}</td>
                        <td className="arq-num">{l.funcoes}</td>
                        <td className="arq-num">{l.ciclomaticaMedia}</td>
                        <td className="arq-num">{l.cognitivaMedia}</td>
                        <td className="arq-num">{l.modulosEmAtencao}</td>
                        <td className="arq-num">{l.modulosCriticos}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="hero-caption" style={{ marginTop: "0.75rem" }}>
                Em COBOL, “unidades” são parágrafos; em Java/C#/TS, classes + métodos; em JavaScript/Python,
                funções. Ca/Ce seguem Robert Martin (1994). Classes/métodos/parágrafos detalhados exigem scan
                com o medidor atualizado.
              </p>
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
          <strong>MI</strong> (0–100):{" "}
          <code>max(0, (171 − 5.2·ln(V) − 0.23·G − 16.2·ln(LOC)) · 100/171)</code> por função/método/parágrafo,
          agregado por linha. <strong>Ca</strong> = aferente (quem depende de mim); <strong>Ce</strong> =
          eferente (de quem eu dependo).
        </p>
        <p style={{ marginBottom: 0, opacity: 0.9 }}>
          Vale para <strong>Java</strong> (classes + métodos), <strong>COBOL</strong> (parágrafos), TypeScript,
          JavaScript, Python, C#, Go e SQL. Cada linguagem usa a gramática do parser — não a extensão do
          arquivo.
        </p>
      </Callout>
    </>
  );
}
