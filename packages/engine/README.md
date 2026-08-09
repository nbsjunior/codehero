# @codehero/engine

Motor estrutural do CodeHero — a camada L1/L2 por trás do score OWASP e das análises de legado.

Parsing e análise de árvore. Usa tree-sitter para JavaScript, TypeScript, Python, Java, C# e Go, e parsers próprios para COBOL, T-SQL e DB2 SQL PL — dialetos sem gramática madura publicada em WASM.

Inclui métricas (ciclomática, cognitiva, aninhamento), detecção de duplicação, taint (hoje maduro sobretudo em JS/TS) e as análises algorítmicas de COBOL que não cabem numa regra declarativa.

Pacote de biblioteca: você normalmente quer [`@codehero/scanner`](https://www.npmjs.com/package/@codehero/scanner). Métricas de produto: [docs/wiki/Posicionamento-e-metricas.md](../../docs/wiki/Posicionamento-e-metricas.md).

## Licença

Apache-2.0. Código em <https://github.com/nbsjunior/codehero>.
