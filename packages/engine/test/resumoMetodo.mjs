import { runLineTaintRules, resumoDeMetodosLocais } from "../dist/lineTaint.js";

// ---------------------------------------------------------------------------
// Resumo de metodo local: o motor lia o corpo do helper antes de decidir se a
// chamada suja o resultado.
//
// Antes disto valia "recebeu sujo, devolve sujo", que e seguro e caro: helper
// privado que valida ou troca a entrada por valor proprio virava falso
// positivo em cadeia ate o sink. Medido no OWASP BenchmarkJava: 17 falsos
// positivos a menos, 2 verdadeiros a menos.
//
// O teste guarda os dois lados. Calar demais custou 158 achados verdadeiros na
// primeira tentativa, entao os casos que DEVEM disparar valem tanto quanto os
// que devem calar.
// ---------------------------------------------------------------------------

let falhas = 0;
const check = (ok, msg) => {
  if (!ok) {
    falhas++;
    console.log("  FALHA: " + msg);
  }
};

const REGRA = {
  id: "T-PATH",
  name: "T-PATH",
  severity: "BLOCKER",
  type: "VULNERABILITY",
  remediationEffortMin: 5,
  cwe: [],
  owasp: [],
  message: "x",
  sddTemplateId: "x",
  languages: ["java"],
  taint: { sources: ["http.param"], sinks: ["fs.path"], sanitizers: [] },
};

const dispara = (src) => runLineTaintRules("T.java", src, [REGRA], "java").findings.length > 0;

const cabeca = `import javax.servlet.http.*;
public class T {
  protected void doPost(HttpServletRequest request, HttpServletResponse response) throws Exception {
    String param = request.getParameter("foo");
`;

console.log("=== retorno que NAO deriva do parametro nao suja a chamada");
check(
  !dispara(
    cabeca +
      `    String bar = new Test().doSomething(request, param);
    new java.io.File(bar, "/x.txt");
  }
  private class Test {
    public String doSomething(HttpServletRequest request, String param) throws Exception {
      String a = param;
      StringBuilder b = new StringBuilder(a);
      b.append(" SafeStuff");
      String g = "barbarians_at_the_gate";
      String bar = g.toString();
      return bar;
    }
  }
}`,
  ),
  "helper que devolve constante deveria calar",
);

console.log("=== ramo morto NAO apaga a derivacao do ramo vivo");
// `if (COND) bar = param; else bar = "literal";` — ler em ordem apagava a
// derivacao criada pela linha anterior. Este e o caso que custou 158 achados.
check(
  dispara(
    cabeca +
      `    String bar = new Test().doSomething(request, param);
    new java.io.File(bar, "/x.txt");
  }
  private class Test {
    public String doSomething(HttpServletRequest request, String param) throws Exception {
      String bar;
      int num = 196;
      if ((500 / 42) + num > 200) bar = param;
      else bar = "This should never happen";
      return bar;
    }
  }
}`,
  ),
  "helper com else literal ainda devolve o parametro: deveria disparar",
);

console.log("=== atribuicao quebrada em varias linhas conta como uma so");
check(
  dispara(
    cabeca +
      `    String bar = ajuda(param);
    new java.io.File(bar, "/x.txt");
  }
  private String ajuda(String p) {
    String r =
        new String(
            java.util.Base64.getDecoder().decode(
                p.getBytes()));
    return r;
  }
}`,
  ),
  "derivacao atravessa a quebra de linha: deveria disparar",
);

console.log("=== acumulador herda a sujeira do que foi anexado");
check(
  dispara(
    cabeca +
      `    String bar = ajuda(param);
    new java.io.File(bar, "/x.txt");
  }
  private String ajuda(String p) {
    StringBuilder sb = new StringBuilder();
    sb.append(p);
    return sb.toString();
  }
}`,
  ),
  "StringBuilder que recebeu o parametro deveria disparar",
);

console.log("=== metodo de fora do arquivo segue propagando");
// Sem o corpo a leitura nao decide nada, e ai o comportamento antigo (supor o
// pior) continua sendo o certo.
check(
  dispara(
    cabeca +
      `    String bar = com.outra.Lib.transforma(param);
    new java.io.File(bar, "/x.txt");
  }
}`,
  ),
  "metodo de biblioteca deveria continuar propagando",
);

console.log("=== sobrecarga resolve pelo pior caso");
check(
  dispara(
    cabeca +
      `    String bar = new Test().doSomething(param);
    new java.io.File(bar, "/x.txt");
  }
  private class Test {
    public String doSomething(int n) throws Exception {
      String c = "fixo";
      return c;
    }
    public String doSomething(String param) throws Exception {
      return param;
    }
  }
}`,
  ),
  "uma sobrecarga propaga: o nome inteiro deveria propagar",
);

console.log("=== chave dentro de string nao confunde o casamento de bloco");
check(
  dispara(
    cabeca +
      `    String bar = ajuda(param);
    new java.io.File(bar, "/x.txt");
  }
  private String ajuda(String p) {
    String s = "} nao e fim de bloco {";
    return p;
  }
}`,
  ),
  "chave literal nao deveria encerrar o corpo do metodo",
);

console.log("=== o resumo em si");
const resumo = resumoDeMetodosLocais(`
  private String constante(String p) {
    String g = "fixo";
    return g;
  }
  private String repassa(String p) {
    return p;
  }
  private void semRetorno(String p) {
    System.out.println(p);
  }
`);
check(resumo.get("constante") === false, "constante deveria ser lida como nao-propagadora");
check(resumo.get("repassa") === true, "repassa deveria ser lida como propagadora");
check(resumo.get("semRetorno") === true, "sem return legivel, mantem o comportamento antigo");

console.log(falhas ? `\n${falhas} falha(s)` : "\nok: resumo de metodo local");
process.exit(falhas ? 1 : 0);
