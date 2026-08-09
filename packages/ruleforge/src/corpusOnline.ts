import type { HeroRule } from "@codehero/contracts";
import type { CorpusCase } from "./types.ts";
import {
  rotularPorAcordo,
  estadoVazio,
  qualidadeDosVotantes,
  DECAIMENTO_PADRAO,
  type EstadoSupervisao,
  type CandidatoVotado,
  type Voto,
} from "./supervisaoFraca.ts";
import { recortarFluxo } from "./avaliarCaso.ts";
import {
  montarContexto,
  normalizarTrecho,
  VOTANTES_DETERMINISTICOS,
  type Candidato,
  type Votante,
} from "./votantes.ts";

// ---------------------------------------------------------------------------
// Indução ONLINE de corpus a partir do código que está sendo analisado.
//
// O ciclo
// ---------------------------------------------------------------------------
//   1. o scanner analisa arquivos e produz apontamentos;
//   2. cada apontamento vira um CANDIDATO a caso de corpus;
//   3. os votantes opinam, cada um olhando uma evidência diferente;
//   4. o EM estima confiabilidade de votante e probabilidade de cada rótulo,
//      partindo do que aprendeu nas rodadas anteriores;
//   5. só o que passa de um limiar alto de confiança vira caso;
//   6. o avaliador determinístico de sempre julga a regra com esses casos.
//
// O passo 4 é o online: o estado dos votantes é persistido e volta na próxima
// execução, depreciado. O sistema aprende com o código que analisa, sem que
// ninguém rotule nada.
//
// O limite honesto deste método, que precisa estar escrito
// ---------------------------------------------------------------------------
// Caso induzido com `expected: "match"` é quase tautológico PARA A REGRA QUE O
// GEROU: o trecho está ali porque ela casou nele, então ela vai casar de novo.
// Serve como guarda de regressão e serve para OUTRAS regras, e não serve como
// prova de que a regra acerta.
//
// O valor discriminante está nos casos `no_match`: trechos em que a regra
// casou e o acordo entre votantes diz que ela não deveria. Esses sim apertam a
// regra, e é por eles que o veredito é calculado.
// ---------------------------------------------------------------------------

/** Apontamento cru vindo do scanner, no mínimo que este módulo precisa. */
export interface AchadoBruto {
  ruleId: string;
  linha: number;
  colunaInicio: number;
  colunaFim: number;
  trecho: string;
  motor: "pattern" | "ast" | "taint";
  temCaminhoDeTaint: boolean;
}

export interface ArquivoAnalisado {
  caminho: string;
  fonte: string;
  achados: AchadoBruto[];
}

export interface VeredictoRegra {
  ruleId: string;
  candidatos: number;
  confirmados: number;
  refutados: number;
  incertos: number;
  /** Confirmados sobre o que teve veredito. `null` quando não houve nenhum. */
  precisaoInduzida: number | null;
  veredito: "aprovar" | "revisar" | "quarentena" | "sem-evidencia";
  porque: string;
}

export interface ResultadoInducao {
  casos: CorpusCase[];
  vereditos: VeredictoRegra[];
  estado: EstadoSupervisao;
  votantes: ReturnType<typeof qualidadeDosVotantes>;
  candidatosTotais: number;
  iteracoes: number;
}

export interface OpcoesInducao {
  estadoAnterior?: EstadoSupervisao;
  decaimento?: number;
  /** Acima disto o candidato vira caso `match`. */
  limiarAlto?: number;
  /** Abaixo disto vira caso `no_match`. */
  limiarBaixo?: number;
  /** Mínimo de votantes que opinaram para o rótulo valer. */
  minVotantes?: number;
  /** Mínimo de candidatos para arriscar um veredito sobre a regra. */
  minCandidatos?: number;
  votantesExtras?: Votante[];
}

// Limiares altos de propósito. Um caso de corpus errado é pior que caso
// nenhum: ele passa a REPROVAR a versão correta da regra para sempre, e
// ninguém desconfia do corpus, todo mundo desconfia da regra.
const LIMIAR_ALTO = 0.9;
const LIMIAR_BAIXO = 0.1;
const MIN_VOTANTES = 2;
const MIN_CANDIDATOS = 5;

export function induzirCorpus(
  arquivos: ArquivoAnalisado[],
  regras: HeroRule[],
  opts: OpcoesInducao = {},
): ResultadoInducao {
  const limiarAlto = opts.limiarAlto ?? LIMIAR_ALTO;
  const limiarBaixo = opts.limiarBaixo ?? LIMIAR_BAIXO;
  const minVotantes = opts.minVotantes ?? MIN_VOTANTES;
  const minCandidatos = opts.minCandidatos ?? MIN_CANDIDATOS;
  const votantes = [...VOTANTES_DETERMINISTICOS, ...(opts.votantesExtras ?? [])];
  const porId = new Map(regras.map((r) => [r.id, r]));

  // --- frequência de forma no projeto INTEIRO ---------------------------
  // Precisa varrer tudo antes de votar: raridade é propriedade do projeto,
  // não do arquivo. Medida por arquivo, todo trecho pareceria raro.
  const frequencia = new Map<string, number>();
  for (const a of arquivos) {
    for (const l of a.fonte.split(/\r?\n/)) {
      const t = l.trim();
      if (!t) continue;
      const k = normalizarTrecho(t);
      frequencia.set(k, (frequencia.get(k) ?? 0) + 1);
    }
  }

  // --- candidatos e votos ------------------------------------------------
  // Linhas por arquivo, para recortar o caminho do fluxo sem reler nada.
  const linhasPorArquivo = new Map<string, string[]>();
  for (const a of arquivos) linhasPorArquivo.set(a.caminho, a.fonte.split(/\r?\n/));

  const candidatos: Candidato[] = [];
  const votados: CandidatoVotado[] = [];

  for (const arq of arquivos) {
    const achadosDoArquivo = arq.achados.map((a) => ({
      ruleId: a.ruleId,
      linha: a.linha,
      cwe: porId.get(a.ruleId)?.cwe ?? [],
    }));
    const ctx = montarContexto(arq.caminho, arq.fonte, achadosDoArquivo, frequencia);

    for (const a of arq.achados) {
      const regra = porId.get(a.ruleId);
      if (!regra) continue;
      const cand: Candidato = {
        id: `${arq.caminho}:${a.linha}:${a.ruleId}`,
        ruleId: a.ruleId,
        arquivo: arq.caminho,
        linha: a.linha,
        colunaInicio: a.colunaInicio,
        colunaFim: a.colunaFim,
        trecho: a.trecho,
        motor: a.motor,
        temCaminhoDeTaint: a.temCaminhoDeTaint,
      };
      const votos: Record<string, Voto> = {};
      for (const v of votantes) {
        let voto: Voto = null;
        try {
          voto = v.votar(cand, ctx, regra);
        } catch {
          // Votante que quebra ABSTÉM. Derrubar a indução inteira porque um
          // sinal opcional falhou seria trocar robustez por nada.
          voto = null;
        }
        votos[v.nome] = voto;
      }
      candidatos.push(cand);
      votados.push({ id: cand.id, votos });
    }
  }

  // --- rotulagem não supervisionada --------------------------------------
  const r = rotularPorAcordo(
    votados,
    opts.estadoAnterior ?? estadoVazio(),
    opts.decaimento ?? DECAIMENTO_PADRAO,
  );
  const prob = new Map(r.rotulos.map((l) => [l.id, l]));

  // --- casos e vereditos --------------------------------------------------
  const casos: CorpusCase[] = [];
  const porRegra = new Map<string, { conf: number; ref: number; inc: number; total: number }>();

  for (const c of candidatos) {
    const l = prob.get(c.id);
    const acc = porRegra.get(c.ruleId) ?? { conf: 0, ref: 0, inc: 0, total: 0 };
    acc.total++;
    porRegra.set(c.ruleId, acc);
    if (!l || l.votantesQueOpinaram < minVotantes) {
      acc.inc++;
      continue;
    }
    // Apontamento de fluxo carrega o CAMINHO, não a linha. A linha do uso
    // final, sozinha, não reproduz o defeito nem para o motor que o encontrou.
    const ehFluxo = c.motor === "taint" && c.temCaminhoDeTaint;
    const linhasArq = linhasPorArquivo.get(c.arquivo) ?? [];
    const corpo = ehFluxo
      ? recortarFluxo(linhasArq, c.linha).code
      : c.trecho.trim();
    const extras = ehFluxo
      ? { avaliacao: "fluxo" as const, language: linguagemDe(c.arquivo) }
      : {};
    const ctxPerfil = perfilDe(c.arquivo);

    if (l.probabilidade >= limiarAlto) {
      acc.conf++;
      casos.push({
        id: `ind-${hash(c.id)}`,
        ruleId: c.ruleId,
        code: corpo,
        expected: "match",
        note: `induzido por acordo (p=${l.probabilidade.toFixed(2)}, ${l.votantesQueOpinaram} votantes) — ${c.arquivo}:${c.linha}`,
        profile: ctxPerfil,
        ...extras,
      });
    } else if (l.probabilidade <= limiarBaixo) {
      acc.ref++;
      casos.push({
        id: `ind-${hash(c.id)}`,
        ruleId: c.ruleId,
        code: corpo,
        expected: "no_match",
        note: `refutado por acordo (p=${l.probabilidade.toFixed(2)}, ${l.votantesQueOpinaram} votantes) — ${c.arquivo}:${c.linha}`,
        profile: ctxPerfil,
        ...extras,
      });
    } else {
      acc.inc++;
    }
  }

  const vereditos: VeredictoRegra[] = [...porRegra.entries()].map(([ruleId, a]) => {
    const decididos = a.conf + a.ref;
    const precisao = decididos > 0 ? a.conf / decididos : null;
    let veredito: VeredictoRegra["veredito"];
    let porque: string;

    if (a.total < minCandidatos || decididos === 0) {
      veredito = "sem-evidencia";
      porque = `${a.total} candidato(s), ${decididos} com rótulo confiável: pouco para afirmar qualquer coisa`;
    } else if (precisao! >= 0.85) {
      veredito = "aprovar";
      porque = `${a.conf} de ${decididos} apontamentos confirmados pelo acordo entre votantes`;
    } else if (precisao! >= 0.5) {
      veredito = "revisar";
      porque = `${a.ref} de ${decididos} apontamentos refutados: a regra acerta, mas não o bastante para entrar sem leitura`;
    } else {
      veredito = "quarentena";
      porque = `${a.ref} de ${decididos} apontamentos refutados: a regra erra mais do que acerta neste código`;
    }
    return {
      ruleId,
      candidatos: a.total,
      confirmados: a.conf,
      refutados: a.ref,
      incertos: a.inc,
      precisaoInduzida: precisao,
      veredito,
      porque,
    };
  });

  vereditos.sort((a, b) => b.candidatos - a.candidatos);

  return {
    casos,
    vereditos,
    estado: r.estado,
    votantes: qualidadeDosVotantes(r.estado),
    candidatosTotais: candidatos.length,
    iteracoes: r.iteracoes,
  };
}

/** Familia de linguagem para o motor de fluxo. */
function linguagemDe(caminho: string): string {
  if (/.py$/i.test(caminho)) return "python";
  if (/.cs$/i.test(caminho)) return "csharp";
  if (/.(ts|tsx|js|jsx|mjs|cjs)$/i.test(caminho)) return "any";
  return "java";
}

function perfilDe(caminho: string): string {
  if (/\.py$/i.test(caminho)) return "python";
  if (/\.(sql|db2|sqlpl|spl)$/i.test(caminho)) return "sql";
  if (/\.(cbl|cob|cpy)$/i.test(caminho)) return "cobol";
  if (/\.vb$/i.test(caminho)) return "vbnet";
  return "clike";
}

/** Identificador curto e estável para o caso induzido. */
function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
