// Resumo do diagnóstico OWASP Benchmark — para o relatório ao usuário.
// Não roda nada; só imprime a conclusão já medida.
console.log(`
OWASP BenchmarkJava v1.2 — 2.740 casos rotulados — CodeHero hoje
================================================================

RESULTADO BRUTO (só L0 regex por linha):
  weakrand   100% recall / 80.7% precisão   <- única categoria viva
  outras 10   0% recall                      <- TODAS zeradas

  TOTAL: 15.4% recall / 80.7% precisão / F1 25.9%

POR QUE ZERO NAS OUTRAS:
  SQLi: 100% dos casos têm concatenação, 64% têm sink JDBC,
        mas 0% na MESMA LINHA. Nossa regex exige \`execute("..." + ...)\`.
        O benchmark (e código real) faz:
            String sql = "SELECT ..." + param;   // linha 1
            statement.executeQuery(sql);          // linha 2

O QUE CADA CAMADA RESGATA (SQLi):
  L0 regex 1-linha (hoje)      recall  0.0%
  + concat no arquivo          recall 68.0%  (teto de L0 multi-linha)
  + rastreador de variável     recall 47.4%  (conservador, sem fonte)
  + fonte request.getParameter recall 42.3%  (over-taint da concatenação some)

CONCLUSÃO:
  O problema NÃO é "regras ruins". É ARQUITETURA:
    1. Taint (L2) só roda em JS/TS — Java/Python/COBOL ficam sem propagação.
    2. Sources/sinks do taint são só JS — falta JDBC, HttpServletRequest, etc.
    3. L0 é single-line — não pega o padrão dominante de concat-em-variável.

  Prioridade: estender taint para Java com sources/sinks de servlet/JDBC.
  Isso move SQLi de 0% → ~50-68% e cmdi/pathtraver/xss junto.
`);
