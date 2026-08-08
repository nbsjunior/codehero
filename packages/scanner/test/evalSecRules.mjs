import { RULES } from "@codehero/contracts";
import { analyzeFile } from "@codehero/engine";

const secRules = RULES.filter((r) => r.id.startsWith("HERO-SEC-"));
console.log("Testando", secRules.length, "regras HERO-SEC...\n");

const testCases = {
  "HERO-SEC-0798-hardcoded-secret": {
    code: 'const password = "senha12345678";',
    file: "t.ts",
  },
  "HERO-SEC-0089-sql-injection": {
    code: 'db.query("SELECT " + userInput)',
    file: "t.ts",
  },
  "HERO-SEC-0095-code-injection-eval": {
    code: "eval(userInput)",
    file: "t.ts",
  },
  "HERO-SEC-0078-os-command": {
    code: "exec(userInput)",
    file: "t.ts",
  },
  "HERO-SEC-0079-xss-sink": {
    code: "element.innerHTML = userInput",
    file: "t.ts",
  },
  "HERO-SEC-0918-ssrf": {
    code: "fetch(`https://${userProvidedUrl}/api`)",
    file: "t.ts",
  },
  "HERO-SEC-0022-path-traversal": {
    code: "fs.readFileSync(req.query.path)",
    file: "t.ts",
  },
  "HERO-SEC-0601-open-redirect": {
    code: "res.redirect(`https://${userUrl}`)",
    file: "t.ts",
  },
  "HERO-SEC-1321-prototype-pollution": {
    code: "Object.assign({}, userInput)",
    file: "t.ts",
  },
  "HERO-SEC-0330-insecure-random": {
    code: "const token = Math.random().toString(36)",
    file: "t.ts",
  },
  "HERO-SEC-0295-tls-verify-disabled": {
    code: 'process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"',
    file: "t.ts",
  },
  "HERO-SEC-0532-secret-in-log": {
    code: 'console.log("password:", password)',
    file: "t.ts",
  },
  "HERO-SEC-0506-pipe-to-shell": {
    code: 'curl " + url + " | sh',
    file: "t.ts",
  },
  "HERO-SEC-0089-dynamic-sql-tsql": {
    code: "SET @sql = 'SELECT * FROM ' + @table",
    file: "t.sql",
  },
  "HERO-SEC-0089-adonet-sqli": {
    code: 'new SqlCommand("SELECT " + userInput)',
    file: "t.cs",
  },
  "HERO-SEC-0089-jdbc-sqli": {
    code: 'stmt.executeQuery("SELECT " + userInput)',
    file: "t.java",
  },
  "HERO-SEC-0078-cmd-injection-dotnet": {
    code: 'Process.Start("cmd", "/c " + userInput)',
    file: "t.cs",
  },
  "HERO-SEC-0078-cmd-injection-java": {
    code: 'Runtime.getRuntime().exec("cmd " + userInput)',
    file: "t.java",
  },
  "HERO-SEC-0502-insecure-deserialization-dotnet": {
    code: "new BinaryFormatter().Deserialize(stream)",
    file: "t.cs",
  },
  "HERO-SEC-0502-insecure-deserialization-java": {
    code: "new ObjectInputStream(stream).readObject()",
    file: "t.java",
  },
  "HERO-SEC-0611-xxe-java": {
    code: 'DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(xml)',
    file: "t.java",
  },
  "HERO-SEC-0611-xxe-dotnet": {
    code: 'new XmlDocument().LoadXml(xml)',
    file: "t.cs",
  },
  "HERO-SEC-0078-xp-cmdshell-tsql": {
    code: "EXEC xp_cmdshell 'dir'",
    file: "t.sql",
  },
  "HERO-SEC-0327-weak-hash-dotnet": {
    code: "MD5.Create()",
    file: "t.cs",
  },
  "HERO-SEC-0798-cobol-value-secret": {
    code: "01 PASSWORD PIC X(20) VALUE 'senha12345678'.",
    file: "t.cbl",
  },
  "HERO-SEC-cobol-accept-console": {
    code: "ACCEPT WS-PASSWORD FROM CONSOLE",
    file: "t.cbl",
  },
};

let pass = 0;
let fail = 0;
const failures = [];

for (const [id, { code, file }] of Object.entries(testCases)) {
  const rule = secRules.find((r) => r.id === id);
  if (!rule) {
    console.log("❌", id, "não encontrada");
    fail++;
    failures.push({ id, reason: "not found" });
    continue;
  }
  const f = analyzeFile({ file, source: code, rules: [rule] });
  if (f.length > 0) {
    console.log("✅", id);
    pass++;
  } else {
    console.log("❌", id, "não detectou");
    fail++;
    failures.push({ id, reason: "no detection", rule: rule.pattern?.regex?.slice(0, 80) });
  }
}

console.log(`\n${pass}/${pass + fail} regras detectaram`);
if (failures.length > 0) {
  console.log("\nFalhas:");
  failures.forEach((f) => console.log(" ", f.id, f.reason, f.rule || ""));
}
