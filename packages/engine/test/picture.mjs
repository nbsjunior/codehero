import { lerPicture } from "../dist/structural/picture.js";

// ---------------------------------------------------------------------------
// Casos derivados das regras do `cb_build_picture` do GnuCOBOL, que e o
// compilador de referencia. Cada expectativa aqui tem uma razao escrita, e nao
// "foi o que a implementacao devolveu".
// ---------------------------------------------------------------------------

let falhas = 0;
function conf(pic, esperado, porque) {
  const t = lerPicture(pic);
  const erros = [];
  for (const [k, v] of Object.entries(esperado)) {
    if (t?.[k] !== v) erros.push(`${k}=${t?.[k]} (esperado ${v})`);
  }
  if (erros.length) {
    falhas++;
    console.log(`  FALHA ${pic.padEnd(18)} ${erros.join(", ")}`);
    console.log(`        ${porque}`);
  } else {
    console.log(`  ok    ${pic.padEnd(18)} ${porque}`);
  }
}

console.log("=== numerico simples ===");
conf("9(4)", { digitos: 4, decimais: 0, editado: false }, "quatro posicoes de digito");
conf("S9(9)V99", { digitos: 11, decimais: 2 }, "S nao ocupa posicao; V separa os decimais");
conf("9(5)V99 COMP-3", { digitos: 7, decimais: 2, editado: false }, "USAGE sai antes da leitura");

console.log("\n=== alfanumerico e os multibyte ===");
conf("X(30)", { digitos: 30, alfanumerico: true, bytes: 30 }, "um byte por caractere");
conf("N(10)", { digitos: 10, alfanumerico: true, bytes: 20 }, "nacional ocupa DOIS bytes por caractere");
conf("U(10)", { digitos: 10, alfanumerico: true, bytes: 40 }, "UTF-8 ocupa QUATRO bytes por caractere");

console.log("\n=== insercao flutuante: o primeiro grupo perde uma posicao ===");
conf(
  "$$,$$$,$$9.99",
  { digitos: 9, decimais: 2, editado: true },
  "7 cifroes: o primeiro grupo perde 1 para o simbolo impresso, mais o 9, mais 2 decimais",
);
conf(
  "+ZZZ,ZZZ,ZZZ.99",
  { digitos: 11, decimais: 2, editado: true },
  "um + sozinho e insercao fixa; 9 Z valem digito, mais 2 decimais",
);
conf("ZZ,ZZ9.99", { digitos: 7, decimais: 2, editado: true }, "Z e 9 valem digito, virgula nao");
conf("****9.99", { digitos: 7, decimais: 2, editado: true }, "asterisco de protecao vale digito");

console.log("\n=== P: posicao de escala ===");
conf(
  "9(3)PPP",
  { digitos: 6, escala: -3 },
  "P no FIM conta como digito de VALOR (3+3=6) mesmo sem ocupar armazenamento, e desloca a escala: o campo guarda milhares",
);
conf(
  "PPP9(3)",
  { digitos: 3, escala: 3 },
  "P no INICIO nao soma digito, so desloca a escala para a direita do ponto",
);

console.log("\n=== sinal a direita ===");
conf("9(5)CR", { digitos: 5, bytes: 7, editado: true }, "CR ocupa dois caracteres e nenhum digito");

console.log("\n=== PICTURE invalida ===");
const semDado = lerPicture("+");
console.log(`  '+' sozinho -> ${semDado === null ? "null" : `invalida=${semDado.invalida}`}`);
if (semDado !== null && !semDado.invalida) {
  falhas++;
  console.log("  FALHA: um + sozinho nao tem posicao de dado e deveria ser recusado");
}

const doisPontos = lerPicture("9(3)V9V9");
console.log(`  dois V -> invalida=${doisPontos?.invalida}`);
if (!doisPontos?.invalida) {
  falhas++;
  console.log("  FALHA: mais de um ponto decimal e invalido");
}

console.log("\n=== o caso que motivou tudo isto ===");
const origem = lerPicture("S9(7)V99");
const destino = lerPicture("$$,$$$,$$9.99");
console.log(`  origem ${origem.digitos} digitos, destino ${destino.digitos} digitos`);
if (destino.digitos < origem.digitos) {
  falhas++;
  console.log("  FALHA: com a contagem certa o valor CABE e nao pode haver apontamento");
} else {
  console.log("  ok    cabe, entao nao ha truncamento a apontar");
}

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
