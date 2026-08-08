// ---------------------------------------------------------------------------
// Leitura da cláusula PICTURE, seguindo o compilador de referência.
//
// As regras aqui foram conferidas contra `cb_build_picture` do GnuCOBOL
// (cobc/tree.c), que é a implementação que decide o que compila de verdade.
// Antes disso o cálculo era baseado no que eu supunha, e o teste em COBOL real
// mostrou onde a suposição custava caro: `$$,$$$,$$9.99` era lido como 1 dígito
// em vez de 9, e a análise de truncamento apontava 13 formatações corretas.
//
// O que o GnuCOBOL faz, e que passou a valer aqui:
//
//   9        uma posição de dígito
//   Z *      uma posição de dígito (supressão de zero / proteção por asterisco)
//   $ + -    inserção FLUTUANTE: o PRIMEIRO grupo perde uma posição para o
//            próprio símbolo impresso; grupos seguintes contam inteiros
//   , 0 B /  inserção pura: ocupam caractere, não carregam dígito
//   .        ponto decimal do campo editado, faz o papel do V
//   V        ponto decimal implícito, não ocupa caractere
//   S        sinal, não ocupa posição sem SEPARATE CHARACTER
//   P        posição de escala. No INÍCIO desloca a escala sem somar dígito;
//            no FIM soma dígito. Fora dessas posições o compilador recusa
//   X A      um caractere cada
//   N        nacional: DOIS bytes por caractere
//   U        UTF-8: QUATRO bytes por caractere
//   CR DB    dois caracteres de sinal, nenhum dígito
// ---------------------------------------------------------------------------

export interface TamanhoPic {
  /** Posições de dígito, somando parte inteira e decimal. */
  digitos: number;
  /** Posições depois do ponto decimal. */
  decimais: number;
  alfanumerico: boolean;
  /** Campo de edição (`$`, `Z`, `,`, `+`): existe para exibir, não para calcular. */
  editado: boolean;
  /** Bytes ocupados. Difere de `digitos` em `N` (2 bytes) e `U` (4 bytes). */
  bytes: number;
  /**
   * Fator de escala do `P`. `PIC 9(3)PPP` guarda milhares: o valor real é o
   * declarado vezes 10^3. Ignorar isso faz a comparação de truncamento errar
   * por ordens de grandeza inteiras.
   */
  escala: number;
  /** Motivo pelo qual a PICTURE é inválida, quando é. */
  invalida: string | null;
}

/** Remove o que não é PICTURE: USAGE, VALUE, OCCURS e afins. */
function limpaClausulas(pic: string): string {
  return pic
    .toUpperCase()
    .replace(
      /\b(?:USAGE\s+)?(?:IS\s+)?(?:COMP(?:UTATIONAL)?(?:-[1-6])?|BINARY(?:-(?:CHAR|SHORT|LONG|DOUBLE))?|PACKED-DECIMAL|DISPLAY-1|DISPLAY|NATIONAL|INDEX|POINTER|FUNCTION-POINTER)\b/g,
      "",
    )
    .replace(/\b(?:VALUE|OCCURS|REDEFINES|SYNC(?:HRONIZED)?|JUST(?:IFIED)?)\b[\s\S]*$/g, "")
    .trim();
}

/**
 * Expande `9(4)` e AGRUPA símbolos repetidos, como o compilador faz.
 *
 * O agrupamento não é cosmético. `PPP` precisa chegar como um grupo de três,
 * senão só o primeiro `P` é reconhecido como estando no início da PICTURE e os
 * outros dois passam por P fora de posição. O mesmo vale para o desconto do
 * símbolo flutuante, que se aplica ao GRUPO e não a cada caractere.
 */
function expande(p: string): Array<{ simbolo: string; n: number }> {
  const bruto: Array<{ simbolo: string; n: number }> = [];
  const re = /(CR|DB|[9XANUZ*$+\-VSP,.0B/1])(?:\((\d+)\))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p)) !== null) {
    bruto.push({ simbolo: m[1]!, n: m[2] ? parseInt(m[2], 10) : 1 });
  }
  const out: Array<{ simbolo: string; n: number }> = [];
  for (const s of bruto) {
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.simbolo === s.simbolo) ultimo.n += s.n;
    else out.push({ ...s });
  }
  return out;
}

export function lerPicture(pic: string): TamanhoPic | null {
  if (!pic) return null;
  const p = limpaClausulas(pic);
  if (!p) return null;

  const simbolos = expande(p);
  if (simbolos.length === 0) return null;

  let digitos = 0;
  let decimais = 0;
  let bytes = 0;
  let escala = 0;
  let alfanumerico = false;
  let depoisDoPonto = false;
  let vistos = 0; // quantos V/. já apareceram: mais de um é inválido
  let invalida: string | null = null;

  // Contagem por símbolo flutuante. O GnuCOBOL desconta uma posição no PRIMEIRO
  // grupo de cada símbolo, e só considera flutuante quando há mais de um.
  const flutuante: Record<string, number> = { $: 0, "+": 0, "-": 0 };
  const primeiroGrupo: Record<string, boolean> = { $: true, "+": true, "-": true };

  for (let i = 0; i < simbolos.length; i++) {
    const { simbolo, n } = simbolos[i]!;
    const soma = (q: number) => {
      if (depoisDoPonto) decimais += q;
      digitos += q;
    };

    switch (simbolo) {
      case "V":
      case ".":
        vistos++;
        if (vistos > 1 && !invalida) invalida = "mais de um ponto decimal";
        depoisDoPonto = true;
        if (simbolo === ".") bytes += 1;
        break;

      case "S":
        break; // sinal não ocupa posição sem SEPARATE CHARACTER

      case "P": {
        // No início desloca a escala sem somar dígito; no fim soma dígito.
        const noInicio = simbolos.slice(0, i).every((s) => s.simbolo === "S" || s.simbolo === "V");
        const noFim = simbolos.slice(i + 1).every((s) => s.simbolo === "V");
        if (!noInicio && !noFim && !invalida) invalida = "P precisa estar no início ou no fim";
        if (noInicio) {
          depoisDoPonto = true;
          escala += n;
        } else {
          digitos += n;
          escala -= n;
        }
        break;
      }

      case "X":
      case "A":
        alfanumerico = true;
        soma(n);
        bytes += n;
        break;

      case "N": // nacional: 2 bytes por caractere
        alfanumerico = true;
        soma(n);
        bytes += n * 2;
        break;

      case "U": // UTF-8: 4 bytes por caractere
        alfanumerico = true;
        soma(n);
        bytes += n * 4;
        break;

      case "1": // booleano
        soma(n);
        bytes += n;
        break;

      case "9":
      case "Z":
      case "*":
        soma(n);
        bytes += n;
        break;

      case "$":
      case "+":
      case "-": {
        flutuante[simbolo] = (flutuante[simbolo] ?? 0) + n;
        // Regra do GnuCOBOL: o primeiro grupo perde uma posição para o símbolo
        // impresso; grupos seguintes contam inteiros.
        const perde = primeiroGrupo[simbolo] ? 1 : 0;
        primeiroGrupo[simbolo] = false;
        soma(Math.max(0, n - perde));
        bytes += n;
        break;
      }

      case "CR":
      case "DB":
        bytes += 2;
        break;

      case ",":
      case "0":
      case "B":
      case "/":
        bytes += n;
        break;
    }
  }

  // Um símbolo sozinho é inserção FIXA e não vale posição de dígito. Como o
  // laço já descontou um, aqui não há nada a fazer; o caso de dois ou mais é
  // que caracteriza flutuante de verdade.
  const temFlutuante = Object.values(flutuante).some((q) => q > 1);
  const editado =
    (/[Z*,]/.test(p) || /\b(CR|DB)\b/.test(p) || Object.values(flutuante).some((q) => q > 0)) &&
    /[9Z*$]/.test(p);

  // Regra de validade do compilador: precisa de ao menos um de A N U X Z 1 9 *,
  // ou ao menos dois do conjunto + - e o símbolo de moeda.
  if (!invalida && digitos === 0 && !alfanumerico && !temFlutuante) {
    invalida = "PICTURE sem nenhuma posição de dado";
  }

  if (digitos === 0 && decimais === 0 && !alfanumerico) return null;
  return { digitos, decimais, alfanumerico, editado, bytes, escala, invalida };
}
