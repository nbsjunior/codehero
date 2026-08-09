# CodeHero × Sonar way — coverage report

Generated: 2026-08-09T21:09:00.049Z
Source: `https://next.sonarqube.com/sonarqube/api` (fetched 2026-07-28T13:07:41.908Z)

## Verdict

Cobertura **semântica** (Hero core ↔ nomes/CWE Sonar): **19%** (138 covered + 368 partial out of **2668**).

Cobertura **live scannable** (curadoria → motor): **18.4%** do catálogo (492/2668); VULN **68.9%** (330/479). Stubs **não** contam.

Of **83** canonical Hero rules, **65** (78.3%) have at least one Sonar analogue; **42** (50.6%) appear in the golden corpus (566 cases).

## Limitations

- Semantic match (Hero core ↔ Sonar names/CWE) ≠ live scannable catalog coverage.
- covered/partial ≠ equivalent detection power (L0 regex vs Sonar analyzers).
- Live scannable = sonarWayCuration.selecao; stubs do catálogo não disparam no scanner.
- plsql snapshot is a public proxy for DB2SQL (no dedicated DB2 Sonar way on the public instance).
- Dress-code overlays excluded — canonical RULES + golden corpus only.

## Live scannable (motor)

| Escopo | Total | Stub catálogo | sonar-port gerado | Live curado | Live % |
|--------|------:|--------------:|------------------:|------------:|-------:|
| all | 2668 | 2176 | 492 | 492 | 18.4 |
| vulnerability | 479 | 149 | 330 | 330 | 68.9 |
| bug | 664 | 608 | 56 | 56 | 8.4 |
| codeSmell | 1525 | 1419 | 106 | 106 | 7 |

Esteira: `npm run sonar:engenharia -- all` — prioriza VULN, promove com golden/F1, smells ficam stub salvo ROI.

## By language

| Lang | Available | Total | Covered | Partial | Uncovered | Coverage % |
|------|-----------|------:|--------:|--------:|----------:|-----------:|
| js | yes | 470 | 32 | 36 | 402 | 14.5 |
| ts | yes | 483 | 32 | 35 | 416 | 13.9 |
| py | yes | 466 | 17 | 26 | 423 | 9.2 |
| java | yes | 611 | 18 | 143 | 450 | 26.4 |
| cs | yes | 373 | 16 | 15 | 342 | 8.3 |
| cobol | yes | 74 | 22 | 41 | 11 | 85.1 |
| tsql | yes | 59 | 1 | 23 | 35 | 40.7 |
| plsql | yes | 132 | 0 | 49 | 83 | 37.1 |

## Uncovered Sonar rules by type

- **CODE_SMELL**: 1319
- **BUG**: 571
- **VULNERABILITY**: 272

## Security gaps (Vulnerability / Hotspot) — 272 total, showing 120

| Lang | Key | Name | Type |
|------|-----|------|------|
| cs | `csharpsquid:S2092` | Cookies should have the "secure" flag | VULNERABILITY |
| cs | `csharpsquid:S2245` | Pseudorandom number generators (PRNGs) should not be used in security contexts | VULNERABILITY |
| cs | `csharpsquid:S2257` | Custom cryptographic algorithms should not be used | VULNERABILITY |
| cs | `csharpsquid:S2612` | File permissions should not be set to world-accessible values | VULNERABILITY |
| cs | `csharpsquid:S3329` | Cipher Block Chaining IVs should be unpredictable | VULNERABILITY |
| cs | `csharpsquid:S3330` | Cookies should have the "HttpOnly" flag | VULNERABILITY |
| cs | `csharpsquid:S4211` | Members should not have conflicting transparency annotations | VULNERABILITY |
| cs | `csharpsquid:S4347` | Secure random number generators should not output predictable values | VULNERABILITY |
| cs | `csharpsquid:S4423` | Weak SSL/TLS protocols should not be used | VULNERABILITY |
| cs | `csharpsquid:S4426` | Cryptographic keys should be robust | VULNERABILITY |
| cs | `csharpsquid:S4433` | LDAP connections should be authenticated | VULNERABILITY |
| cs | `csharpsquid:S4502` | CSRF protections should not be disabled | VULNERABILITY |
| cs | `csharpsquid:S4507` | Debugging features should not be enabled in production | VULNERABILITY |
| cs | `csharpsquid:S4830` | Server certificates should be verified during SSL/TLS connections | VULNERABILITY |
| cs | `csharpsquid:S5122` | Cross-Origin Resource Sharing (CORS) policy should be restricted to trusted origins | VULNERABILITY |
| cs | `csharpsquid:S5332` | Clear-text protocols should not be used | VULNERABILITY |
| cs | `csharpsquid:S5443` | Temporary files should not be created in publicly writable directories | VULNERABILITY |
| cs | `csharpsquid:S5445` | Insecure temporary file creation methods should not be used | VULNERABILITY |
| cs | `csharpsquid:S5542` | Encryption algorithms should be used with secure mode and padding scheme | VULNERABILITY |
| cs | `csharpsquid:S5547` | Cipher algorithms should be robust | VULNERABILITY |
| cs | `csharpsquid:S5659` | JWT should be signed and verified with strong cipher algorithms | VULNERABILITY |
| cs | `csharpsquid:S5753` | ASP.NET Request Validation should not be disabled | VULNERABILITY |
| cs | `csharpsquid:S5773` | Types allowed to be deserialized should be restricted | VULNERABILITY |
| cs | `csharpsquid:S6377` | XML signatures should be validated securely | VULNERABILITY |
| cs | `csharpsquid:S6444` | Regular expressions should be executed with a timeout | VULNERABILITY |
| cs | `csharpsquid:S6640` | Unsafe code blocks should not be used | VULNERABILITY |
| cs | `csharpsquid:S7039` | Content Security Policies should be restrictive | VULNERABILITY |
| cs | `roslyn.sonaranalyzer.security.cs:S2083` | I/O function calls should not be vulnerable to path injection attacks | VULNERABILITY |
| cs | `roslyn.sonaranalyzer.security.cs:S2091` | XPath expressions should not be vulnerable to injection attacks | VULNERABILITY |
| cs | `roslyn.sonaranalyzer.security.cs:S2631` | Regular expressions should not be vulnerable to Denial of Service attacks | VULNERABILITY |
| cs | `roslyn.sonaranalyzer.security.cs:S5131` | Endpoints should not be vulnerable to reflected cross-site scripting (XSS) attacks | VULNERABILITY |
| cs | `roslyn.sonaranalyzer.security.cs:S5135` | Deserialization should not be vulnerable to injection attacks | VULNERABILITY |
| cs | `roslyn.sonaranalyzer.security.cs:S5145` | Logging should not be vulnerable to injection attacks | VULNERABILITY |
| cs | `roslyn.sonaranalyzer.security.cs:S5146` | HTTP request redirections should not be open to forging attacks | VULNERABILITY |
| cs | `roslyn.sonaranalyzer.security.cs:S6096` | Extracting archives should not lead to zip slip vulnerabilities | VULNERABILITY |
| cs | `roslyn.sonaranalyzer.security.cs:S6173` | Reflection should not be vulnerable to injection attacks | VULNERABILITY |
| cs | `roslyn.sonaranalyzer.security.cs:S6287` | Applications should not create session cookies from untrusted input | VULNERABILITY |
| cs | `roslyn.sonaranalyzer.security.cs:S6399` | XML operations should not be vulnerable to injection attacks | VULNERABILITY |
| cs | `roslyn.sonaranalyzer.security.cs:S6549` | Accessing files should not lead to filesystem oracle attacks | VULNERABILITY |
| cs | `roslyn.sonaranalyzer.security.cs:S6639` | Memory allocations should not be vulnerable to Denial of Service attacks | VULNERABILITY |
| cs | `roslyn.sonaranalyzer.security.cs:S6680` | Loop boundaries should not be vulnerable to injection attacks | VULNERABILITY |
| cs | `roslyn.sonaranalyzer.security.cs:S6776` | Stack traces should not be disclosed | VULNERABILITY |
| cs | `roslyn.sonaranalyzer.security.cs:S7714` | XSLT Transformations should not be vulnerable to injection attacks | VULNERABILITY |
| java | `java:S1989` | Exceptions should not be thrown from servlet methods | VULNERABILITY |
| java | `java:S2245` | Pseudorandom number generators (PRNGs) should not be used in security contexts | VULNERABILITY |
| java | `java:S3329` | Cipher Block Chaining IVs should be unpredictable | VULNERABILITY |
| java | `java:S3752` | HTTP routes should restrict allowed HTTP methods | VULNERABILITY |
| java | `java:S4347` | Secure random number generators should not output predictable values | VULNERABILITY |
| java | `java:S4423` | Weak SSL/TLS protocols should not be used | VULNERABILITY |
| java | `java:S4433` | LDAP connections should be authenticated | VULNERABILITY |
| java | `java:S4502` | CSRF protections should not be disabled | VULNERABILITY |
| java | `java:S4507` | Debugging features should not be enabled in production | VULNERABILITY |
| java | `java:S4601` | "HttpSecurity" URL patterns should be correctly ordered | VULNERABILITY |
| java | `java:S4684` | Database Operations should not be vulnerable to mass assignment | VULNERABILITY |
| java | `java:S4830` | Server certificates should be verified during SSL/TLS connections | VULNERABILITY |
| java | `java:S5122` | Cross-Origin Resource Sharing (CORS) policy should be restricted to trusted origins | VULNERABILITY |
| java | `java:S5247` | Auto-escaping in HTML template engines should not be disabled | VULNERABILITY |
| java | `java:S5320` | Intents should not be broadcast without receiver permissions | VULNERABILITY |
| java | `java:S5322` | Android broadcast receivers should not be registered without a permission | VULNERABILITY |
| java | `java:S5332` | Clear-text protocols should not be used | VULNERABILITY |
| java | `java:S5443` | Temporary files should not be created in publicly writable directories | VULNERABILITY |
| java | `java:S5527` | Server hostnames should be verified during SSL/TLS connections | VULNERABILITY |
| java | `java:S5542` | Encryption algorithms should be used with secure mode and padding scheme | VULNERABILITY |
| java | `java:S5547` | Cipher algorithms should be robust | VULNERABILITY |
| java | `java:S5659` | JWT should be signed and verified with strong cipher algorithms | VULNERABILITY |
| java | `java:S5679` | OpenSAML2 should be configured to prevent authentication bypass | VULNERABILITY |
| java | `java:S5689` | Web application technologies should not disclose version information | VULNERABILITY |
| java | `java:S5804` | Authentication mechanisms should not permit user enumeration. | VULNERABILITY |
| java | `java:S5808` | Authorizations should be based on strong decisions | VULNERABILITY |
| java | `java:S5876` | A new session should be created during user authentication | VULNERABILITY |
| java | `java:S6301` | Mobile database encryption keys should not be disclosed | VULNERABILITY |
| java | `java:S6362` | JavaScript support should not be enabled in WebViews unless strictly necessary | VULNERABILITY |
| java | `java:S6377` | XML signatures should be validated securely | VULNERABILITY |
| java | `java:S6432` | Counter Mode initialization vectors should not be reused | VULNERABILITY |
| java | `java:S7435` | Avoid using persistent unique identifiers | VULNERABILITY |
| java | `javasecurity:S5146` | HTTP request redirections should not be open to forging attacks | VULNERABILITY |
| java | `javasecurity:S6384` | Components should not be vulnerable to intent redirection | VULNERABILITY |
| java | `javasecurity:S6390` | Thread suspensions should not be vulnerable to Denial of Service attacks | VULNERABILITY |
| java | `javasecurity:S7610` | Sensitive information should not be logged in production builds | VULNERABILITY |
| js | `javascript:S2092` | Cookies should have the "secure" flag | VULNERABILITY |
| js | `javascript:S2245` | Pseudorandom number generators (PRNGs) should not be used in security contexts | VULNERABILITY |
| js | `javascript:S2598` | File uploads should be restricted | VULNERABILITY |
| js | `javascript:S2612` | File permissions should not be set to world-accessible values | VULNERABILITY |
| js | `javascript:S2755` | XML parsers should not be vulnerable to XXE attacks | VULNERABILITY |
| js | `javascript:S2819` | Origins should be verified during cross-origin communications | VULNERABILITY |
| js | `javascript:S3330` | Cookies should have the "HttpOnly" flag | VULNERABILITY |
| js | `javascript:S4426` | Cryptographic keys should be robust | VULNERABILITY |
| js | `javascript:S4502` | CSRF protections should not be disabled | VULNERABILITY |
| js | `javascript:S5122` | Cross-Origin Resource Sharing (CORS) policy should be restricted to trusted origins | VULNERABILITY |
| js | `javascript:S5247` | Auto-escaping in HTML template engines should not be disabled | VULNERABILITY |
| js | `javascript:S5332` | Clear-text protocols should not be used | VULNERABILITY |
| js | `javascript:S5443` | Temporary files should not be created in publicly writable directories | VULNERABILITY |
| js | `javascript:S5542` | Encryption algorithms should be used with secure mode and padding scheme | VULNERABILITY |
| js | `javascript:S5547` | Cipher algorithms should be robust | VULNERABILITY |
| js | `javascript:S5659` | JWT should be signed and verified with strong cipher algorithms | VULNERABILITY |
| js | `javascript:S5689` | Web application technologies should not disclose version information | VULNERABILITY |
| js | `javascript:S5728` | Content security policy fetch directives should not be disabled | VULNERABILITY |
| js | `javascript:S5734` | Browsers should not be allowed to perform MIME type sniffing | VULNERABILITY |
| js | `javascript:S5736` | HTTP Referrer-Policy should not be set to an unsafe value | VULNERABILITY |
| js | `javascript:S5739` | HTTP Strict-Transport-Security policy should not be disabled | VULNERABILITY |
| js | `javascript:S5852` | Regular expressions should not cause catastrophic backtracking | VULNERABILITY |
| js | `javascript:S5876` | A new session should be created during user authentication | VULNERABILITY |
| js | `javascript:S6249` | S3 buckets should enforce HTTPS-only access | VULNERABILITY |
| js | `javascript:S6252` | Amazon S3 buckets should have versioning enabled | VULNERABILITY |
| js | `javascript:S6265` | S3 buckets should not grant access to all users or authenticated users | VULNERABILITY |
| js | `javascript:S6268` | Angular built-in sanitization should not be disabled | VULNERABILITY |
| js | `javascript:S6270` | AWS resource-based policies should not grant public access | VULNERABILITY |
| js | `javascript:S6275` | EBS volumes should be encrypted | VULNERABILITY |
| js | `javascript:S6281` | Amazon S3 bucket public access should be fully blocked | VULNERABILITY |
| js | `javascript:S6302` | Policies should not grant all privileges | VULNERABILITY |
| js | `javascript:S6303` | Amazon RDS resources should be encrypted at rest | VULNERABILITY |
| js | `javascript:S6308` | OpenSearch domains should have encryption at rest enabled | VULNERABILITY |
| js | `javascript:S6317` | AWS IAM policies should limit the scope of permissions given | VULNERABILITY |
| js | `javascript:S6319` | SageMaker notebook instances should be encrypted at rest | VULNERABILITY |
| js | `javascript:S6327` | Amazon SNS topics should be encrypted at rest | VULNERABILITY |
| js | `javascript:S6329` | Public network access to cloud resources should be disabled | VULNERABILITY |
| js | `javascript:S6330` | SQS queues should be encrypted | VULNERABILITY |
| js | `javascript:S6332` | Amazon EFS file systems should be encrypted | VULNERABILITY |
| js | `javascript:S8441` | Static Assets should not serve session cookies | VULNERABILITY |
| js | `javascript:S8479` | DOMPurify configuration should not be bypassable | VULNERABILITY |

## Sample uncovered CODE_SMELL

- `javascript:S2699` (js): Tests should include assertions
- `javascript:S7763` (js): Re-exports should use "export...from" syntax
- `javascript:S9073` (js): Composite assertions should be split
- `javascript:S9078` (js): Parameterized tests should not contain duplicate test cases
- `javascript:S2004` (js): Functions should not be nested too deeply
- `javascript:S6582` (js): Optional chaining should be preferred
- `javascript:S5976` (js): Similar tests should be grouped in a single Parameterized test
- `javascript:S8784` (js): Assertions should be placed inside test cases or hooks
- `javascript:S8781` (js): Test and suite titles should not be empty or whitespace-only
- `javascript:S8961` (js): Vue component events should be explicitly declared
- `javascript:S8754` (js): Test titles should be unique within the same suite
- `javascript:S6845` (js): Non-interactive DOM elements should not have the `tabindex` attribute
- `javascript:S9020` (js): Use "find*" to query Testing Library elements that may not be available yet
- `javascript:S9027` (js): Testing Library queries should match presence assertions
- `javascript:S9011` (js): "<button>" elements should have an explicit "type" attribute
- `javascript:S8987` (js): "v-if" and "v-for" should not be used on the same element
- `javascript:S6551` (js): Objects and classes converted or coerced to strings should define a "toString()" method
- `javascript:S6478` (js): React components should not be nested
- `javascript:S8981` (js): Regular expressions used in Testing Library queries should not have the global flag
- `javascript:S8980` (js): React Testing Library calls should not be wrapped in "act()"
- `javascript:S2486` (js): Exceptions should not be ignored
- `javascript:S6842` (js): Non-interactive DOM elements should not have interactive ARIA roles
- `javascript:S8957` (js): Vue component props should declare a type
- `javascript:S8951` (js): Vue component props should not be mutated directly
- `javascript:S8950` (js): Vue props with a default value should not be required

## CodeHero rules without Sonar analogue

- `HERO-SMELL-0546-todo-marker` — TodoMarker (CODE_SMELL, any)
- `HERO-SMELL-debug-dotnet` — DotNetDebugStatement (CODE_SMELL, csharp,vbnet)
- `HERO-SEC-0798-cobol-hardcoded-secret` — CobolHardcodedSecret (VULNERABILITY, cobol)
- `HERO-SMELL-alter-cobol` — CobolAlter (CODE_SMELL, cobol)
- `HERO-SMELL-next-sentence-cobol` — CobolNextSentence (CODE_SMELL, cobol)
- `HERO-SMELL-entry-cobol` — CobolEntry (CODE_SMELL, cobol)
- `HERO-SMELL-cancel-cobol` — CobolCancel (CODE_SMELL, cobol)
- `HERO-SMELL-level77-cobol` — CobolLevel77 (CODE_SMELL, cobol)
- `HERO-SMELL-move-corresponding-cobol` — CobolMoveCorresponding (CODE_SMELL, cobol)
- `HERO-SMELL-display-console-cobol` — CobolDisplayUponConsole (CODE_SMELL, cobol)
- `HERO-SMELL-display-cobol` — CobolDisplay (CODE_SMELL, cobol)
- `HERO-SMELL-sort-merge-cobol` — CobolSortOrMerge (CODE_SMELL, cobol)
- `HERO-SMELL-cics-xctl-cobol` — CobolCicsXctl (CODE_SMELL, cobol)
- `HERO-SMELL-exec-sql-no-sqlcode-hint-cobol` — CobolExecSqlNeedsStatusCheck (CODE_SMELL, cobol)
- `HERO-SEC-cobol-accept-unvalidated` — CobolAcceptUnvalidated (VULNERABILITY, cobol)
- `HERO-SEC-cobol-unstring-no-overflow` — CobolUnstringNoOnOverflow (VULNERABILITY, cobol)
- `HERO-SMELL-cobol-alter` — CobolAlterParagraph (CODE_SMELL, cobol)
- `HERO-SMELL-cobol-next-sentence` — CobolNextSentence (CODE_SMELL, cobol)

## CodeHero rules missing golden corpus cases

- `HERO-SEC-0089-jdbc-sqli` — JdbcSqlInjection
- `HERO-SEC-0327-weak-hash-java` — JavaWeakHash
- `HERO-SEC-0614-insecure-cookie-java` — JavaInsecureCookie
- `HERO-SEC-0090-ldap-injection-java` — JavaLdapInjection
- `HERO-SEC-0643-xpath-injection-java` — JavaXPathInjection
- `HERO-SEC-0611-xxe-java` — JavaXxe
- `HERO-SEC-0611-xxe-dotnet` — DotNetXxe
- `HERO-SEC-0078-xp-cmdshell-tsql` — XpCmdShell
- `HERO-SEC-0327-weak-hash-dotnet` — DotNetWeakHashing
- `HERO-SMELL-debug-dotnet` — DotNetDebugStatement
- `HERO-SMELL-debug-java` — JavaDebugStatement
- `HERO-SEC-cobol-accept-console` — CobolAcceptFromConsole
- `HERO-SEC-cobol-sql-select-star` — CobolSqlSelectStar
- `HERO-SEC-cobol-sql-no-where` — CobolSqlDeleteUpdateNoWhere
- `HERO-SEC-cobol-sql-ddl` — CobolSqlDdlInApp
- `HERO-SEC-cobol-sql-like-leading-wildcard` — CobolSqlLikeLeadingWildcard
- `HERO-SEC-cobol-sql-lock-table` — CobolSqlLockTable
- `HERO-SMELL-goto-depending-cobol` — CobolGoToDependingOn
- `HERO-SMELL-alter-cobol` — CobolAlter
- `HERO-SMELL-next-sentence-cobol` — CobolNextSentence
- `HERO-SMELL-perform-thru-cobol` — CobolPerformThru
- `HERO-SMELL-entry-cobol` — CobolEntry
- `HERO-SMELL-cancel-cobol` — CobolCancel
- `HERO-SMELL-exit-program-cobol` — CobolExitProgram
- `HERO-SMELL-stop-run-cobol` — CobolStopRun
- `HERO-SMELL-level77-cobol` — CobolLevel77
- `HERO-SMELL-occurs-depending-cobol` — CobolOccursDependingOn
- `HERO-SMELL-redefines-cobol` — CobolRedefines
- `HERO-SMELL-occurs-one-cobol` — CobolOccursOne
- `HERO-SMELL-move-corresponding-cobol` — CobolMoveCorresponding
- `HERO-SMELL-accept-datetime-cobol` — CobolAcceptDateTime
- `HERO-SMELL-display-console-cobol` — CobolDisplayUponConsole
- `HERO-SMELL-display-cobol` — CobolDisplay
- `HERO-SMELL-todo-cobol` — CobolTodoComment
- `HERO-SMELL-sort-merge-cobol` — CobolSortOrMerge
- `HERO-SMELL-xml-parse-cobol` — CobolXmlParse
- `HERO-SMELL-string-no-overflow-cobol` — CobolStringWithoutOverflow
- `HERO-SMELL-call-dynamic-cobol` — CobolDynamicCall
- `HERO-SMELL-cics-xctl-cobol` — CobolCicsXctl
- `HERO-SMELL-cics-handle-cobol` — CobolCicsHandle
- `HERO-SMELL-exec-sql-no-sqlcode-hint-cobol` — CobolExecSqlNeedsStatusCheck

## CodeHero catalogue (analogues)

| Hero rule | Golden | Analogues | Top Sonar match |
|-----------|--------|----------:|-----------------|
| `HERO-SEC-0798-hardcoded-secret` | 5 | 46 | `javascript:S2068` (strong) |
| `HERO-SEC-0089-sql-injection` | 4 | 31 | `jssecurity:S8702` (strong) |
| `HERO-SEC-0327-weak-hash` | 4 | 5 | `javascript:S4790` (strong) |
| `HERO-SEC-0095-code-injection-eval` | 4 | 43 | `jssecurity:S5334` (strong) |
| `HERO-SEC-0079-xss-sink` | 3 | 6 | `jssecurity:S5696` (strong) |
| `HERO-SEC-0078-os-command` | 16 | 14 | `jssecurity:S2076` (strong) |
| `HERO-SEC-0918-ssrf` | 4 | 6 | `jssecurity:S8703` (strong) |
| `HERO-SEC-0022-path-traversal` | 2 | 9 | `jssecurity:S6096` (strong) |
| `HERO-SEC-0601-open-redirect` | 2 | 16 | `jssecurity:S6105` (strong) |
| `HERO-SEC-1321-prototype-pollution` | 2 | 10 | `jssecurity:S6109` (strong) |
| `HERO-SEC-0330-insecure-random` | 2 | 4 | `javascript:S5973` (partial) |
| `HERO-SEC-0295-tls-verify-disabled` | 2 | 8 | `javascript:S4830` (strong) |
| `HERO-SEC-0532-secret-in-log` | 2 | 10 | `jssecurity:S5145` (strong) |
| `HERO-SEC-0506-pipe-to-shell` | 3 | 9 | `javascript:S5725` (strong) |
| `HERO-SMELL-0489-debug-statement` | 4 | 7 | `python:PrintStatementUsage` (strong) |
| `HERO-SMELL-0546-todo-marker` | 3 | 0 | — |
| `HERO-SEC-0089-dynamic-sql-tsql` | 2 | 70 | `tsql:S1745` (partial) |
| `HERO-SEC-0089-adonet-sqli` | 2 | 7 | `csharpsquid:S2077` (strong) |
| `HERO-SEC-0089-jdbc-sqli` | — | 15 | `java:S2077` (strong) |
| `HERO-SEC-0078-cmd-injection-java` | 3 | 43 | `javasecurity:S2076` (strong) |
| `HERO-SEC-0022-path-traversal-java` | 1 | 37 | `javasecurity:S6096` (strong) |
| `HERO-SEC-0079-xss-java` | 3 | 20 | `javasecurity:S5131` (strong) |
| `HERO-SEC-0327-weak-hash-java` | — | 4 | `java:S4790` (strong) |
| `HERO-SEC-0614-insecure-cookie-java` | — | 5 | `java:S3330` (partial) |
| `HERO-SEC-0090-ldap-injection-java` | — | 42 | `java:S9068` (partial) |
| `HERO-SEC-0643-xpath-injection-java` | — | 71 | `javasecurity:S2091` (strong) |
| `HERO-SEC-0501-trust-boundary-java` | 3 | 15 | `javasecurity:S6287` (partial) |
| `HERO-SEC-0078-cmd-injection-dotnet` | 2 | 5 | `roslyn.sonaranalyzer.security.cs:S2076` (strong) |
| `HERO-SEC-0502-insecure-deserialization-dotnet` | 2 | 2 | `roslyn.sonaranalyzer.security.cs:S6547` (strong) |
| `HERO-SEC-0502-insecure-deserialization-java` | 2 | 9 | `javasecurity:S6547` (strong) |
| `HERO-SEC-0611-xxe-java` | — | 7 | `java:S2755` (strong) |
| `HERO-SEC-0611-xxe-dotnet` | — | 5 | `csharpsquid:S2755` (strong) |
| `HERO-SEC-0078-xp-cmdshell-tsql` | — | 11 | `tsql:S1499` (partial) |
| `HERO-SEC-0327-weak-hash-dotnet` | — | 1 | `csharpsquid:S4790` (strong) |
| `HERO-SMELL-debug-dotnet` | — | 0 | — |
| `HERO-SMELL-debug-java` | — | 17 | `java:S3626` (partial) |
| `HERO-SEC-0798-cobol-value-secret` | 5 | 2 | `cobol:S1686` (partial) |
| `HERO-SEC-0798-cobol-hardcoded-secret` | 2 | 0 | — |
| `HERO-SEC-cobol-accept-console` | — | 2 | `cobol:S1871` (partial) |
| `HERO-SEC-cobol-sql-select-star` | — | 33 | `cobol:SQL.SelectStarUsageCheck` (strong) |
| `HERO-SEC-cobol-sql-no-where` | — | 33 | `cobol:SQL.DynamicSqlCheck` (strong) |
| `HERO-SEC-cobol-sql-ddl` | — | 2 | `cobol:SQL.SelectWithNoWhereClauseCheck` (partial) |
| `HERO-SEC-cobol-sql-like-leading-wildcard` | — | 6 | `cobol:S1739` (partial) |
| `HERO-SEC-cobol-sql-lock-table` | — | 3 | `cobol:SQL.SelectWithNoWhereClauseCheck` (partial) |
| `HERO-SMELL-0goto-cobol` | 2 | 20 | `cobol:SQL.SelectWithNoWhereClauseCheck` (partial) |
| `HERO-SMELL-goto-depending-cobol` | — | 3 | `cobol:COBOL.EvaluateStatementUsageCheck` (partial) |
| `HERO-SMELL-alter-cobol` | — | 0 | — |
| `HERO-SMELL-next-sentence-cobol` | — | 0 | — |
| `HERO-SMELL-perform-thru-cobol` | — | 20 | `cobol:COBOL.PerformThruParagraphOrderCheck` (partial) |
| `HERO-SMELL-entry-cobol` | — | 0 | — |
| `HERO-SMELL-cancel-cobol` | — | 0 | — |
| `HERO-SMELL-exit-program-cobol` | — | 6 | `cobol:COBOL.ExitProgramUsageCheck` (partial) |
| `HERO-SMELL-stop-run-cobol` | — | 1 | `cobol:COBOL.StopRunUsageCheck` (partial) |
| `HERO-SMELL-level77-cobol` | — | 0 | — |
| `HERO-SMELL-occurs-depending-cobol` | — | 2 | `cobol:S4882` (strong) |
| `HERO-SMELL-redefines-cobol` | — | 1 | `cobol:S1305` (partial) |
| `HERO-SMELL-occurs-one-cobol` | — | 2 | `cobol:S4882` (partial) |
| `HERO-SMELL-move-corresponding-cobol` | — | 0 | — |
| `HERO-SMELL-accept-datetime-cobol` | — | 1 | `cobol:S1740` (partial) |
| `HERO-SMELL-display-console-cobol` | — | 0 | — |
| `HERO-SMELL-display-cobol` | — | 0 | — |
| `HERO-SMELL-debug-mode-cobol` | 2 | 1 | `cobol:S4507` (partial) |
| `HERO-SMELL-todo-cobol` | — | 16 | `cobol:COBOL.EvaluateStatementUsageCheck` (partial) |
| `HERO-SMELL-sort-merge-cobol` | — | 0 | — |
| `HERO-SMELL-xml-parse-cobol` | — | 1 | `cobol:S3482` (partial) |
| `HERO-SMELL-string-no-overflow-cobol` | — | 2 | `cobol:S1192` (partial) |
| `HERO-SMELL-call-dynamic-cobol` | — | 3 | `cobol:S3582` (partial) |
| `HERO-SMELL-cics-xctl-cobol` | — | 0 | — |
| `HERO-SMELL-cics-handle-cobol` | — | 10 | `cobol:S2583` (partial) |
| `HERO-SMELL-exec-sql-no-sqlcode-hint-cobol` | — | 0 | — |
| `HERO-SEC-cobol-accept-unvalidated` | 1 | 0 | — |
| `HERO-SEC-cobol-string-no-overflow` | 2 | 2 | `cobol:S3921` (partial) |
| `HERO-SEC-cobol-unstring-no-overflow` | 2 | 0 | — |
| `HERO-SEC-cobol-dynamic-filename` | 1 | 3 | `cobol:S1656` (partial) |
| `HERO-SMELL-cobol-alter` | 1 | 0 | — |
| `HERO-SEC-cobol-display-password` | 1 | 24 | `cobol:SQL.SelectWithNoWhereClauseCheck` (partial) |
| `HERO-SMELL-cobol-next-sentence` | 1 | 0 | — |
| `HERO-PQC-0327-algoritmo-quebrado` | 2 | 7 | `javascript:S4790` (strong) |
| `HERO-PQC-0327-nome-pre-padronizacao` | 2 | 7 | `javascript:S4790` (strong) |
| `HERO-PQC-0326-nivel-insuficiente` | 2 | 1 | `pythonenterprise:S8435` (partial) |
| `HERO-PQC-0327-sem-hibrido` | 2 | 7 | `javascript:S4790` (strong) |
| `HERO-PQC-0311-colher-agora-decifrar-depois` | 2 | 10 | `javascript:S4790` (strong) |
| `HERO-PQC-0347-assinatura-de-longa-duracao` | 2 | 20 | `java:S2254` (partial) |
