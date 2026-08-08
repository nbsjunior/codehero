import type { LabeledExample } from "./index.ts";

// ---------------------------------------------------------------------------
// Qualidade do RÓTULO, não do modelo.
//
// O problema que isto resolve
// ---------------------------------------------------------------------------
// O ranqueador aprende com apontamentos que alguém marcou como verdadeiro ou
// falso positivo. Só que quem marca erra: marca falso positivo para não ver
// mais aquilo, marca confirmado sem ler, ou discorda de outra pessoa do mesmo
// time. Cada rótulo errado envenena o treino em silêncio, e o resultado é um
// modelo pior que ninguém sabe explicar.
//
// O método vem do `cleanlab` (aprendizado confiante, Northcutt et al.). A ideia
// central é bonita e simples: um modelo treinado FORA DA AMOSTRA discorda dos
// rótulos errados com mais confiança do que discorda dos certos. Então não se
// procura o rótulo errado olhando o rótulo, se procura olhando a discordância.
//
// Duas peças, na ordem:
//
//   LIMIAR POR CLASSE  a confiança média que o modelo tem nos exemplos de cada
//                      classe. Usar 0,5 fixo seria errado, porque uma classe
//                      pode ser sistematicamente mais fácil que a outra, e aí
//                      todo exemplo difícil da classe difícil viraria suspeito.
//
//   AUTO-CONFIANÇA     a probabilidade que o modelo dá para o rótulo QUE FOI
//                      ATRIBUÍDO. Baixa significa que o modelo, sem ter visto
//                      aquele exemplo, discorda de quem rotulou.
//
// O que isto NÃO é: prova de que o rótulo está errado. É uma fila de revisão
// ordenada por suspeita. Quem decide continua sendo gente.
// ---------------------------------------------------------------------------

export interface RotuloSuspeito {
  id: string;
  /** Opcional no exemplo de origem: nem todo rotulo carrega a regra. */
  ruleId: string | undefined;
  /** O rótulo humano: 1 verdadeiro positivo, 0 falso positivo. */
  rotulo: 0 | 1;
  /** Probabilidade que o modelo fora da amostra dá ao rótulo atribuído. */
  autoConfianca: number;
  /** O modelo teria colocado na outra classe com confiança? */
  discordanciaConfiante: boolean;
  porque: string;
}

export interface QualidadeDosRotulos {
  /** Limiar de confiança por classe, calculado dos próprios dados. */
  limiar: { falso: number; verdadeiro: number };
  /** Matriz de confusão confiante: quantos rotulados i o modelo põe em j. */
  conjuntoConfiante: { rotuladoFalso: [number, number]; rotuladoVerdadeiro: [number, number] };
  /** Ordenados do mais suspeito para o menos. */
  suspeitos: RotuloSuspeito[];
  /** Fração do conjunto que aparenta estar mal rotulada. */
  taxaDeRuido: number;
}

/**
 * Limiar por classe: a confiança MÉDIA do modelo nos exemplos daquela classe.
 *
 * É o que impede o método de simplesmente marcar como suspeito todo exemplo
 * difícil. Se a classe "falso positivo" é intrinsecamente mais difícil de
 * prever, o limiar dela desce junto, e só a discordância acima do normal para
 * aquela classe conta.
 */
function limiarPorClasse(
  exemplos: LabeledExample[],
  probVerdadeiro: number[],
): { falso: number; verdadeiro: number } {
  const soma = { falso: 0, verdadeiro: 0 };
  const n = { falso: 0, verdadeiro: 0 };
  for (let i = 0; i < exemplos.length; i++) {
    const p = probVerdadeiro[i]!;
    if (exemplos[i]!.label === 1) {
      soma.verdadeiro += p;
      n.verdadeiro++;
    } else {
      soma.falso += 1 - p;
      n.falso++;
    }
  }
  return {
    // Sem exemplos de uma classe não há limiar aprendível: 0.5 é a única
    // resposta honesta, e o efeito prático é não acusar ninguém por ela.
    falso: n.falso ? soma.falso / n.falso : 0.5,
    verdadeiro: n.verdadeiro ? soma.verdadeiro / n.verdadeiro : 0.5,
  };
}

/**
 * Analisa a qualidade dos rótulos a partir de predições FORA DA AMOSTRA.
 *
 * `probVerdadeiro[i]` precisa vir de um modelo que NÃO viu `exemplos[i]` no
 * treino. Com predição dentro da amostra o modelo decora o rótulo errado junto
 * com os certos, concorda com todo mundo e o método não acha nada.
 */
export function analisarRotulos(
  exemplos: LabeledExample[],
  probVerdadeiro: number[],
): QualidadeDosRotulos {
  if (exemplos.length !== probVerdadeiro.length) {
    throw new Error(
      `analisarRotulos: ${exemplos.length} exemplos e ${probVerdadeiro.length} probabilidades`,
    );
  }

  const limiar = limiarPorClasse(exemplos, probVerdadeiro);
  const conjunto = { rotuladoFalso: [0, 0] as [number, number], rotuladoVerdadeiro: [0, 0] as [number, number] };
  const suspeitos: RotuloSuspeito[] = [];

  for (let i = 0; i < exemplos.length; i++) {
    const ex = exemplos[i]!;
    const pV = probVerdadeiro[i]!;
    const pF = 1 - pV;
    const rotulo = (ex.label === 1 ? 1 : 0) as 0 | 1;

    // Em qual classe o modelo põe este exemplo COM CONFIANÇA, isto é, acima do
    // limiar daquela classe. Pode não pôr em nenhuma, e aí não há discordância
    // confiante a declarar.
    const passaV = pV >= limiar.verdadeiro;
    const passaF = pF >= limiar.falso;
    let classeConfiante: 0 | 1 | null = null;
    if (passaV && !passaF) classeConfiante = 1;
    else if (passaF && !passaV) classeConfiante = 0;
    else if (passaV && passaF) classeConfiante = pV >= pF ? 1 : 0; // empate: a maior

    if (classeConfiante !== null) {
      const linha = rotulo === 0 ? conjunto.rotuladoFalso : conjunto.rotuladoVerdadeiro;
      linha[classeConfiante]++;
    }

    const autoConfianca = rotulo === 1 ? pV : pF;
    const discorda = classeConfiante !== null && classeConfiante !== rotulo;

    if (discorda || autoConfianca < 0.5) {
      suspeitos.push({
        id: ex.id,
        ruleId: ex.ruleId,
        rotulo,
        autoConfianca,
        discordanciaConfiante: discorda,
        porque: discorda
          ? `rotulado ${rotulo === 1 ? "verdadeiro" : "falso"}, mas o modelo o coloca na outra classe acima do limiar dela`
          : `o modelo dá só ${(autoConfianca * 100).toFixed(0)}% ao rótulo atribuído`,
      });
    }
  }

  // Mais suspeito primeiro: discordância confiante pesa mais que confiança
  // baixa, e entre iguais vence a menor auto-confiança.
  suspeitos.sort((a, b) => {
    if (a.discordanciaConfiante !== b.discordanciaConfiante) return a.discordanciaConfiante ? -1 : 1;
    return a.autoConfianca - b.autoConfianca;
  });

  const forasDaDiagonal =
    conjunto.rotuladoFalso[1] + conjunto.rotuladoVerdadeiro[0];
  const totalConfiante =
    conjunto.rotuladoFalso[0] + conjunto.rotuladoFalso[1] +
    conjunto.rotuladoVerdadeiro[0] + conjunto.rotuladoVerdadeiro[1];

  return {
    limiar,
    conjuntoConfiante: conjunto,
    suspeitos,
    taxaDeRuido: totalConfiante ? forasDaDiagonal / totalConfiante : 0,
  };
}
