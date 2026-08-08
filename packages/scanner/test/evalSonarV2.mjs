// Avaliação em massa das SONAR-port, V2.
//
// V1 gerava snippets destruindo o regex (extrair literais quebra âncoras).
// V2 testa com snippets REAIS por categoria de regra, escolhidos do
// conhecimento do que o Sonar detecta. Cada caso é positivo (deve disparar).
import { RULES, matchPattern, lexicalProfileFor } from "@codehero/contracts";

const C = {
  js: "t.ts",
  py: "t.py",
  java: "t.java",
  cs: "t.cs",
  cobol: "t.cbl",
  tsql: "t.sql",
  plsql: "t.sql",
};

// Casos positivos curados por regra, cobrindo as categorias principais.
const CASES = [
  // --- Credenciais / cripto ---
  ["SONAR-js-S2068", 'const password = "supersecret123";', C.js],
  ["SONAR-py-S2068", 'password = "supersecret123"', C.py],
  ["SONAR-java-S2068", 'String password = "supersecret123";', C.java],
  ["SONAR-cs-S2068", 'string password = "supersecret123";', C.cs],
  ["SONAR-js-S2245", 'const x = Math.random();', C.js], // é so-ast? ver
  // --- Injection ---
  ["SONAR-js-S2076", 'exec("ls " + userInput);', C.js],
  ["SONAR-js-S2078", 'ldap.search("(uid=" + userInput + ")");', C.js],
  ["SONAR-js-S2091", 'xpath.select("//user[" + input + "]");', C.js],
  ["SONAR-py-S2076", 'os.system("ls " + user_input)', C.py],
  ["SONAR-java-S2076", 'Runtime.getRuntime().exec("ls " + input);', C.java],
  // --- Path / file ---
  ["SONAR-js-S2083", 'fs.readFileSync(path.join("/data", req.query.f));', C.js],
  // --- XSS ---
  ["SONAR-js-S5131", 'element.innerHTML = req.query.name;', C.js],
  // --- Debug / logs ---
  ["SONAR-js-S4507", 'console.log("x");', C.js],
  ["SONAR-java-S4507", 'System.out.println("x");', C.java],
  ["SONAR-cs-S4507", 'Debug.WriteLine("x");', C.cs],
  // --- TODO (comments) ---
  ["SONAR-js-S1134", "// TODO: fix", C.js],
  ["SONAR-py-S1134", "# TODO: fix", C.py],
  ["SONAR-java-S1134", "// TODO: fix", C.java],
  ["SONAR-cs-S1134", "// TODO: fix", C.cs],
  ["SONAR-cobol-S1134", "      *> TODO: fix", C.cobol],
  // --- IP hardcoded ---
  ["SONAR-js-S1313", 'const ip = "192.168.1.1";', C.js],
  // --- Cookies ---
  ["SONAR-js-S3330", 'res.cookie("session", val, { httpOnly: false });', C.js],
  // --- Weak hash ---
  ["SONAR-js-S2070", 'const h = crypto.createHash("md5");', C.js],
  ["SONAR-java-S2070", 'MessageDigest.getInstance("MD5");', C.java],
  ["SONAR-cs-S2070", 'MD5.Create();', C.cs],
  // --- SQL ---
  ["SONAR-tsql-SQL.DynamicSqlCheck", "EXEC('SELECT * FROM ' + @t)", C.tsql],
];

let pass = 0, fail = 0;
const falhas = [];
for (const [id, code, file] of CASES) {
  const rule = RULES.find((r) => r.id === id);
  if (!rule) { console.log("⚠️ ", id, "não existe no catálogo"); continue; }
  const m = matchPattern(rule.pattern, code, { profile: lexicalProfileFor(file) });
  if (m.length > 0) { pass++; console.log("✅", id); }
  else { fail++; falhas.push(id); console.log("❌", id, "::", rule.pattern?.regex?.slice(0, 70)); }
}
console.log(`\n${pass}/${pass + fail} detectaram`);
if (falhas.length) console.log("Falhas:", falhas);
