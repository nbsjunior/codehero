import type { Severity, IssueType } from "./severity.ts";
import type { SecurityCategory } from "./engineKinds.ts";
import type { StructuralSpec } from "./structuralRules.ts";

// ---------------------------------------------------------------------------
// Catálogo de regras estruturais.
//
// Critério de entrada: a regra tem de ser IMPOSSÍVEL de expressar em regex por
// linha. Se um padrão textual resolve, ela pertence ao L0 — duplicar aqui só
// custaria parse sem ganho.
//
// Cada regra vale para as 6 linguagens com gramática (JS, TS, TSX, Python,
// Java, Go, C#), porque a especificação usa tipos de nó LÓGICOS.
// ---------------------------------------------------------------------------

export interface StructuralRule {
  id: string;
  name: string;
  message: string;
  severity: Severity;
  type: IssueType;
  remediationEffortMin: number;
  cwe: string[];
  owasp: string[];
  sddTemplateId: string;
  category?: SecurityCategory;
  spec: StructuralSpec;
  /** Por que regex não resolve — documenta o critério de entrada. */
  whyNotRegex: string;
}

export const STRUCTURAL_RULES: StructuralRule[] = [
  {
    id: "HERO-ST-0095-eval-non-literal",
    name: "EvalComArgumentoNaoLiteral",
    message:
      "eval/exec recebendo valor que não é constante: o conteúdo pode vir de fora e virar execução de código.",
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 30,
    cwe: ["CWE-95"],
    owasp: ["A03:2021-Injection"],
    sddTemplateId: "sdd.eval.remove",
    category: "string-injection",
    spec: {
      match: "call",
      callee: "^(eval|exec|execfile|compile)$",
      // Só chamada NUA: `exec(codigo)` do Python é perigoso; `re.exec(str)` é
      // RegExp.prototype.exec e inofensivo. Sem isto a regra deu 11 falsos
      // positivos e zero verdadeiros no próprio repo — e é CRITICAL.
      calleeUnqualified: true,
      argument: { index: 0, is: "non-literal" },
    },
    whyNotRegex:
      "A regex vê `eval(` e dispara igual para `eval(\"const\")` e `eval(entrada)`. A diferença está no TIPO do nó do argumento, não no texto.",
  },
  {
    id: "HERO-ST-1069-empty-catch",
    name: "CatchVazio",
    message:
      "Bloco catch/except sem nenhuma instrução: a falha é engolida e some do rastro de produção.",
    severity: "MAJOR",
    type: "CODE_SMELL",
    remediationEffortMin: 10,
    cwe: ["CWE-1069"],
    owasp: [],
    sddTemplateId: "sdd.smell.handle-exception",
    category: "code-smell",
    spec: { match: "catch", empty: true },
    whyNotRegex:
      "`catch (e) {` e `}` costumam estar em linhas diferentes, e a regex por linha não sabe o que há entre elas. Comentário dentro do bloco também não conta como tratamento.",
  },
  {
    id: "HERO-ST-0327-hardcoded-crypto-key",
    name: "ChaveCriptograficaLiteral",
    message:
      "Chave/IV/salt passado como literal para função de criptografia: quem tem o binário tem a chave.",
    severity: "BLOCKER",
    type: "VULNERABILITY",
    remediationEffortMin: 30,
    cwe: ["CWE-321", "CWE-798"],
    owasp: ["A02:2021-Cryptographic Failures"],
    sddTemplateId: "sdd.secret.externalize",
    category: "weak-crypto",
    spec: {
      match: "call",
      callee: "(createCipheriv|createDecipheriv|AES|Cipher|SecretKeySpec|IvParameterSpec|new_?key|Fernet)",
      argument: { index: "any", is: "literal", matches: "^['\"`]" },
    },
    whyNotRegex:
      "Exige saber que ALGUM argumento daquela chamada é literal de string. A regex não consegue delimitar a lista de argumentos nem classificar cada um.",
  },
  {
    id: "HERO-ST-0089-query-nao-literal",
    name: "QueryNaoLiteral",
    message:
      "Query SQL montada a partir de valor não constante: se a origem for entrada do usuário, é SQL Injection.",
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 25,
    cwe: ["CWE-89"],
    owasp: ["A03:2021-Injection"],
    sddTemplateId: "sdd.sqli.parametrize",
    category: "string-injection",
    spec: {
      match: "call",
      callee: 
        "^(query|execute|executemany|executeQuery|executeUpdate|rawQuery|createQuery|"
        +        "Query|QueryRow|QueryContext|Exec|ExecContext|ExecuteSqlRaw|ExecuteSqlInterpolated|FromSqlRaw)$",
      // `assembled` e nao `non-literal`: o Firestore usa `query(collection(),
      // where())` e caiu nos 4 unicos matches do repo, todos falsos. Query
      // montada com literal costurado a valor é o que caracteriza a injeção.
      argument: { index: 0, is: "assembled" },
    },
    whyNotRegex:
      "`db.query(SQL_CONSTANTE)` é seguro e `db.query(montada)` não. Para a regex os dois são `query(` seguido de identificador.",
  },
  {
    id: "HERO-ST-0489-call-em-laco",
    name: "ChamadaCaraEmLaco",
    message:
      "Chamada de I/O ou consulta dentro de laço: custo linear no tamanho da coleção (padrão N+1).",
    severity: "MAJOR",
    type: "CODE_SMELL",
    remediationEffortMin: 20,
    cwe: [],
    owasp: [],
    sddTemplateId: "sdd.smell.batch-io",
    category: "code-smell",
    // A primeira versão incluía get/find/save/update/delete e disparou 60 vezes
    // no próprio repo — TODAS falso positivo: `map.get(k)` e `set.delete(x)`
    // dentro de laço são O(1) e inofensivos. Sem inferência de tipo não dá para
    // separar `map.get` de `repo.get`, e esse é um limite real de AST sem tipos.
    // A lista ficou só com nomes que NENHUMA coleção da biblioteca padrão usa.
    spec: {
      match: "call",
      callee:
        "^(query|execute|executeQuery|executeUpdate|executemany|findOne|findAll|findMany|fetch|readFile|readFileSync|writeFile|writeFileSync|request)$",
      inside: ["loop"],
    },
    whyNotRegex:
      "Depende de o nó estar sob um ancestral do tipo laço, possivelmente dezenas de linhas acima. É informação de árvore, não de linha.",
  },
  {
    id: "HERO-ST-0400-io-assincrono-em-laco",
    name: "IoAssincronoEmLaco",
    message:
      "Operação assíncrona dentro de laço: uma ida e volta por item da coleção (padrão N+1). Agrupe numa chamada só ou use Promise.all.",
    severity: "MAJOR",
    type: "CODE_SMELL",
    remediationEffortMin: 30,
    cwe: ["CWE-400"],
    owasp: [],
    sddTemplateId: "sdd.smell.batch-io",
    category: "code-smell",
    // Esta regra NAO tem lista de nomes, e e o ponto dela.
    //
    // A regra irma (0489) precisa enumerar `query|fetch|readFile|...` porque so
    // enxerga forma. Aqui o criterio e o TIPO: a chamada devolve Promise e nao
    // foi declarada na biblioteca padrao. Isso vale para qualquer metodo, de
    // qualquer biblioteca, inclusive os que ainda nao existem — nenhuma lista
    // para manter e nenhum nome novo escapando.
    //
    // `requireSemantic` faz a regra CALAR onde nao ha tipo (JS puro, arquivo
    // fora do Program). Silencio honesto vale mais que palpite: sem tipo, esta
    // regra e exatamente a que deu 103 achados e ~60 falsos positivos.
    spec: {
      match: "call",
      inside: ["loop"],
      semantic: {
        awaitable: true,
        calleeFrom: ["user", "dependency"],
        requireSemantic: true,
      },
    },
    whyNotRegex:
      "Depende de saber que a chamada devolve Promise e de onde o metodo foi declarado. Nenhuma das duas coisas esta no texto nem na forma da arvore: so o verificador de tipos sabe.",
  },
  {
    id: "HERO-ST-0561-funcao-vazia",
    name: "FuncaoVazia",
    message: "Função sem corpo: ou é código morto, ou é uma implementação esquecida.",
    severity: "MINOR",
    type: "CODE_SMELL",
    remediationEffortMin: 5,
    cwe: ["CWE-1071"],
    owasp: [],
    sddTemplateId: "sdd.smell.remove-dead-code",
    category: "code-smell",
    spec: { match: "function", empty: true },
    whyNotRegex:
      "Mesmo problema do catch vazio: o corpo se estende por várias linhas e a regex só vê uma de cada vez.",
  },
  {
    id: "HERO-ST-cobol-dynamic-call",
    name: "CallDinamicoCobol",
    message:
      "CALL com nome de programa em variável: o alvo só se resolve em runtime e foge a análise estática simples.",
    severity: "MAJOR",
    type: "CODE_SMELL",
    remediationEffortMin: 20,
    cwe: ["CWE-829"],
    owasp: [],
    sddTemplateId: "sdd.smell.remove-dead-code",
    category: "code-smell",
    spec: {
      match: "call",
      textMatches: "^CALL\\b",
      argument: { index: 0, is: "non-literal" },
    },
    whyNotRegex:
      "CALL 'PROG' e CALL WS-PROG-NAME são a mesma forma textual na linha; só o tipo do nó (literal vs identificador) separa o caso seguro do dinâmico.",
  },
  {
    id: "HERO-ST-tsql-exec-dynamic",
    name: "ExecSqlDinamico",
    message:
      "EXEC/EXECUTE com SQL montado ou variável: risco clássico de SQL Injection em T-SQL.",
    severity: "CRITICAL",
    type: "VULNERABILITY",
    remediationEffortMin: 30,
    cwe: ["CWE-89"],
    owasp: ["A03:2021-Injection"],
    sddTemplateId: "sdd.sqli.parametrize",
    category: "string-injection",
    spec: {
      match: "call",
      callee: "^(EXEC|sp_executesql)$",
      argument: { index: "any", is: "assembled" },
    },
    whyNotRegex:
      "EXEC(@sql) e EXEC(N'SELECT 1') compartilham o token EXEC; a árvore distingue identificador/montagem de literal constante.",
  },
];

export const STRUCTURAL_RULES_BY_ID: Record<string, StructuralRule> = Object.fromEntries(
  STRUCTURAL_RULES.map((r) => [r.id, r]),
);
