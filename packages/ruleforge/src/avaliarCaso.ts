import { matchPattern, buildLexicalMask, type HeroRule } from "@codehero/contracts";
import { runLineTaintRules } from "@codehero/engine";
import type { CorpusCase } from "./types.ts";

// ---------------------------------------------------------------------------
// Como um caso de corpus é julgado.
//
// O buraco que isto fecha
// ---------------------------------------------------------------------------
// Até aqui todo caso era avaliado com `matchPattern` sobre o texto dado, um
// casador LÉXICO de uma linha. Isso deixava as regras mais graves de fora do
// corpus por impossibilidade de representação, não por descuido: apontamento
// de fluxo de dados existe justamente porque o valor perigoso viajou por
// várias linhas, e a linha do uso final, sozinha, não casa com padrão nenhum.
//
// O sintoma foi direto. Ao tentar promover casos induzidos corroborados pelo
// gabarito do OWASP, os sete viraram seis falhas na hora:
//
//     request.getSession().setAttribute(param, "10340");
//
// é vulnerabilidade real de fronteira de confiança, e como linha solta não é
// nada. As regras de taint — as de severidade mais alta do catálogo — nunca
// poderiam receber um caso.
//
// O que muda
// ---------------------------------------------------------------------------
// O caso passa a poder declarar `avaliacao: "fluxo"` e trazer o trecho INTEIRO
// que sustenta o defeito, da entrada até o uso. Aí a avaliação roda o mesmo
// motor de fluxo que o scanner roda, e não uma aproximação dele.
//
// E roda os DOIS caminhos, léxico e fluxo, porque é isso que o scanner faz. Um
// corpus que testasse só metade do pipeline daria garantia sobre um produto
// que não existe: a regra passaria no corpus e se comportaria diferente em
// produção, que é exatamente o defeito que o corpus deveria impedir.
// ---------------------------------------------------------------------------

/**
 * A regra sinaliza este trecho?
 *
 * Reproduz o pipeline do scanner: casamento léxico OU fluxo de dados, com o
 * mesmo matcher e o mesmo motor que rodam em produção. Não há segunda
 * implementação, então um caso não pode passar aqui e falhar lá.
 */
export function casaNoCaso(regra: HeroRule, caso: CorpusCase): boolean {
  const porFluxo =
    caso.avaliacao === "fluxo" && regra.taint
      ? runLineTaintRules(`${caso.id}.src`, caso.code, [regra], caso.language ?? "java").findings
          .length > 0
      : false;
  if (porFluxo) return true;

  if (!regra.pattern) return false;
  return (
    matchPattern(regra.pattern, caso.code, {
      mask: buildLexicalMask(caso.code, caso.profile ?? "clike"),
    }).length > 0
  );
}

/**
 * Um caso de fluxo precisa mostrar o CAMINHO, não a linha.
 *
 * Recorta da fonte original desde a primeira linha que introduz alguma das
 * variáveis usadas no ponto do apontamento até o próprio apontamento. Recorte
 * curto demais quebra a cadeia e o caso vira falso negativo eterno no corpus;
 * recorte grande demais transforma o caso num arquivo inteiro e ninguém
 * consegue ler o que ele está afirmando.
 */
export function recortarFluxo(
  linhas: string[],
  linhaDoAchado: number,
  maxLinhas = 30,
): { code: string; linhaRelativa: number } {
  const idx = linhaDoAchado - 1;
  const alvo = linhas[idx] ?? "";
  const nomes = new Set(
    (alvo.match(/\b[a-zA-Z_$][\w$]*\b/g) ?? []).filter((w) => w.length > 2 && !PALAVRAS.has(w)),
  );

  // Sobe procurando onde cada nome aparece pela primeira vez.
  let ini = idx;
  for (let i = idx - 1; i >= 0 && idx - i < maxLinhas; i--) {
    const l = linhas[i] ?? "";
    if ([...nomes].some((n) => new RegExp(`\\b${n}\\b`).test(l))) ini = i;
  }
  return {
    code: linhas.slice(ini, idx + 1).join("\n"),
    linhaRelativa: idx - ini + 1,
  };
}

const PALAVRAS = new Set([
  "new", "return", "this", "true", "false", "null", "void", "int", "String",
  "final", "static", "public", "private", "protected", "class", "throws",
  "java", "javax", "org", "com", "util", "lang", "io",
]);
