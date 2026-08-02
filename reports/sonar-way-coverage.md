# CodeHero × Sonar way — coverage report

Generated: 2026-07-28T13:34:52.047Z
Source: `https://next.sonarqube.com/sonarqube/api` (fetched 2026-07-28T13:07:41.908Z)

## Verdict

CodeHero **does not** cover the Sonar way catalog for the selected languages. Approximate semantic coverage of Sonar way rules: **14%** (113 covered + 261 partial out of **2668**).

Of **32** canonical Hero rules, **28** (87.5%) have at least one Sonar analogue; **20** (62.5%) appear in the golden corpus (61 cases).

## Limitations

- Semantic match only — CodeHero has no sonarKey field; SonarCloud/next API often omits numeric CWE ids.
- covered/partial ≠ equivalent detection power (L0 regex vs Sonar analyzers).
- plsql snapshot is a public proxy for DB2SQL (no dedicated DB2 Sonar way on the public instance).
- Dress-code overlays excluded — canonical RULES + golden corpus only.

## By language

| Lang | Available | Total | Covered | Partial | Uncovered | Coverage % |
|------|-----------|------:|--------:|--------:|----------:|-----------:|
| js | yes | 470 | 32 | 34 | 404 | 14 |
| ts | yes | 483 | 32 | 33 | 418 | 13.5 |
| py | yes | 466 | 17 | 19 | 430 | 7.7 |
| java | yes | 611 | 15 | 74 | 522 | 14.6 |
| cs | yes | 373 | 16 | 12 | 345 | 7.5 |
| cobol | yes | 74 | 0 | 17 | 57 | 23 |
| tsql | yes | 59 | 1 | 23 | 35 | 40.7 |
| plsql | yes | 132 | 0 | 49 | 83 | 37.1 |

## Uncovered Sonar rules by type

- **CODE_SMELL**: 1387
- **BUG**: 601
- **VULNERABILITY**: 306

## Security gaps (Vulnerability / Hotspot) — 306 total, showing 120

| Lang | Key | Name | Type |
|------|-----|------|------|
| cobol | `cobol:S1686` | When calling a subprogram, the data item containing the name of the subprogram to be called should not be programmatically updated | VULNERABILITY |
| cobol | `cobol:S4507` | Debugging features should not be enabled in production | VULNERABILITY |
| cobol | `cobol:SQL.DynamicSqlCheck` | Dynamic SQL clauses should not be used | VULNERABILITY |
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
| cs | `csharpsquid:S5693` | HTTP request content length should be limited | VULNERABILITY |
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
| cs | `roslyn.sonaranalyzer.security.cs:S5144` | Server-side requests should not be vulnerable to forging attacks | VULNERABILITY |
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
| cs | `roslyn.sonaranalyzer.security.cs:S7044` | Server-side requests should not be vulnerable to traversing attacks | VULNERABILITY |
| cs | `roslyn.sonaranalyzer.security.cs:S7714` | XSLT Transformations should not be vulnerable to injection attacks | VULNERABILITY |
| java | `java:S1989` | Exceptions should not be thrown from servlet methods | VULNERABILITY |
| java | `java:S2092` | Cookies should have the "secure" flag | VULNERABILITY |
| java | `java:S2245` | Pseudorandom number generators (PRNGs) should not be used in security contexts | VULNERABILITY |
| java | `java:S2254` | "HttpServletRequest.getRequestedSessionId()" should not be used | VULNERABILITY |
| java | `java:S2257` | Custom cryptographic algorithms should not be used | VULNERABILITY |
| java | `java:S2612` | File permissions should not be set to world-accessible values | VULNERABILITY |
| java | `java:S3329` | Cipher Block Chaining IVs should be unpredictable | VULNERABILITY |
| java | `java:S3330` | Cookies should have the "HttpOnly" flag | VULNERABILITY |
| java | `java:S3752` | HTTP routes should restrict allowed HTTP methods | VULNERABILITY |
| java | `java:S4347` | Secure random number generators should not output predictable values | VULNERABILITY |
| java | `java:S4423` | Weak SSL/TLS protocols should not be used | VULNERABILITY |
| java | `java:S4426` | Cryptographic keys should be robust | VULNERABILITY |
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
| java | `java:S5693` | HTTP request content length should be limited | VULNERABILITY |
| java | `java:S5804` | Authentication mechanisms should not permit user enumeration. | VULNERABILITY |
| java | `java:S5808` | Authorizations should be based on strong decisions | VULNERABILITY |
| java | `java:S5852` | Regular expressions should not cause catastrophic backtracking | VULNERABILITY |
| java | `java:S5876` | A new session should be created during user authentication | VULNERABILITY |
| java | `java:S6263` | Long-term AWS access keys should not be used | VULNERABILITY |
| java | `java:S6293` | Biometric authentication should be cryptographically bound | VULNERABILITY |
| java | `java:S6301` | Mobile database encryption keys should not be disclosed | VULNERABILITY |
| java | `java:S6362` | JavaScript support should not be enabled in WebViews unless strictly necessary | VULNERABILITY |
| java | `java:S6363` | WebViews should not allow unrestricted file access | VULNERABILITY |
| java | `java:S6377` | XML signatures should be validated securely | VULNERABILITY |
| java | `java:S6432` | Counter Mode initialization vectors should not be reused | VULNERABILITY |
| java | `java:S7435` | Avoid using persistent unique identifiers | VULNERABILITY |
| java | `javasecurity:S2631` | Regular expressions should not be vulnerable to Denial of Service attacks | VULNERABILITY |
| java | `javasecurity:S5131` | Endpoints should not be vulnerable to reflected cross-site scripting (XSS) attacks | VULNERABILITY |
| java | `javasecurity:S5144` | Server-side requests should not be vulnerable to forging attacks | VULNERABILITY |
| java | `javasecurity:S5146` | HTTP request redirections should not be open to forging attacks | VULNERABILITY |
| java | `javasecurity:S6096` | Extracting archives should not lead to zip slip vulnerabilities | VULNERABILITY |
| java | `javasecurity:S6384` | Components should not be vulnerable to intent redirection | VULNERABILITY |
| java | `javasecurity:S6390` | Thread suspensions should not be vulnerable to Denial of Service attacks | VULNERABILITY |
| java | `javasecurity:S6549` | Accessing files should not lead to filesystem oracle attacks | VULNERABILITY |
| java | `javasecurity:S7044` | Server-side requests should not be vulnerable to traversing attacks | VULNERABILITY |
| java | `javasecurity:S7606` | WebViews should not be vulnerable to cross-app scripting attacks | VULNERABILITY |
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
- `HERO-SMELL-0goto-cobol` — CobolGoTo (CODE_SMELL, cobol)
- `HERO-SMELL-debug-dotnet` — DotNetDebugStatement (CODE_SMELL, csharp,vbnet)
- `HERO-SMELL-alter-cobol` — CobolAlter (CODE_SMELL, cobol)

## CodeHero rules missing golden corpus cases

- `HERO-SEC-0089-jdbc-sqli` — JdbcSqlInjection
- `HERO-SEC-0078-cmd-injection-dotnet` — DotNetCommandInjection
- `HERO-SEC-0078-cmd-injection-java` — JavaCommandInjection
- `HERO-SEC-0502-insecure-deserialization-dotnet` — DotNetInsecureDeserialization
- `HERO-SEC-0502-insecure-deserialization-java` — JavaInsecureDeserialization
- `HERO-SEC-0611-xxe-java` — JavaXxe
- `HERO-SEC-0611-xxe-dotnet` — DotNetXxe
- `HERO-SEC-0078-xp-cmdshell-tsql` — XpCmdShell
- `HERO-SEC-0327-weak-hash-dotnet` — DotNetWeakHashing
- `HERO-SMELL-debug-dotnet` — DotNetDebugStatement
- `HERO-SMELL-debug-java` — JavaDebugStatement
- `HERO-SMELL-alter-cobol` — CobolAlter

## CodeHero catalogue (analogues)

| Hero rule | Golden | Analogues | Top Sonar match |
|-----------|--------|----------:|-----------------|
| `HERO-SEC-0798-hardcoded-secret` | 5 | 46 | `javascript:S2068` (strong) |
| `HERO-SEC-0089-sql-injection` | 4 | 31 | `jssecurity:S8702` (strong) |
| `HERO-SEC-0327-weak-hash` | 4 | 5 | `javascript:S4790` (strong) |
| `HERO-SEC-0095-code-injection-eval` | 4 | 43 | `jssecurity:S5334` (strong) |
| `HERO-SEC-0079-xss-sink` | 3 | 6 | `jssecurity:S5696` (strong) |
| `HERO-SEC-0078-os-command` | 10 | 14 | `jssecurity:S2076` (strong) |
| `HERO-SEC-0918-ssrf` | 2 | 6 | `jssecurity:S8703` (strong) |
| `HERO-SEC-0022-path-traversal` | 2 | 9 | `jssecurity:S6096` (strong) |
| `HERO-SEC-0601-open-redirect` | 2 | 16 | `jssecurity:S6105` (strong) |
| `HERO-SEC-1321-prototype-pollution` | 2 | 10 | `jssecurity:S6109` (strong) |
| `HERO-SEC-0330-insecure-random` | 2 | 4 | `javascript:S5973` (partial) |
| `HERO-SEC-0295-tls-verify-disabled` | 2 | 8 | `javascript:S4830` (strong) |
| `HERO-SEC-0532-secret-in-log` | 2 | 10 | `jssecurity:S5145` (strong) |
| `HERO-SEC-0506-pipe-to-shell` | 2 | 9 | `javascript:S5725` (strong) |
| `HERO-SMELL-0489-debug-statement` | 4 | 7 | `python:PrintStatementUsage` (strong) |
| `HERO-SMELL-0546-todo-marker` | 3 | 0 | — |
| `HERO-SEC-0089-dynamic-sql-tsql` | 2 | 70 | `tsql:S1745` (partial) |
| `HERO-SEC-0089-adonet-sqli` | 2 | 7 | `csharpsquid:S2077` (strong) |
| `HERO-SEC-0798-cobol-hardcoded-secret` | 2 | 17 | `cobol:S3004` (partial) |
| `HERO-SMELL-0goto-cobol` | 2 | 0 | — |
| `HERO-SEC-0089-jdbc-sqli` | — | 15 | `java:S2077` (strong) |
| `HERO-SEC-0078-cmd-injection-dotnet` | — | 5 | `roslyn.sonaranalyzer.security.cs:S2076` (strong) |
| `HERO-SEC-0078-cmd-injection-java` | — | 46 | `javasecurity:S2076` (strong) |
| `HERO-SEC-0502-insecure-deserialization-dotnet` | — | 2 | `roslyn.sonaranalyzer.security.cs:S6547` (strong) |
| `HERO-SEC-0502-insecure-deserialization-java` | — | 9 | `javasecurity:S6547` (strong) |
| `HERO-SEC-0611-xxe-java` | — | 7 | `java:S2755` (strong) |
| `HERO-SEC-0611-xxe-dotnet` | — | 5 | `csharpsquid:S2755` (strong) |
| `HERO-SEC-0078-xp-cmdshell-tsql` | — | 11 | `tsql:S1499` (partial) |
| `HERO-SEC-0327-weak-hash-dotnet` | — | 1 | `csharpsquid:S4790` (strong) |
| `HERO-SMELL-debug-dotnet` | — | 0 | — |
| `HERO-SMELL-debug-java` | — | 17 | `java:S3626` (partial) |
| `HERO-SMELL-alter-cobol` | — | 0 | — |
