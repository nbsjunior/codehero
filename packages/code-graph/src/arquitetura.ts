import type { CodeGraphDocument } from "./types.ts";

// ---------------------------------------------------------------------------
// Leitura ARQUITETURAL do repositório, determinística.
//
// A pergunta que isto responde
// ---------------------------------------------------------------------------
// Relatório de complexidade sozinho não decide nada. "Esta função tem
// ciclomática 34" é verdade e é inútil: se ninguém depende dela, o custo de
// deixá-la quieta é zero.
//
// O que muda a decisão é complexidade CRUZADA com alcance. Uma função
// complicada que quarenta módulos importam é onde toda mudança dói e todo
// defeito se espalha. É o mesmo dado, lido com a informação que o grafo tem e
// o medidor de complexidade não tem.
//
// As métricas, e de onde vêm
// ---------------------------------------------------------------------------
// Acoplamento aferente (Ca) e eferente (Ce) são de Robert Martin, 1994.
//
//   Ca  quantos módulos internos dependem DESTE. Alto = mudar aqui é caro,
//       porque quebra gente.
//   Ce  de quantos módulos internos ESTE depende. Alto = ele quebra fácil,
//       porque tem muita coisa embaixo.
//   I   instabilidade, Ce/(Ca+Ce). Zero é rocha: todo mundo usa, ele não usa
//       ninguém. Um é folha: usa todo mundo, ninguém usa ele.
//
// Nenhuma das duas pontas é errada por si. O que é errado é a rocha ser
// complicada, porque aí mexer nela é caro E arriscado ao mesmo tempo.
//
// Abstração é APROXIMADA e está dito
// ---------------------------------------------------------------------------
// A métrica de Martin pede abstratividade (A) para calcular a distância da
// sequência principal. Em TypeScript isso exigiria resolver o sistema de
// tipos. Aqui A é aproximada pela razão entre declarações exportadas que são
// só de tipo (`interface`, `type`) e o total de exportações. É uma
// aproximação de contagem, não de semântica, e o relatório a marca como tal.
// Preferi aproximar e avisar a omitir uma leitura que ajuda.
// ---------------------------------------------------------------------------

/** Complexidade de um arquivo, vinda do medidor estrutural do engine. */
export interface MetricaDeArquivo {
  linhasDeCodigo: number;
  ciclomatica: number;
  cognitiva: number;
  funcoes: number;
  /** Maior ciclomática entre as funções do arquivo. */
  maiorFuncao: number;
  /** Exportações só-de-tipo e total, para a aproximação de abstratividade. */
  exportacoesDeTipo?: number;
  exportacoesTotais?: number;
  /** Linguagem anotada pelo parser estrutural. */
  linguagem?: string;
  /** Volume de Halstead do arquivo. */
  halsteadVolume?: number;
  /** Indice de Manutenibilidade 0-100, media das funcoes ponderada por linha. */
  mi?: number;
  /**
   * Menor MI entre as funcoes — o gargalo real do arquivo.
   *
   * `null` quando o arquivo nao tem funcao nenhuma (dado, configuracao). Nao e
   * a mesma coisa que zero: zero seria "tem uma funcao terrivel", e ausencia
   * de funcao nao e isso.
   */
  piorFuncaoMi?: number | null;
  /** Linhas de comentario, para a densidade por linguagem. */
  comentarios?: number;
}

export interface ModuloArquitetura {
  arquivo: string;
  ca: number;
  ce: number;
  /** Dependências externas distintas (pacotes de fora do repositório). */
  externas: number;
  /** Ce/(Ca+Ce). `null` quando o módulo não tem aresta interna nenhuma. */
  instabilidade: number | null;
  /** Aproximada por contagem de exportações. `null` quando não há exportação. */
  abstracao: number | null;
  /** |A + I − 1|. Zero fica na sequência principal. `null` sem A ou I. */
  distanciaDaSequencia: number | null;
  linhasDeCodigo: number;
  ciclomatica: number;
  cognitiva: number;
  funcoes: number;
  maiorFuncao: number;
  /** Complexidade cognitiva × alcance. É o número que ordena o trabalho. */
  risco: number;
  /** Índice do ciclo a que pertence, quando pertence a algum. */
  ciclo: number | null;
  /** Linguagem anotada. */
  linguagem: string;
  /** Indice de Manutenibilidade do arquivo. */
  mi: number | null;
  /** Menor MI entre as funcoes do arquivo. */
  piorFuncaoMi: number | null;
}

export interface RelatorioArquitetura {
  versao: 1;
  geradoEm: string;
  raiz: string;
  totais: {
    modulos: number;
    linhasDeCodigo: number;
    funcoes: number;
    /** Média de ciclomática POR FUNÇÃO, não por arquivo. */
    ciclomaticaMedia: number;
    cognitivaMedia: number;
    arestasInternas: number;
    dependenciasExternas: number;
    modulosEmCiclo: number;
    /** Módulos que ninguém importa e que não são entrada. Candidatos a morto. */
    modulosOrfaos: number;
  };
  modulos: ModuloArquitetura[];
  /** Componentes fortemente conexos com mais de um módulo. */
  ciclos: Array<{ id: number; modulos: string[] }>;
  /**
   * Uma linha por linguagem ANOTADA pelo parser — não por extensão de arquivo.
   *
   * A distinção importa: `.ts` e `.tsx` são gramáticas diferentes (a de
   * TypeScript REJEITA sintaxe JSX), e um relatório que os junta esconde que
   * metade do código passou por outro analisador. Aqui cada linguagem aparece
   * com o que o parser dela realmente conseguiu ler.
   */
  porLinguagem: Array<{
    linguagem: string;
    modulos: number;
    linhasDeCodigo: number;
    funcoes: number;
    /** Média PONDERADA POR LINHA. Média simples deixaria um utilitário de dez
     *  linhas pesar igual a um módulo de mil. */
    mi: number;
    ciclomaticaMedia: number;
    cognitivaMedia: number;
    /** Comentários sobre linhas de código, em pontos percentuais. */
    densidadeComentario: number;
    /** Módulos abaixo de 20 de MI — a faixa de atenção da convenção. */
    modulosEmAtencao: number;
    /** Módulos abaixo de 10 — a faixa vermelha. */
    modulosCriticos: number;
  }>;
}

const round = (n: number, casas = 3) => Number(n.toFixed(casas));

/**
 * Componentes fortemente conexos (Tarjan), sobre as arestas internas.
 *
 * Ciclo de importação é o achado arquitetural mais caro que existe e o mais
 * fácil de não enxergar: cada arquivo do ciclo, olhado sozinho, parece
 * razoável. Só o grafo mostra que os três se seguram em pé mutuamente e que
 * nenhum deles pode ser extraído sem os outros.
 */
function componentesFortes(
  nos: string[],
  saindo: Map<string, Set<string>>,
): string[][] {
  const indice = new Map<string, number>();
  const menor = new Map<string, number>();
  const naPilha = new Set<string>();
  const pilha: string[] = [];
  const saida: string[][] = [];
  let contador = 0;

  // Iterativo de propósito: repositório grande estoura a pilha de chamadas do
  // Node na versão recursiva, e o relatório morreria justamente nos casos em
  // que ele mais serve.
  for (const raiz of nos) {
    if (indice.has(raiz)) continue;
    const trabalho: Array<{ no: string; vizinhos: string[]; i: number }> = [
      { no: raiz, vizinhos: [...(saindo.get(raiz) ?? [])], i: 0 },
    ];
    indice.set(raiz, contador);
    menor.set(raiz, contador);
    contador++;
    pilha.push(raiz);
    naPilha.add(raiz);

    while (trabalho.length) {
      const topo = trabalho[trabalho.length - 1]!;
      if (topo.i < topo.vizinhos.length) {
        const v = topo.vizinhos[topo.i++]!;
        if (!indice.has(v)) {
          indice.set(v, contador);
          menor.set(v, contador);
          contador++;
          pilha.push(v);
          naPilha.add(v);
          trabalho.push({ no: v, vizinhos: [...(saindo.get(v) ?? [])], i: 0 });
        } else if (naPilha.has(v)) {
          menor.set(topo.no, Math.min(menor.get(topo.no)!, indice.get(v)!));
        }
        continue;
      }
      trabalho.pop();
      const pai = trabalho[trabalho.length - 1];
      if (pai) menor.set(pai.no, Math.min(menor.get(pai.no)!, menor.get(topo.no)!));
      if (menor.get(topo.no) === indice.get(topo.no)) {
        const comp: string[] = [];
        for (;;) {
          const w = pilha.pop()!;
          naPilha.delete(w);
          comp.push(w);
          if (w === topo.no) break;
        }
        saida.push(comp);
      }
    }
  }
  return saida;
}

export function analisarArquitetura(
  doc: CodeGraphDocument,
  metricas: Map<string, MetricaDeArquivo>,
): RelatorioArquitetura {
  // --- arestas internas de importação -------------------------------------
  const importa = new Map<string, Set<string>>(); // arquivo -> arquivos internos
  const importadoPor = new Map<string, Set<string>>();
  const externas = new Map<string, Set<string>>();

  const arquivoDoNo = new Map<string, string>();
  for (const n of doc.nodes) if (n.kind === "file" && n.file) arquivoDoNo.set(n.id, n.file);

  for (const e of doc.edges) {
    if (e.kind !== "imports") continue;
    const de = arquivoDoNo.get(e.from);
    if (!de) continue;
    if (e.resolved === "user") {
      const para = arquivoDoNo.get(e.to);
      if (!para || para === de) continue; // auto-import não é acoplamento
      (importa.get(de) ?? importa.set(de, new Set()).get(de)!).add(para);
      (importadoPor.get(para) ?? importadoPor.set(para, new Set()).get(para)!).add(de);
    } else {
      const nome = doc.nodes.find((x) => x.id === e.to)?.name ?? e.to;
      (externas.get(de) ?? externas.set(de, new Set()).get(de)!).add(nome);
    }
  }

  const arquivos = [...new Set([...metricas.keys(), ...arquivoDoNo.values()])].filter(Boolean).sort();

  // --- ciclos --------------------------------------------------------------
  const ciclos = componentesFortes(arquivos, importa)
    .filter((c) => c.length > 1)
    .map((c, i) => ({ id: i + 1, modulos: c.sort() }));
  const cicloDe = new Map<string, number>();
  for (const c of ciclos) for (const m of c.modulos) cicloDe.set(m, c.id);

  // --- módulos -------------------------------------------------------------
  const entradas = new Set(
    doc.nodes.filter((n) => n.entry).map((n) => n.file).filter(Boolean),
  );

  const modulos: ModuloArquitetura[] = arquivos.map((f) => {
    const ca = importadoPor.get(f)?.size ?? 0;
    const ce = importa.get(f)?.size ?? 0;
    const m = metricas.get(f);
    const instabilidade = ca + ce > 0 ? round(ce / (ca + ce)) : null;
    const tot = m?.exportacoesTotais ?? 0;
    const abstracao = tot > 0 ? round((m?.exportacoesDeTipo ?? 0) / tot) : null;
    const dist =
      instabilidade !== null && abstracao !== null
        ? round(Math.abs(abstracao + instabilidade - 1))
        : null;

    // Risco: o que dói mexer E quebra gente quando quebra. Cognitiva porque é
    // a que mede o esforço de LER, que é o que a pessoa vai fazer antes de
    // mexer. `1 + ca` para que um módulo complicado sem dependentes ainda
    // apareça, só bem abaixo.
    const cognitiva = m?.cognitiva ?? 0;
    const risco = round(cognitiva * (1 + ca), 1);

    return {
      arquivo: f,
      ca,
      ce,
      externas: externas.get(f)?.size ?? 0,
      instabilidade,
      abstracao,
      distanciaDaSequencia: dist,
      linhasDeCodigo: m?.linhasDeCodigo ?? 0,
      ciclomatica: m?.ciclomatica ?? 0,
      cognitiva,
      funcoes: m?.funcoes ?? 0,
      maiorFuncao: m?.maiorFuncao ?? 0,
      risco,
      ciclo: cicloDe.get(f) ?? null,
      linguagem: m?.linguagem ?? "desconhecida",
      mi: typeof m?.mi === "number" ? m.mi : null,
      piorFuncaoMi: typeof m?.piorFuncaoMi === "number" ? m.piorFuncaoMi : null,
    };
  });

  modulos.sort((a, b) => b.risco - a.risco);

  const somaFuncoes = modulos.reduce((a, m) => a + m.funcoes, 0);
  const somaCiclo = modulos.reduce((a, m) => a + m.ciclomatica, 0);
  const somaCogn = modulos.reduce((a, m) => a + m.cognitiva, 0);
  const todasExternas = new Set<string>();
  for (const s of externas.values()) for (const x of s) todasExternas.add(x);

  return {
    versao: 1,
    geradoEm: new Date().toISOString(),
    raiz: doc.root,
    totais: {
      modulos: modulos.length,
      linhasDeCodigo: modulos.reduce((a, m) => a + m.linhasDeCodigo, 0),
      funcoes: somaFuncoes,
      ciclomaticaMedia: somaFuncoes ? round(somaCiclo / somaFuncoes, 1) : 0,
      cognitivaMedia: somaFuncoes ? round(somaCogn / somaFuncoes, 1) : 0,
      arestasInternas: [...importa.values()].reduce((a, s) => a + s.size, 0),
      dependenciasExternas: todasExternas.size,
      modulosEmCiclo: cicloDe.size,
      modulosOrfaos: modulos.filter(
        (m) => m.ca === 0 && !entradas.has(m.arquivo) && m.linhasDeCodigo > 0,
      ).length,
    },
    modulos,
    ciclos,
    porLinguagem: agregarPorLinguagem(modulos, metricas),
  };
}

function agregarPorLinguagem(
  modulos: ModuloArquitetura[],
  metricas: Map<string, MetricaDeArquivo>,
): RelatorioArquitetura["porLinguagem"] {
  const por = new Map<
    string,
    {
      modulos: number;
      linhas: number;
      funcoes: number;
      comentarios: number;
      somaMi: number;
      pesoMi: number;
      somaCiclo: number;
      somaCogn: number;
      atencao: number;
      criticos: number;
    }
  >();

  for (const m of modulos) {
    const met = metricas.get(m.arquivo);
    const lang = m.linguagem || "desconhecida";
    const a =
      por.get(lang) ??
      por
        .set(lang, {
          modulos: 0,
          linhas: 0,
          funcoes: 0,
          comentarios: 0,
          somaMi: 0,
          pesoMi: 0,
          somaCiclo: 0,
          somaCogn: 0,
          atencao: 0,
          criticos: 0,
        })
        .get(lang)!;

    a.modulos++;
    a.linhas += m.linhasDeCodigo;
    a.funcoes += m.funcoes;
    a.comentarios += met?.comentarios ?? 0;
    a.somaCiclo += m.ciclomatica;
    a.somaCogn += m.cognitiva;
    if (m.mi !== null) {
      // Peso = linhas. Média simples deixaria um utilitário de dez linhas
      // pesar igual a um módulo de mil, e o índice da linguagem passaria a
      // descrever a quantidade de arquivinhos, não a saúde do código.
      const peso = Math.max(m.linhasDeCodigo, 1);
      a.somaMi += m.mi * peso;
      a.pesoMi += peso;
      if (m.mi < 10) a.criticos++;
      else if (m.mi < 20) a.atencao++;
    }
  }

  const r1 = (n: number) => Math.round(n * 10) / 10;
  return [...por.entries()]
    .map(([linguagem, a]) => ({
      linguagem,
      modulos: a.modulos,
      linhasDeCodigo: a.linhas,
      funcoes: a.funcoes,
      mi: a.pesoMi > 0 ? r1(a.somaMi / a.pesoMi) : 0,
      ciclomaticaMedia: a.funcoes ? r1(a.somaCiclo / a.funcoes) : 0,
      cognitivaMedia: a.funcoes ? r1(a.somaCogn / a.funcoes) : 0,
      densidadeComentario: a.linhas ? r1((a.comentarios * 100) / a.linhas) : 0,
      modulosEmAtencao: a.atencao,
      modulosCriticos: a.criticos,
    }))
    .sort((x, y) => y.linhasDeCodigo - x.linhasDeCodigo);
}
