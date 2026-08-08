import type { BuiltNode } from "./builtNode.ts";

// ---------------------------------------------------------------------------
// Testabilidade do COBOL.
//
// A ideia vem do COBOL Check (Open Mainframe Project), que é o framework de
// teste unitário de COBOL. Lendo o que ele precisa fazer para testar um
// programa, fica claro qual é a unidade e qual é o obstáculo:
//
//   a UNIDADE é o parágrafo, exercitado por `PERFORM`;
//   o OBSTÁCULO é a dependência externa, que precisa de `MOCK` para o teste
//   rodar isolado. O COBOL Check simula três coisas: SECTION, PARAGRAPH e
//   CALL.
//
// Daí sai o que dá para medir sem rodar nada: um parágrafo que MISTURA cálculo
// com dependência externa não tem como ser testado sem simular meio programa.
// E isso não é preciosismo de teste, é bloqueio de modernização: não se
// refatora com segurança o COBOL que não se consegue testar.
//
// A segunda análise vem de outro detalhe do COBOL Check: ele precisa lidar com
// `PERFORM A THRU B`, que executa TODOS os parágrafos entre A e B na ordem do
// fonte. Quem insere um parágrafo no meio do intervalo o adiciona à execução
// sem escrever uma linha de chamada. É o defeito mais traiçoeiro do COBOL, e
// só é visível para quem tem a ORDEM dos parágrafos.
// ---------------------------------------------------------------------------

export interface AchadoTestabilidade {
  tipo: "paragrafo-intestavel" | "perform-thru-fragil";
  linha: number;
  detalhe: string;
  trecho: string;
  paragrafo: string | null;
}

/** Verbos que saem do programa: cada um exige simulação para testar isolado. */
const DEPENDENCIA_EXTERNA: Array<{ re: RegExp; nome: string }> = [
  { re: /^\s*CALL\b/i, nome: "CALL" },
  { re: /^\s*EXEC\s+(SQL|CICS)\b/i, nome: "EXEC SQL/CICS" },
  { re: /^\s*(READ|WRITE|REWRITE|DELETE|START|OPEN|CLOSE)\b/i, nome: "acesso a arquivo" },
  { re: /^\s*ACCEPT\b/i, nome: "ACCEPT" },
  // DISPLAY fica FORA da lista, de propósito. Ele escreve, não lê: um teste
  // consegue ignorar a saída sem simular nada. Mantê-lo fazia todo MAIN-PARA de
  // batch ser acusado, porque DISPLAY de log é onipresente em COBOL. Medido no
  // CardDemo: era a dupla DISPLAY mais ACCEPT que produzia a maior parte dos
  // apontamentos, e nenhum deles dizia algo útil.
];

/** Verbos que representam a regra de negócio, isto é, o que vale testar. */
const LOGICA = /^\s*(COMPUTE|ADD|SUBTRACT|MULTIPLY|DIVIDE|IF|EVALUATE|MOVE|STRING|UNSTRING|INSPECT|SEARCH)\b/i;

function nomeDoParagrafo(p: BuiltNode): string | null {
  return p.childForFieldName("name")?.text ?? null;
}

function coletaParagrafos(root: BuiltNode): BuiltNode[] {
  const out: BuiltNode[] = [];
  const pilha: BuiltNode[] = [root];
  while (pilha.length) {
    const n = pilha.pop()!;
    if (n.type === "paragraph") out.push(n);
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) pilha.push(c);
    }
  }
  // A ORDEM importa para o PERFORM THRU: é a ordem do fonte que define o
  // intervalo executado, não a ordem em que a árvore foi percorrida.
  return out.sort((a, b) => a.startPosition.row - b.startPosition.row);
}

/** Linhas de comando de um parágrafo, já sem a linha do próprio rótulo. */
function linhasDoCorpo(p: BuiltNode): string[] {
  const corpo = p.childForFieldName("body");
  if (!corpo) return [];
  // Sem remover "área de sequência" aqui: o parser já entrega a linha limpa, e
  // cortar seis caracteres por conta própria transformava `EXEC SQL ...` em
  // `QL ...` sempre que a linha chegava sem indentação. O comando sumia da
  // contagem e a análise inteira ficava muda.
  return corpo.text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^\*/.test(l));
}

/**
 * 1. PARÁGRAFO QUE NÃO TEM COMO SER TESTADO.
 *
 * Mistura regra de negócio com ida ao mundo externo. Para testar o cálculo é
 * preciso simular banco, arquivo e chamada, e a essa altura o teste testa mais
 * a simulação que o programa.
 *
 * O limiar existe para não apontar o parágrafo que É de entrada e saída, cuja
 * função é justamente falar com o mundo, nem o que faz uma leitura e conta.
 */
function paragrafoIntestavel(root: BuiltNode): AchadoTestabilidade[] {
  const out: AchadoTestabilidade[] = [];

  for (const p of coletaParagrafos(root)) {
    const linhas = linhasDoCorpo(p);
    if (linhas.length < 4) continue; // parágrafo curto se testa por inspeção

    const dependencias = new Map<string, number>();
    let logica = 0;
    for (const l of linhas) {
      const dep = DEPENDENCIA_EXTERNA.find((d) => d.re.test(l));
      if (dep) {
        dependencias.set(dep.nome, (dependencias.get(dep.nome) ?? 0) + 1);
        continue;
      }
      if (LOGICA.test(l)) logica++;
    }

    const totalDep = [...dependencias.values()].reduce((a, b) => a + b, 0);
    // Duas ou mais NATUREZAS de dependência, junto com lógica de verdade. Uma
    // natureza só é o parágrafo de entrada e saída legítimo.
    if (dependencias.size < 2 || logica < 3) continue;

    const nome = nomeDoParagrafo(p);
    out.push({
      tipo: "paragrafo-intestavel",
      linha: p.startPosition.row,
      detalhe: `${nome ?? "parágrafo"} mistura ${logica} comando(s) de cálculo com ${totalDep} dependência(s) externa(s) de ${dependencias.size} naturezas (${[...dependencias.keys()].join(", ")}): testar o cálculo exige simular todas elas`,
      trecho: (nome ?? p.text.split("\n")[0] ?? "").trim().slice(0, 100),
      paragrafo: nome,
    });
  }
  return out;
}

/**
 * 2. PERFORM THRU SOBRE UM INTERVALO.
 *
 * `PERFORM A THRU B` executa todos os parágrafos entre A e B, na ordem do
 * fonte. Quem inserir um parágrafo novo entre os dois o coloca em execução sem
 * escrever nenhuma chamada, e nada no código indica que aquilo aconteceu.
 *
 * O apontamento não é contra o THRU em si, que é idioma legítimo. É contra o
 * intervalo LARGO, onde a chance de alguém inserir no meio é real e a leitura
 * do que executa deixa de ser óbvia.
 */
function performThruFragil(root: BuiltNode): AchadoTestabilidade[] {
  const paragrafos = coletaParagrafos(root);
  const indicePorNome = new Map<string, number>();
  paragrafos.forEach((p, i) => {
    const n = nomeDoParagrafo(p);
    if (n) indicePorNome.set(n.toUpperCase(), i);
  });

  const out: AchadoTestabilidade[] = [];
  const vistos = new Set<string>();

  const pilha: BuiltNode[] = [root];
  while (pilha.length) {
    const n = pilha.pop()!;
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) pilha.push(c);
    }
    if (!/^perform/.test(n.type)) continue;

    const texto = n.text.replace(/\s+/g, " ").trim();
    const m = /PERFORM\s+([\w-]+)\s+(?:THRU|THROUGH)\s+([\w-]+)/i.exec(texto);
    if (!m) continue;

    const de = indicePorNome.get(m[1]!.toUpperCase());
    const ate = indicePorNome.get(m[2]!.toUpperCase());
    if (de === undefined || ate === undefined) continue;

    const noMeio = ate - de - 1;
    if (noMeio < 2) continue; // intervalo curto: a leitura ainda é óbvia

    const chave = `${m[1]}>${m[2]}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const nomes = paragrafos
      .slice(de + 1, ate)
      .map((p) => nomeDoParagrafo(p))
      .filter(Boolean);

    out.push({
      tipo: "perform-thru-fragil",
      linha: n.startPosition.row,
      detalhe: `o intervalo ${m[1]} até ${m[2]} executa mais ${noMeio} parágrafo(s) pelo meio (${nomes.slice(0, 4).join(", ")}${nomes.length > 4 ? ", …" : ""}): quem inserir um parágrafo aí o coloca em execução sem escrever nenhuma chamada`,
      trecho: texto.slice(0, 100),
      paragrafo: null,
    });
  }
  return out;
}

export function analisarTestabilidade(root: BuiltNode): AchadoTestabilidade[] {
  return [...paragrafoIntestavel(root), ...performThruFragil(root)].sort(
    (a, b) => a.linha - b.linha,
  );
}
