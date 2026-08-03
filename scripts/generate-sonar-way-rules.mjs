#!/usr/bin/env node
/**
 * Generate packages/contracts/src/data/sonarWayRules.json from
 * scripts/data/sonar-way/*.json snapshots.
 *
 * - Live rules: synthesized L0 regex from templates (security + simple smells)
 * - Stub rules: never-match pattern; appear in catalog only (scanner skips stubs)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "scripts", "data", "sonar-way");
const OUT_DIR = join(ROOT, "packages", "contracts", "src", "data");
const OUT_JSON = join(OUT_DIR, "sonarWayRules.json");
const OUT_META = join(OUT_DIR, "sonarWayRules.meta.json");

const LANG_MAP = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  java: "java",
  cs: "csharp",
  cobol: "cobol",
  tsql: "tsql",
  plsql: "db2sql",
};

const SEV = new Set(["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"]);
const TYPE = new Set(["VULNERABILITY", "BUG", "CODE_SMELL", "SECURITY_HOTSPOT"]);

/** Never matches — catalog stub. */
const STUB_REGEX = "(?!x)x";

/**
 * Ordered templates: first match wins.
 * Each: { id, re, regex, flags?, unless?, effort }
 */
const TEMPLATES = [
  {
    id: "hardcoded-secret",
    // `hard-?cod` sozinho foi removido: ele casava com QUALQUER regra sobre
    // algo hardcoded (URI, IP, região da AWS, condição de laço) e, por vir
    // antes na lista, roubava a vez dos templates específicos `hardcoded-ip`
    // e `hardcoded-uri`. O detector aqui procura senha — aplicá-lo a "URIs
    // should not be hardcoded" produz achado errado com chave real do Sonar.
    re: /credential|password|secret|api[_ -]?key|private[_ -]?key/i,
    regex:
      "(?i)(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|private[_-]?key)\\s*[:=]\\s*['\"][^'\"]{8,}['\"]",
    effort: 15,
  },
  {
    id: "sql-injection",
    re: /sql\s*injection|dynamic\s*sql|sqli/i,
    regex:
      "(?i)(execute|executemany|query|rawQuery|createQuery|FromSqlRaw|SqlCommand)\\s*\\([^)]*(\\+|\\{\\s*0|`|\\$\\{)",
    effort: 45,
  },
  {
    id: "eval-code-injection",
    re: /\beval\b|code injection|dynamic code|Function\s*constructor/i,
    regex: "(?<![.\\w])(eval|exec)\\s*\\(",
    unless: "(?i)(#\\s*nosec|eslint-disable|safe-eval)",
    effort: 30,
  },
  {
    id: "os-command",
    re: /os command|command injection|shell injection|processbuilder|runtime\.exec|child_process|xp_cmdshell/i,
    regex:
      "(?i)(child_process|execSync|spawnSync|Runtime\\.getRuntime\\(\\)\\.exec|Process(Builder|\\.Start)|xp_cmdshell)\\s*(\\(|\\.)",
    effort: 45,
  },
  {
    id: "xss",
    re: /\bxss\b|cross-site scripting|innerHTML|dangerouslySetInnerHTML|document\.write/i,
    regex: "(?i)(innerHTML|outerHTML|dangerouslySetInnerHTML|document\\.write)\\s*[=(]",
    effort: 30,
  },
  {
    id: "path-traversal",
    re: /path traversal|directory traversal|zip slip|path injection/i,
    regex: "(?i)(\\.\\./|\\.\\.\\\\|path\\.join\\([^)]*req\\.|getParameter\\([^)]*\\)\\s*\\+)",
    effort: 30,
  },
  {
    id: "ssrf",
    re: /\bssrf\b|server-side request forgery/i,
    regex: "(?i)(fetch|axios|request|http\\.get|WebClient|HttpClient)\\s*\\([^)]*(req\\.|request\\.|params\\.|query\\.)",
    effort: 45,
  },
  {
    id: "open-redirect",
    re: /open redirect|unvalidated redirect/i,
    regex: "(?i)(res\\.redirect|Response\\.Redirect|sendRedirect)\\s*\\([^)]*(req\\.|request\\.|params)",
    effort: 20,
  },
  {
    id: "weak-hash",
    re: /weak (hash|crypt)|\bmd5\b|\bsha-?1\b|broken cryptograph/i,
    regex: "(?i)\\b(md5|sha1|SHA1|MD5|DES|RC4)\\b\\s*(\\(|Managed|Crypto)",
    effort: 30,
  },
  {
    id: "insecure-random",
    re: /insecure random|pseudorandom|math\.random|predictable.*random/i,
    regex: "(?i)(Math\\.random|java\\.util\\.Random|rand\\()",
    effort: 15,
  },
  {
    id: "tls-verify",
    re: /certificate|ssl.?tls|rejectUnauthorized|hostname verif|insecure trust/i,
    regex: "(?i)(rejectUnauthorized\\s*:\\s*false|TRUST_ALL|InsecureSkipVerify|setHostnameVerifier)",
    effort: 30,
  },
  {
    id: "xxe",
    re: /\bxxe\b|xml external entity|external entity/i,
    regex: "(?i)(DocumentBuilderFactory|XMLReader|SAXParser|XmlDocument)",
    effort: 30,
  },
  {
    id: "deserialization",
    re: /deserializ|ObjectInputStream|BinaryFormatter|pickle\.loads|readObject/i,
    regex: "(?i)(ObjectInputStream|BinaryFormatter|pickle\\.loads|Yaml\\.load\\(|readObject\\()",
    effort: 45,
  },
  {
    id: "prototype-pollution",
    re: /prototype pollution|__proto__/i,
    regex: "(?i)(__proto__|prototype\\s*\\[|Object\\.assign\\([^,]+,\\s*req\\.)",
    effort: 45,
  },
  {
    id: "debug-log",
    re: /debug(ging)? feature|console\.(log|debug)|System\.out|Debug\.Write|\bprint\s*\(/i,
    regex: "(?i)(console\\.(log|debug|info)|System\\.out\\.print|Debug\\.Write(Line)?|print\\()",
    effort: 5,
  },
  {
    id: "todo-fixme",
    re: /\btodo\b|fixme|\bhack\b/i,
    regex: "(?i)\\b(TODO|FIXME|HACK)\\b",
    effort: 2,
  },
  {
    id: "empty-catch",
    re: /empty (catch|except)|swallowed exception|catch block should/i,
    regex: "catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}",
    effort: 10,
  },
  {
    id: "eqeqeq",
    re: /strict equality|===|loose equal|use identical/i,
    regex: "[^=!]==[^=]",
    effort: 5,
  },
  {
    id: "eval-like-settimeout",
    re: /settimeout.*string|setinterval.*string/i,
    regex: "(?i)set(Timeout|Interval)\\s*\\(\\s*['\"]",
    effort: 20,
  },
  {
    id: "http-cleartext",
    re: /clear-?text|unencrypted (http|protocol)|plain.?text protocol/i,
    regex: "(?i)(['\"])http://(?!localhost|127\\.0\\.0\\.1)",
    effort: 15,
  },
  {
    id: "cors-star",
    re: /\bcors\b|access-control-allow-origin/i,
    regex: "(?i)Access-Control-Allow-Origin['\"\\s:]*\\*",
    effort: 20,
  },
  {
    id: "cookie-secure",
    re: /cookie.*secure|secure.?flag/i,
    regex: "(?i)(setCookie|Set-Cookie|CookieOptions)",
    effort: 10,
  },
  {
    id: "goto-cobol",
    re: /\bgoto\b/i,
    regex: "(?i)\\bGO\\s*TO\\b",
    effort: 20,
  },
  {
    id: "exec-immediate-sql",
    re: /execute\s+immediate|dynamic sql/i,
    regex: "(?i)EXECUTE\\s+IMMEDIATE",
    effort: 40,
  },
  {
    id: "csrf",
    re: /\bcsrf\b|anti.?forgery|validateantiForgery/i,
    regex: "(?i)(IgnoreAntiforgeryToken|csrf\\s*:\\s*false|disable.*csrf|CSRF.*disabled)",
    effort: 25,
  },
  {
    id: "httponly-cookie",
    re: /httponly|http-only/i,
    regex: "(?i)(httpOnly\\s*:\\s*false|HttpOnly\\s*=\\s*false)",
    effort: 10,
  },
  {
    id: "weak-tls-protocol",
    re: /weak ssl|tls 1\.[01]|sslv3|deprecated protocol/i,
    regex: "(?i)(SSLv3|TLSv1\\.0|TLSv1\\.1|SslProtocols\\.Ssl3|SecurityProtocolType\\.Ssl3)",
    effort: 20,
  },
  {
    id: "jwt-weak",
    re: /\bjwt\b|json web token/i,
    regex: "(?i)(algorithm\\s*:\\s*['\"]none['\"]|jwt\\.(decode|verify)\\([^)]*algorithms\\s*:\\s*\\[\\s*\\])",
    effort: 30,
  },
  {
    id: "ldap-injection",
    re: /\bldap\b/i,
    regex: "(?i)(LdapConnection|DirectorySearcher|ldapjs|ldap\\.search)\\s*(\\(|\\.)",
    effort: 30,
  },
  {
    id: "xpath-injection",
    re: /xpath/i,
    regex: "(?i)(SelectNodes|xpath|XPathExpression).*(\\+|\\$\\{)",
    effort: 30,
  },
  {
    id: "regex-dos",
    re: /regex.*(denial|dos|timeout)|regular expression.*vulnerable/i,
    regex: "(?i)new\\s+RegExp\\s*\\([^)]*(\\+|\\$\\{|`)",
    effort: 20,
  },
  {
    id: "file-permission-world",
    re: /world-accessible|file permission|chmod\s*777/i,
    regex: "(?i)(chmod\\s*\\(?\\s*0?777|FileSystemRights\\.FullControl|777)",
    effort: 15,
  },
  {
    id: "disabled-validation",
    re: /request validation|validateinput|disabled.*validat/i,
    regex: "(?i)(ValidateInput\\s*\\(\\s*false|requestValidationMode\\s*=\\s*['\"]?0)",
    effort: 20,
  },
  {
    id: "mass-assignment",
    re: /mass assignment/i,
    regex: "(?i)(bind\\(\\s*req\\.body|Object\\.assign\\(\\s*\\w+\\s*,\\s*req\\.body)",
    effort: 25,
  },
  {
    id: "var-keyword",
    re: /\b\"var\"\b|var keyword|unexpected var/i,
    regex: "(?<![\\w])var\\s+[A-Za-z_$]",
    effort: 2,
  },
  {
    id: "any-type",
    re: /\bany\b type|explicit any|Forbidden any/i,
    regex: ":\\s*any\\b",
    effort: 5,
  },
  {
    id: "ts-non-null",
    re: /non-null assertion/i,
    regex: "\\w+!(?:\\.|\\[|\\s|;|,|\\))",
    effort: 5,
  },
  {
    id: "nested-ternary",
    re: /nested ternary|collapsible if/i,
    regex: "\\?[^:;\\n]{0,80}\\?[^:;\\n]{0,80}:",
    effort: 10,
  },
  {
    id: "debugger-statement",
    re: /\bdebugger\b/i,
    regex: "(?<![\\w])debugger(?![\\w])",
    effort: 2,
  },
  {
    id: "alert",
    re: /\balert\b|\bconfirm\b|\bprompt\b/i,
    regex: "(?<![.\\w])(alert|confirm|prompt)\\s*\\(",
    effort: 5,
  },
  {
    id: "with-statement",
    re: /\bwith\s+statement|\bwith\s*\(/i,
    regex: "(?<![\\w])with\\s*\\(",
    effort: 10,
  },
  {
    id: "delete-array",
    re: /delete.*array|operator delete/i,
    regex: "(?<![\\w])delete\\s+\\w+\\s*\\[",
    effort: 5,
  },
  {
    id: "void-operator",
    re: /\bvoid\s+operator|void 0/i,
    regex: "(?<![\\w])void\\s+",
    effort: 2,
  },
  {
    id: "parseint-radix",
    re: /parseint.*radix|radix parameter/i,
    regex: "parseInt\\s*\\(\\s*[^,)]+\\s*\\)",
    effort: 5,
  },
  {
    id: "naive-datetime",
    re: /naive datetime|utcnow|datetime\.now/i,
    regex: "(?i)(datetime\\.now\\(|DateTime\\.Now|new Date\\(\\s*\\))",
    effort: 10,
  },
  {
    id: "assert-statement",
    re: /\bassert\b.*production|assertions should not/i,
    regex: "(?<![\\w])assert\\s*\\(",
    effort: 5,
  },
  // --- expanded Sonar way coverage ---
  {
    id: "hardcoded-ip",
    re: /hard-?coded ip|ip address.*hard/i,
    regex: "(?<![\\d.])(?:\\d{1,3}\\.){3}\\d{1,3}(?![\\d.])",
    effort: 10,
  },
  {
    id: "hardcoded-uri",
    // Aceita as duas ordens: "hardcoded URI" e "URIs should not be hardcoded".
    re: /hard-?coded (uri|url)|(uri|url)s?\b.*hard-?cod|absolute uri/i,
    regex: "(?i)(['\"])https?://[^'\"]+\\1",
    effort: 10,
  },
  {
    id: "weak-cipher",
    // \b nos acrônimos: sem eles, /DES/i casa DENTRO de "design" — e como o
    // haystack inclui as tags do Sonar, toda regra marcada `design` herdava
    // um detector de criptografia fraca. Foram 75 mapeamentos errados.
    re: /cipher algorithm|encryption algorithm|weak cipher|\bDES\b|\bRC4\b|\bBlowfish\b/i,
    regex: "(?i)\\b(DES|DESede|RC2|RC4|Blowfish|AES/ECB)\\b",
    effort: 30,
  },
  {
    id: "cbc-iv",
    re: /cipher block chaining|ivs? should be unpredictable|initialization vector/i,
    regex: "(?i)\\b(Aes|AES|Cipher)\\w*.*\\b(IV|Iv|iv)\\b|CreateEncryptor\\(\\s*\\)",
    effort: 25,
  },
  {
    id: "crypto-keys-robust",
    re: /cryptographic keys? should be robust|key size|key length/i,
    regex: "(?i)(KeySize\\s*=\\s*(512|1024)|RSA\\([^)]*1024|generateKeyPair\\([^)]*1024)",
    effort: 30,
  },
  {
    id: "clear-temp-files",
    re: /temporary files?|tmp file|temp directory|publicly writable/i,
    regex: "(?i)(/tmp/|\\\\Temp\\\\|os\\.tmpdir|Path\\.GetTempFileName|File\\.createTempFile)",
    effort: 15,
  },
  {
    id: "stack-trace-disclosure",
    re: /stack traces? should not be disclosed|printStackTrace|exception message to user/i,
    regex: "(?i)(printStackTrace\\(|ex\\.ToString\\(\\)|err\\.stack|getStackTrace\\()",
    effort: 15,
  },
  {
    id: "sql-format-string",
    re: /formatted sql|string format.*sql|interpolate.*sql/i,
    regex: "(?i)(SELECT|INSERT|UPDATE|DELETE)[^;\\n]{0,120}(%s|\\{\\d+\\}|\\$\\{)",
    effort: 45,
  },
  {
    id: "nosql-injection",
    re: /nosql|mongodb.*inject|\$where/i,
    regex: "(?i)(\\$where|find\\(\\s*\\{[^}]*req\\.|collection\\.find\\([^)]*\\+)",
    effort: 40,
  },
  {
    id: "xml-injection",
    re: /xml injection|xml operations should not be vulnerable/i,
    regex: "(?i)(XmlDocument|XDocument|DocumentBuilder).*(\\+|\\$\\{|append\\()",
    effort: 30,
  },
  {
    id: "reflection-injection",
    re: /reflection should not be vulnerable|Class\.forName|Activator\.CreateInstance/i,
    regex: "(?i)(Class\\.forName|Activator\\.CreateInstance|require\\(\\s*[^'\"\\)]|import\\(\\s*[^'\"\\)])",
    effort: 35,
  },
  {
    id: "session-fixation",
    re: /session (fixation|cookie).*untrusted|create session cookies from untrusted/i,
    regex: "(?i)(session\\[|Session\\[|setAttribute\\().*(req\\.|request\\.|params)",
    effort: 30,
  },
  {
    id: "csp-restrictive",
    re: /content security polic|\bcsp\b/i,
    regex: "(?i)Content-Security-Policy['\"\\s:]*[^;]*(unsafe-inline|unsafe-eval|\\*)",
    effort: 20,
  },
  {
    id: "disabled-csrf-spring",
    re: /csrf|csrfConfigurer|http\.csrf/i,
    regex: "(?i)(csrf\\(\\)\\.disable|csrf\\.disable|IgnoreAntiforgeryToken|enableCsrf\\s*:\\s*false)",
    effort: 25,
  },
  {
    id: "permit-all",
    re: /permitAll|authorizeHttpRequests|security matcher/i,
    regex: "(?i)(permitAll\\(\\)|Authorize\\(Roles\\s*=\\s*\"\\*\"\\)|\\[AllowAnonymous\\])",
    effort: 25,
  },
  {
    id: "public-writable",
    re: /world-writable|777|everyone.*full control/i,
    regex: "(?i)(chmod\\s*\\(?\\s*['\"]?0?777|FileSystemAccessRule\\([^)]*Everyone)",
    effort: 15,
  },
  {
    id: "http-method-restrict",
    re: /http methods|http routes should restrict|RequestMethod/i,
    regex: "(?i)@(RequestMapping|GetMapping|PostMapping)\\([^)]*method\\s*=",
    effort: 10,
  },
  {
    id: "disabled-autoescape",
    re: /auto-?escap|autoescape|html template/i,
    regex: "(?i)(autoescape\\s*(=|:)\\s*false|escape\\s*:\\s*false|\\{\\{\\{)",
    effort: 25,
  },
  {
    id: "hostname-verify",
    re: /hostname.*(verif|check)|setHostnameVerifier|Server hostnames should be verified/i,
    regex: "(?i)(setHostnameVerifier|HostnameVerifier|checkServerIdentity\\s*:\\s*\\(\\)\\s*=>\\s*true)",
    effort: 30,
  },
  {
    id: "weak-ssl-protocols",
    re: /weak ssl|ssl.?tls protocols|TLSv1(?!\.[23])|Ssl3/i,
    regex: "(?i)(SSLv3|TLSv1(?!\\.[23])|SecurityProtocolType\\.(Ssl3|Tls)\\b|ssl_version\\s*=\\s*['\"]?TLSv1['\"]?)",
    effort: 25,
  },
  {
    id: "android-intent",
    re: /intent|broadcast receiver|android/i,
    regex: "(?i)(sendBroadcast\\(|registerReceiver\\(|Intent\\.setAction)",
    effort: 20,
  },
  {
    id: "version-disclosure",
    re: /disclose version|server version|x-powered-by/i,
    regex: "(?i)(X-Powered-By|Server:\\s*|spring\\.mvc\\.dispatchOPTIONS)",
    effort: 10,
  },
  {
    id: "regex-backtrack",
    re: /regular expressions? should|catastrophic backtracking|regex.*timeout/i,
    regex: "(?i)new\\s+RegExp\\s*\\(|Pattern\\.compile\\s*\\(|Regex\\s*\\(",
    effort: 15,
  },
  {
    id: "empty-function",
    re: /empty (function|method|subroutine)|function should not be empty/i,
    regex: "(?:function\\s*\\w*|=>)\\s*\\{\\s*\\}",
    effort: 5,
  },
  {
    id: "unused-import",
    re: /unused import|unnecessary import|remove this unused/i,
    regex: "(?i)^\\s*import\\s+[\\w.{*}\\s,]+;\\s*$",
    effort: 2,
  },
  {
    id: "commented-code",
    re: /commented.?out code|section of code.*commented/i,
    regex: "^\\s*//\\s*(if|for|while|return|const|let|var|public|private)\\b",
    flags: "m",
    effort: 5,
  },
  {
    id: "magic-number",
    re: /magic number/i,
    regex: "(?<![\\w.])(?!0\\b|1\\b|-1\\b)\\d{2,}(?![\\w.])",
    effort: 5,
  },
  {
    id: "nested-if",
    re: /collapsible if|merge this if|nested if/i,
    regex: "if\\s*\\([^)]*\\)\\s*\\{\\s*if\\s*\\(",
    effort: 10,
  },
  {
    id: "switch-default",
    re: /switch.*default|default clause|missing default/i,
    regex: "(?i)switch\\s*\\([^)]*\\)\\s*\\{(?:(?!\\bdefault\\b)[^}]){0,400}\\}",
    effort: 10,
  },
  {
    id: "identical-branches",
    re: /identical (branches|cases)|same code on both/i,
    regex: "if\\s*\\(([^)]+)\\)\\s*\\{([^}]{5,80})\\}\\s*else\\s*\\{\\2\\}",
    effort: 15,
  },
  {
    id: "unused-var",
    re: /unused (local )?variable|never used|remove this unused/i,
    regex: "(?i)(unused|never used)",
    effort: 5,
  },
  {
    id: "equals-hashcode",
    re: /equals.*hashcode|hashCode.*equals/i,
    regex: "(?i)(equals\\s*\\(|hashCode\\s*\\()",
    effort: 20,
  },
  {
    id: "null-deref",
    re: /null pointer|NullReference|possible null|NPE/i,
    regex: "(?i)(\\w+\\.\\w+\\([^)]*\\)\\.\\w+|!\\.|\\?\\.)",
    effort: 15,
  },
  {
    id: "resource-close",
    re: /close (this )?resource|should be closed|AutoCloseable|using statement/i,
    regex: "(?i)(new\\s+File(Input|Output)Stream|new\\s+Connection|SqlConnection\\s*\\()",
    effort: 20,
  },
  {
    id: "await-promise",
    re: /promise.*await|floating promise|not awaited/i,
    regex: "(?<![\\w.])(fetch|axios|fs\\.promises)\\s*\\([^)]*\\)\\s*;",
    effort: 10,
  },
  {
    id: "mutable-default",
    re: /mutable default|default argument.*list|default value.*dict/i,
    regex: "def\\s+\\w+\\s*\\([^)]*=\\s*(\\[[^\\]]*\\]|\\{[^}]*\\})",
    effort: 15,
  },
  {
    id: "bare-except",
    re: /bare except|catch Exception|except:/i,
    regex: "(?i)(except\\s*:|catch\\s*\\(\\s*Exception\\s+|/catch\\s*\\(\\s*\\))",
    effort: 10,
  },
  {
    id: "print-statement-py",
    re: /print statement|\bprint\b/i,
    regex: "(?<![\\w])print\\s*\\(",
    effort: 5,
  },
  {
    id: "exec-sql-cobol",
    re: /exec sql|embedded sql/i,
    regex: "(?i)EXEC\\s+SQL",
    effort: 20,
  },
  {
    id: "alter-cobol",
    re: /\balter\b.*go\s*to|ALTER .* TO PROCEED/i,
    regex: "(?i)\\bALTER\\s+[\\w-]+\\s+TO\\b",
    effort: 25,
  },
  {
    id: "select-star",
    re: /select \*|select-star|avoid select \*/i,
    regex: "(?i)SELECT\\s+\\*\\s+FROM",
    effort: 10,
  },
  {
    id: "drop-table",
    re: /drop table|truncate table/i,
    regex: "(?i)\\b(DROP|TRUNCATE)\\s+TABLE\\b",
    effort: 20,
  },
  {
    id: "grant-all",
    re: /grant all|grant.*public/i,
    regex: "(?i)GRANT\\s+(ALL|SELECT|INSERT).*TO\\s+(PUBLIC|GUEST)",
    effort: 25,
  },
  {
    id: "waitfor-delay",
    re: /waitfor|\bsleep\b/i,
    regex: "(?i)(WAITFOR\\s+DELAY|SLEEP\\s*\\()",
    effort: 10,
  },
  {
    id: "xp-cmdshell",
    re: /xp_cmdshell|cmdshell/i,
    regex: "(?i)xp_cmdshell",
    effort: 45,
  },
  {
    id: "unsafe-code-csharp",
    re: /unsafe code|\bunsafe\b/i,
    regex: "(?<![\\w])unsafe\\s*\\{",
    effort: 20,
  },
  {
    id: "binary-formatter",
    re: /BinaryFormatter|LosFormatter|SoapFormatter/i,
    regex: "(?i)(BinaryFormatter|LosFormatter|SoapFormatter|NetDataContractSerializer)",
    effort: 45,
  },
  {
    id: "viewstate-mac",
    re: /viewstate|enableViewStateMac/i,
    regex: "(?i)(enableViewStateMac\\s*=\\s*false|ViewStateEncryptionMode\\s*=\\s*Never)",
    effort: 25,
  },
  {
    id: "request-validation-mode",
    re: /requestValidationMode|validateRequest/i,
    regex: "(?i)(validateRequest\\s*=\\s*false|requestValidationMode\\s*=\\s*[\"']?2\\.0)",
    effort: 20,
  },
  {
    id: "spring-expression",
    re: /spel|spring expression|EvaluationContext/i,
    regex: "(?i)(SpelExpressionParser|parseExpression\\()",
    effort: 35,
  },
  {
    id: "object-finalize",
    re: /finalize\(|Object\.finalize/i,
    regex: "(?<![\\w])finalize\\s*\\(\\s*\\)",
    effort: 15,
  },
  {
    id: "thread-run",
    re: /Thread\.run|override run\(\)/i,
    regex: "(?i)(new\\s+Thread\\([^)]*\\)\\.run\\(|\\.run\\(\\)\\s*;)",
    effort: 15,
  },
  {
    id: "double-checked-locking",
    re: /double-checked locking|double.checked/i,
    regex: "(?i)if\\s*\\(\\s*\\w+\\s*==\\s*null\\)[^{]*synchronized",
    effort: 20,
  },
  {
    id: "serial-version-uid",
    re: /serialVersionUID/i,
    regex: "serialVersionUID",
    effort: 5,
  },
  {
    id: "instanceof",
    re: /instanceof.*cast|getClass\(\)/i,
    regex: "(?<![\\w])instanceof\\s+",
    effort: 5,
  },
  {
    id: "console-error",
    re: /console\.(error|warn)|logger misuse/i,
    regex: "(?i)console\\.(error|warn|log)\\s*\\(",
    effort: 5,
  },
  {
    id: "document-cookie",
    re: /document\.cookie/i,
    regex: "document\\.cookie",
    effort: 15,
  },
  {
    id: "localstorage-secret",
    re: /localStorage|sessionStorage/i,
    regex: "(?i)(localStorage|sessionStorage)\\.(setItem|getItem)",
    effort: 15,
  },
  {
    id: "postmessage-origin",
    re: /postMessage|message event/i,
    regex: "(?i)postMessage\\s*\\([^)]*\\*",
    effort: 25,
  },
  {
    id: "innerhtml-assign",
    re: /innerHTML|outerHTML/i,
    regex: "(?i)\\.(innerHTML|outerHTML)\\s*=",
    effort: 30,
  },
  {
    id: "dangerously-set",
    re: /dangerouslySetInnerHTML/i,
    regex: "dangerouslySetInnerHTML",
    effort: 30,
  },
  {
    id: "eval-js",
    re: /\beval\b|new Function/i,
    regex: "(?<![.\\w])(eval|Function)\\s*\\(",
    effort: 30,
  },
  {
    id: "child-process",
    re: /child_process|execFile|\bspawn\b/i,
    regex: "(?i)(child_process|execFile|execSync|spawnSync)\\b",
    effort: 40,
  },
  {
    id: "fs-path-join-req",
    re: /path\.join|readFile.*req|user.controlled path/i,
    regex: "(?i)(readFile|writeFile|createReadStream|path\\.join)\\s*\\([^)]*(req\\.|request\\.|params\\.|query\\.)",
    effort: 30,
  },
  {
    id: "python-pickle",
    re: /pickle|marshal\.loads|yaml\.load/i,
    regex: "(?i)(pickle\\.loads|marshal\\.loads|yaml\\.load\\(|shelve\\.open)",
    effort: 45,
  },
  {
    id: "python-subprocess-shell",
    re: /subprocess|shell\s*=\s*True/i,
    regex: "(?i)(subprocess\\.(call|run|Popen)|os\\.system|shell\\s*=\\s*True)",
    effort: 40,
  },
  {
    id: "python-assert",
    re: /assert statement|asserts? should not be used/i,
    regex: "(?<![\\w])assert\\s+",
    effort: 10,
  },
  {
    id: "java-runtime-exec",
    re: /Runtime\.exec|ProcessBuilder/i,
    regex: "(?i)(Runtime\\.getRuntime\\(\\)\\.exec|new\\s+ProcessBuilder)",
    effort: 45,
  },
  {
    id: "java-objectinput",
    re: /ObjectInputStream|readObject/i,
    regex: "(?i)(ObjectInputStream|readUnshared|readObject\\s*\\()",
    effort: 45,
  },
  {
    id: "java-scriptengine",
    re: /ScriptEngine|Nashorn|GraalJS/i,
    regex: "(?i)(ScriptEngineManager|getEngineByName|eval\\s*\\()",
    effort: 35,
  },
];

/**
 * Pré-checagem: acrônimo curto sem \b casa DENTRO de palavra comum.
 *
 * Foi assim que `DES` (do template de cifra fraca) casou com a tag `design` e
 * deu detector de criptografia a 75 regras que não tinham nada com o assunto.
 * O custo de errar aqui é alto — o achado sai errado carregando uma chave real
 * do Sonar — então isto aborta a geração em vez de avisar.
 */
const PALAVRAS_ARMADILHA = [
  "design", "designed", "described", "modes", "suspicious", "redundant",
  "unused", "used", "closed", "based", "encoded", "hardcoded", "deprecated",
  "standard", "index", "expression", "duplicated", "declared", "nested",
];

function assertTemplatesSaoEspecificos() {
  const problemas = [];
  for (const t of TEMPLATES) {
    for (const alt of t.re.source.split("|").map((a) => a.trim())) {
      if (!/^[A-Za-z0-9]{2,6}$/.test(alt)) continue; // só acrônimos soltos
      let re;
      try {
        re = new RegExp(alt, t.re.flags);
      } catch {
        continue;
      }
      const colide = PALAVRAS_ARMADILHA.filter(
        (p) => re.test(p) && p.toLowerCase() !== alt.toLowerCase(),
      );
      if (colide.length) {
        problemas.push(`  template "${t.id}": "${alt}" casa dentro de ${colide.join(", ")}`);
      }
    }
  }
  if (problemas.length) {
    throw new Error(
      `Template com acrônimo sem delimitador de palavra (use \\b):\n${problemas.join("\n")}`,
    );
  }
}

/**
 * Um detector só pode ser atribuído se casar com o NOME da regra — que é a
 * descrição semântica dela. As tags do Sonar (`design`, `suspicious`, `cwe`…)
 * são categóricas e casam com qualquer coisa; foi por elas que 75 regras sem
 * relação com criptografia ganharam um detector de cifra fraca.
 *
 * As tags seguem valendo como DESEMPATE: se o nome casou, elas podem reforçar,
 * mas nunca decidir sozinhas.
 */
function pickTemplate(name, tags, type) {
  for (const t of TEMPLATES) {
    if (t.re.test(name ?? "")) return t;
  }
  // Sem correspondência no nome, vira stub. Não inventamos detector genérico
  // — um achado errado carregando uma chave real do Sonar é pior que a
  // ausência do achado.
  void tags;
  void type;
  return null;
}

function mapSeverity(s) {
  const u = String(s ?? "MAJOR").toUpperCase();
  return SEV.has(u) ? u : "MAJOR";
}

function mapType(t) {
  const u = String(t ?? "CODE_SMELL").toUpperCase();
  return TYPE.has(u) ? u : "CODE_SMELL";
}

function heroId(lang, key) {
  // javascript:S2068 → SONAR-js-S2068
  const short = String(key).includes(":") ? String(key).split(":").pop() : String(key);
  const safe = short.replace(/[^A-Za-z0-9._-]/g, "_");
  return `SONAR-${lang}-${safe}`;
}

function sddFor(tmplId, type) {
  const byTmpl = {
    "hardcoded-secret": "sdd.secret.externalize",
    "sql-injection": "sdd.sqli.parametrize",
    "eval-code-injection": "sdd.eval.remove",
    "os-command": "sdd.cmd.avoid-shell",
    xss: "sdd.xss.sanitize",
    "path-traversal": "sdd.path.normalize-allowlist",
    ssrf: "sdd.ssrf.allowlist",
    "open-redirect": "sdd.redirect.allowlist",
    "weak-hash": "sdd.crypto.upgrade-hash",
    "insecure-random": "sdd.crypto.secure-random",
    "tls-verify": "sdd.tls.enable-verify",
    xxe: "sdd.xxe.disable-external-entities",
    deserialization: "sdd.deserialize.avoid-unsafe",
    "prototype-pollution": "sdd.merge.safe-assign",
    "debug-log": "sdd.smell.remove-debug",
    "todo-fixme": "sdd.smell.resolve-todo",
    "goto-cobol": "sdd.smell.restructure-goto",
  };
  if (tmplId && byTmpl[tmplId]) return byTmpl[tmplId];
  if (type === "VULNERABILITY" || type === "SECURITY_HOTSPOT") return "sdd.generic.secure-fix";
  if (type === "BUG") return "sdd.generic.bugfix";
  return "sdd.generic.smell";
}

function categoryFor(type, tags) {
  const t = (tags ?? []).join(" ").toLowerCase();
  if (type === "CODE_SMELL") return "code-smell";
  if (/inject|sql|xss|command/.test(t)) return "string-injection";
  if (/crypt|hash|tls|ssl|cipher/.test(t)) return "weak-crypto";
  if (/secret|password|credential|privacy/.test(t)) return "sensitive-data-exposure";
  if (/ssrf/.test(t)) return "ssrf";
  if (/auth|session|cookie/.test(t)) return "authentication-failures";
  return type === "VULNERABILITY" || type === "SECURITY_HOTSPOT"
    ? "security-misconfiguration"
    : "code-smell";
}


// ---------------------------------------------------------------------------
// Trava: acronimo curto SEM ancora a esquerda e o modo de falha mais caro
// deste gerador. `(?i)(DES|RC4|...)` casa dentro de "Insecure Design", de
// "ZCodeScan" e de "includes(" — foram 650 achados falsos num repo de 26 mil
// linhas, metade de tudo que o scanner reportou, em duas regras CRITICAL.
//
// A versao anterior desta trava conferia as regexes de SELECAO de template.
// Errado: quem vai para producao e a regex EMITIDA.
//
// Ancora a ESQUERDA e o que importa. `(md5|DES)\s*\(` tem sufixo e ainda
// assim casou `includes(`, porque nada segurava o inicio. Prefixo literal
// (`console\.`), `` ou lookbehind seguram; inicio da regex e `.*` nao.
// ---------------------------------------------------------------------------
const ACRONIMO_CURTO = /^[A-Za-z][A-Za-z0-9]{0,3}$/;

function detectorTemPerigoDeSubstring(regex) {
  const corpo = regex.replace(/^\(\?i\)/, "");
  const desloc = regex.length - corpo.length;
  for (const grupo of regex.matchAll(/\(([^()]*\|[^()]*)\)/g)) {
    const curtas = grupo[1]
      .split("|")
      .map((a) => a.replace(/\b/g, ""))
      .filter((a) => ACRONIMO_CURTO.test(a));
    if (curtas.length === 0) continue;
    if (grupo[1].includes("\b")) continue;

    const i = grupo.index;
    const antes = regex.slice(0, i);
    const noInicio = i === desloc;
    const aposCoringa = /(\.\*|\.\+)$/.test(antes);
    if (!noInicio && !aposCoringa) continue; // ha prefixo literal ancorando

    return (
      `alternativa curta [${curtas.join(", ")}] sem ancora a esquerda` +
      (noInicio ? " (grupo abre a regex)" : " (precedido de .*)")
    );
  }
  return null;
}

function assertDetectoresSaoEspecificos(templates) {
  const erros = [];
  for (const t of templates) {
    if (!t.regex) continue;
    const problema = detectorTemPerigoDeSubstring(t.regex);
    if (problema) erros.push(`  ${t.id ?? t.name ?? "(sem id)"}: ${problema}
    regex: ${t.regex}`);
  }
  if (erros.length) {
    throw new Error(
      `Geracao abortada: ${erros.length} detector(es) casariam substring dentro de palavra:
` +
        erros.join("
"),
    );
  }
}

async function main() {
  assertTemplatesSaoEspecificos();
  const index = JSON.parse(await readFile(join(DATA, "index.json"), "utf8"));
  const rules = [];
  const stats = { total: 0, live: 0, stub: 0, byLang: {}, byTemplate: {} };

  for (const [lang, meta] of Object.entries(index.languages)) {
    if (!meta.available || !meta.file) continue;
    const snap = JSON.parse(await readFile(join(DATA, meta.file), "utf8"));
    const heroLang = LANG_MAP[lang];
    if (!heroLang) continue;
    stats.byLang[lang] = { total: 0, live: 0, stub: 0 };

    for (const sr of snap.rules) {
      stats.total += 1;
      stats.byLang[lang].total += 1;
      const type = mapType(sr.type);
      const tags = sr.tags ?? [];
      const tmpl = pickTemplate(sr.name ?? "", tags, type);
      const id = heroId(lang, sr.key);
      const implementation = tmpl ? "sonar-port" : "stub";
      const pattern = tmpl
        ? {
            regex: tmpl.regex,
            ...(tmpl.flags ? { flags: tmpl.flags } : {}),
            ...(tmpl.unless ? { unless: tmpl.unless } : {}),
          }
        : { regex: STUB_REGEX };

      if (tmpl) {
        stats.live += 1;
        stats.byLang[lang].live += 1;
        stats.byTemplate[tmpl.id] = (stats.byTemplate[tmpl.id] ?? 0) + 1;
      } else {
        stats.stub += 1;
        stats.byLang[lang].stub += 1;
      }

      rules.push({
        id,
        name: sr.name || sr.key,
        languages: [heroLang],
        severity: mapSeverity(sr.severity),
        type,
        remediationEffortMin: tmpl?.effort ?? 10,
        cwe: sr.cwe?.length ? sr.cwe : tags.includes("cwe") ? [] : [],
        owasp: sr.owasp ?? [],
        message: sr.name || `Sonar way: ${sr.key}`,
        sddTemplateId: sddFor(tmpl?.id ?? null, type),
        category: categoryFor(type, tags),
        pattern,
        sonarKey: sr.key,
        implementation,
      });
    }
  }

  // Stable order
  rules.sort((a, b) => a.id.localeCompare(b.id));

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_JSON, JSON.stringify(rules));
  await writeFile(
    OUT_META,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: index.source,
        fetchedAt: index.fetchedAt,
        stats,
      },
      null,
      2,
    ),
  );

  console.log(`Wrote ${rules.length} rules → ${OUT_JSON}`);
  console.log(`Live (L0 port): ${stats.live} · Stub (catalog): ${stats.stub}`);
  console.log(JSON.stringify(stats.byLang, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
