import { applyIdf, type FunctionVector } from "./pathContexts.ts";

// ---------------------------------------------------------------------------
// Agrupamento não supervisionado sobre vetores de path-context.
//
// O QUE ISTO ENTREGA — e é importante ser exato, porque a expectativa usual é
// maior do que a realidade:
//
//   NÃO detecta bug. Um agrupamento diz "estas 40 funções são parecidas"; não
//   diz que alguma tem SQL Injection. Não substitui regra determinística e não
//   gera achado sozinho.
//
//   ACHA CLONE que o hash de forma não acha — E ISTO FOI MEDIDO. O
//   `duplication.ts` exige árvore idêntica (clone tipo-2, variável renomeada).
//   A similaridade de vetor alcançou, no próprio repositório:
//     0,959  runOpengrep ~ runSemgrep      (adaptadores copiados)
//     0,953  fingerprint ~ heroFingerprint (mesma lógica em dois pacotes)
//     0,937  stripArea   ~ areaCodigo      (mesma remoção da área do COBOL)
//   Nenhum desses três é clone textual; nenhum seria encontrado pelo hash.
//
//   NÃO DETECTA ANOMALIA — ainda. A intuição de que "função distante de todos
//   os grupos é suspeita" é boa e a literatura a sustenta, mas nesta
//   implementação ela NÃO se confirmou: zero anomalias em 280 unidades reais.
//   Ver o aviso em `detectarAnomalias` antes de usar.
//
// DETERMINISMO: K-Means depende da inicialização. Usar aleatoriedade tornaria
// o resultado diferente a cada execução — inaceitável num gate. A semente é
// derivada dos PRÓPRIOS DADOS (k-means++ com escolha determinística), então
// mesma entrada dá exatamente a mesma saída.
// ---------------------------------------------------------------------------

export interface Cluster {
  centroide: Float64Array;
  membros: number[];
}

export interface ClusterResult {
  clusters: Cluster[];
  /** Índice do cluster de cada item. */
  atribuicao: number[];
  /** Distância de cada item ao seu centroide. */
  distancias: number[];
  iteracoes: number;
}

function distancia(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * Semente determinística no espírito do k-means++.
 *
 * O primeiro centro é o item de MENOR índice (estável). Cada centro seguinte é
 * o item MAIS DISTANTE dos já escolhidos — sem sorteio, empate resolvido pelo
 * índice. É o que troca "resultado bom em média" por "resultado idêntico
 * sempre", que é o requisito aqui.
 */
function sementes(vetores: Float64Array[], k: number): Float64Array[] {
  const centros: Float64Array[] = [vetores[0]!];
  while (centros.length < k) {
    let melhorIdx = -1;
    let melhorDist = -1;
    for (let i = 0; i < vetores.length; i++) {
      let d = Infinity;
      for (const c of centros) d = Math.min(d, distancia(vetores[i]!, c));
      if (d > melhorDist) {
        melhorDist = d;
        melhorIdx = i;
      }
    }
    if (melhorIdx < 0 || melhorDist <= 0) break; // itens idênticos: não há o que separar
    centros.push(vetores[melhorIdx]!);
  }
  return centros;
}

export function kmeans(vetores: Float64Array[], k: number, maxIter = 50): ClusterResult {
  if (vetores.length === 0) {
    return { clusters: [], atribuicao: [], distancias: [], iteracoes: 0 };
  }
  const kReal = Math.max(1, Math.min(k, vetores.length));
  const dim = vetores[0]!.length;
  let centros = sementes(vetores, kReal);

  const atribuicao = new Array<number>(vetores.length).fill(0);
  let iteracoes = 0;

  for (; iteracoes < maxIter; iteracoes++) {
    let mudou = false;
    for (let i = 0; i < vetores.length; i++) {
      let melhor = 0;
      let melhorD = Infinity;
      for (let c = 0; c < centros.length; c++) {
        const d = distancia(vetores[i]!, centros[c]!);
        if (d < melhorD) {
          melhorD = d;
          melhor = c;
        }
      }
      if (atribuicao[i] !== melhor) {
        atribuicao[i] = melhor;
        mudou = true;
      }
    }
    if (!mudou) break;

    const novos: Float64Array[] = [];
    for (let c = 0; c < centros.length; c++) {
      const soma = new Float64Array(dim);
      let n = 0;
      for (let i = 0; i < vetores.length; i++) {
        if (atribuicao[i] !== c) continue;
        for (let d = 0; d < dim; d++) soma[d]! += vetores[i]![d]!;
        n++;
      }
      // Cluster vazio mantém o centro anterior: zerá-lo atrairia tudo.
      if (n === 0) {
        novos.push(centros[c]!);
        continue;
      }
      for (let d = 0; d < dim; d++) soma[d]! /= n;
      novos.push(soma);
    }
    centros = novos;
  }

  const clusters: Cluster[] = centros.map((centroide) => ({ centroide, membros: [] }));
  const distancias = new Array<number>(vetores.length).fill(0);
  for (let i = 0; i < vetores.length; i++) {
    clusters[atribuicao[i]!]!.membros.push(i);
    distancias[i] = distancia(vetores[i]!, centros[atribuicao[i]!]!);
  }
  return { clusters, atribuicao, distancias, iteracoes };
}

export interface Anomalia {
  fn: FunctionVector;
  /** Distância ao centroide POVOADO mais próximo (ver `detectarAnomalias`). */
  distancia: number;
  /** Quantos desvios-padrão acima da média — é o que torna o corte comparável
   *  entre acervos de tamanhos diferentes. */
  zscore: number;
}

/**
 * Funções estruturalmente atípicas.
 *
 * O corte é em DESVIOS-PADRÃO, não em distância absoluta: distância crua
 * depende do acervo, e um limiar fixo reprovaria tudo num repositório homogêneo
 * e nada num heterogêneo.
 *
 * ATENÇÃO — MEDIDO E NÃO ENTREGA SINAL AINDA.
 *
 * Rodado em 280 unidades reais do próprio repositório: ZERO anomalias com
 * vetores sem viés. As 14 que apareciam antes eram artefato do teto de
 * caminhos — todas tinham menos de 100 caminhos enquanto a mediana do acervo
 * era 400 (o próprio teto), ou seja, a medida estava capturando TAMANHO e não
 * atipicidade. Ao remover o viés, o sinal sumiu junto.
 *
 * A causa provável é a maldição da dimensionalidade: em 256 dimensões esparsas
 * as distâncias se concentram e o z-score não separa. O que falta é redução de
 * dimensionalidade de verdade (PCA/SVD) ou um encoder treinado — não mais
 * ajuste de limiar.
 *
 * Fica exportado porque o pipeline está correto e testado, e porque a mesma
 * base serve `paresSimilares`, que ENTREGA. Mas não deve alimentar gate nem
 * relatório enquanto não houver medição que sustente.
 */
export function detectarAnomalias(
  funcoes: FunctionVector[],
  opts: { k?: number; zMin?: number } = {},
): Anomalia[] {
  // Abaixo de ~8 unidades não há distribuição: qualquer uma pareceria atípica.
  if (funcoes.length < 8) return [];

  // Regra prática: k ≈ raiz de n/2, limitado. Serve enquanto não há rótulo para
  // escolher k por método (cotovelo/silhueta) — e é determinística.
  const k = opts.k ?? Math.max(2, Math.min(12, Math.round(Math.sqrt(funcoes.length / 2))));
  const zMin = opts.zMin ?? 2;

  // IDF antes de agrupar: sem isso os caminhos que aparecem em TODA funcao
  // dominam o vetor e o espaco fica sem estrutura (medido: 0 anomalias em 318
  // unidades, distancias todas entre 0,597 e 1,014).
  const vetores = applyIdf(funcoes.map((f) => f.vector));
  const r = kmeans(vetores, k);

  // A MEDIDA NÃO PODE SER "distância ao próprio centroide".
  //
  // O k-means++ escolhe justamente os pontos mais distantes como sementes, então
  // o outlier vira o CENTRO do próprio grupo e sua distância dá ZERO — ele
  // passaria como o mais típico do acervo. Foi o que o teste pegou.
  //
  // A pergunta certa é outra: "quão longe isto está de qualquer padrão
  // ESTABELECIDO?". Padrão estabelecido = grupo com massa. Grupo de um membro
  // só não é padrão, é o próprio caso isolado.
  const minMassa = Math.max(2, Math.floor(funcoes.length * 0.05));
  const povoados = r.clusters.filter((c) => c.membros.length >= minMassa);
  // Acervo sem nenhum grupo com massa (tudo disperso) não tem "normal" contra o
  // que comparar — devolver anomalias ali seria inventar.
  if (povoados.length === 0) return [];

  const distancias = vetores.map((v) => {
    let d = Infinity;
    for (const c of povoados) d = Math.min(d, distancia(v, c.centroide));
    return d;
  });

  const media = distancias.reduce((a, b) => a + b, 0) / distancias.length;
  const variancia =
    distancias.reduce((a, b) => a + (b - media) * (b - media), 0) / distancias.length;
  const desvio = Math.sqrt(variancia);
  if (desvio === 0) return [];

  const out: Anomalia[] = [];
  for (let i = 0; i < funcoes.length; i++) {
    const z = (distancias[i]! - media) / desvio;
    if (z >= zMin) out.push({ fn: funcoes[i]!, distancia: distancias[i]!, zscore: z });
  }
  return out.sort((a, b) => b.zscore - a.zscore);
}

export interface ParSimilar {
  a: FunctionVector;
  b: FunctionVector;
  /** Cosseno entre os vetores (já normalizados em L2). */
  similaridade: number;
}

/**
 * Pares funcionalmente parecidos que o hash de forma NÃO pega.
 *
 * Compara só dentro do mesmo grupo: comparar todos contra todos é quadrático no
 * acervo inteiro, e o agrupamento já separou o que não tem chance.
 */
export function paresSimilares(
  funcoes: FunctionVector[],
  opts: { k?: number; minSimilaridade?: number } = {},
): ParSimilar[] {
  if (funcoes.length < 2) return [];
  const k = opts.k ?? Math.max(2, Math.min(12, Math.round(Math.sqrt(funcoes.length / 2))));
  const min = opts.minSimilaridade ?? 0.9;
  const vetores = applyIdf(funcoes.map((f) => f.vector));
  const r = kmeans(vetores, k);

  const out: ParSimilar[] = [];
  for (const c of r.clusters) {
    for (let i = 0; i < c.membros.length; i++) {
      for (let j = i + 1; j < c.membros.length; j++) {
        const a = funcoes[c.membros[i]!]!;
        const b = funcoes[c.membros[j]!]!;
        // Trecho consigo mesmo não é par.
        if (a.file === b.file && a.startLine === b.startLine) continue;
        // ANINHAMENTO NÃO É DUPLICAÇÃO. Uma função e o callback dentro dela
        // compartilham quase todos os caminhos e apareciam com similaridade
        // 0,97 — o par existe, mas dizer ao usuário "estes dois blocos são
        // duplicados" quando um CONTÉM o outro é ruído.
        if (a.file === b.file && a.startLine <= b.startLine && b.endLine <= a.endLine) continue;
        if (a.file === b.file && b.startLine <= a.startLine && a.endLine <= b.endLine) continue;
        const va = vetores[c.membros[i]!]!;
        const vb = vetores[c.membros[j]!]!;
        let cos = 0;
        for (let d = 0; d < va.length; d++) cos += va[d]! * vb[d]!;
        if (cos >= min) out.push({ a, b, similaridade: cos });
      }
    }
  }
  return out.sort((x, y) => y.similaridade - x.similaridade);
}
