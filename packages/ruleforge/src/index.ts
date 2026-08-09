export type { CorpusCase, EvalResult, Mutation, Individual } from "./types.ts";
export { loadCorpus, casesForRule } from "./corpus.ts";
export { evaluateRule } from "./evaluate.ts";
export { casaNoCaso, recortarFluxo } from "./avaliarCaso.ts";
export { evolveRule, type EvolveOutcome, type EvolveOptions } from "./evolve.ts";
export { evolveAllRules, daySeed, type BatchEvolutionReport, type RuleEvolutionReport } from "./batch.ts";
export { poolFor, MUTATION_POOL } from "./mutations.ts";
export {
  mutationFromSpec,
  isSafeMutationSpec,
  type MutationSpec,
  type MutationKind,
} from "./mutationSpec.ts";
export { noopGenerator, type RuleCandidateGenerator, type CandidateGenerationInput } from "./llmGenerator.ts";

// --- indução de corpus por acordo (não supervisionada, online) -------------
export {
  rotularPorAcordo,
  estadoVazio,
  qualidadeDosVotantes,
  DECAIMENTO_PADRAO,
  type Voto,
  type CandidatoVotado,
  type EstadoSupervisao,
  type Rotulo,
  type ResultadoRotulagem,
} from "./supervisaoFraca.ts";
export {
  montarContexto,
  normalizarTrecho,
  votanteDeVotosGravados,
  VOTANTES_DETERMINISTICOS,
  type Candidato,
  type ContextoArquivo,
  type Votante,
} from "./votantes.ts";
export {
  induzirCorpus,
  type AchadoBruto,
  type ArquivoAnalisado,
  type VeredictoRegra,
  type ResultadoInducao,
  type OpcoesInducao,
} from "./corpusOnline.ts";
export {
  coletarVotosDeModelo,
  interpretarResposta,
  INSTRUCAO_DE_VOTO,
  type ChamadaDeModelo,
  type PerguntaAoModelo,
  type OpcoesColeta,
  type ResultadoColeta,
} from "./votoDeModelo.ts";
