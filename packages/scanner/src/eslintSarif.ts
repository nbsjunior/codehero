// ---------------------------------------------------------------------------
// ESLint → SARIF.
//
// POR QUE CONVERTER EM VEZ DE USAR O FORMATADOR SARIF: o
// `@microsoft/eslint-formatter-sarif` é um pacote extra que precisa estar
// instalado no projeto ANALISADO — e o objetivo aqui é rodar em repositório de
// terceiro sem pedir instalação nenhuma. `eslint -f json` é embutido e estável
// desde sempre.
//
// A conversão é pequena e determinística; a alternativa era uma dependência a
// mais no caminho crítico de um adaptador que já pode falhar por dez motivos.
// ---------------------------------------------------------------------------

/** Formato de saída do `eslint -f json`. */
interface EslintMessage {
  ruleId: string | null;
  severity: number; // 1 = warn, 2 = error
  message: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}
interface EslintFile {
  filePath: string;
  messages: EslintMessage[];
}

/** SARIF mínimo que o `importSarifFiles` já sabe ler. */
export interface SarifMinimo {
  version: "2.1.0";
  $schema: string;
  runs: Array<{
    tool: { driver: { name: string; rules: Array<{ id: string }> } };
    results: Array<Record<string, unknown>>;
  }>;
}

export function eslintJsonToSarif(json: string): SarifMinimo | null {
  let dados: EslintFile[];
  try {
    dados = JSON.parse(json) as EslintFile[];
  } catch {
    return null;
  }
  if (!Array.isArray(dados)) return null;

  const regras = new Set<string>();
  const results: Array<Record<string, unknown>> = [];

  for (const arquivo of dados) {
    for (const m of arquivo.messages ?? []) {
      // Mensagem sem ruleId é erro de parse do próprio ESLint (config quebrada,
      // sintaxe inválida). Reportar como achado de qualidade seria mentira —
      // o problema é a execução, não o código.
      if (!m.ruleId) continue;
      regras.add(m.ruleId);
      results.push({
        ruleId: m.ruleId,
        level: m.severity === 2 ? "error" : "warning",
        message: { text: m.message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: arquivo.filePath.replace(/\\/g, "/") },
              region: {
                startLine: m.line ?? 1,
                startColumn: m.column ?? 1,
                endLine: m.endLine ?? m.line ?? 1,
                endColumn: m.endColumn ?? m.column ?? 1,
              },
            },
          },
        ],
      });
    }
  }

  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: { driver: { name: "eslint", rules: [...regras].map((id) => ({ id })) } },
        results,
      },
    ],
  };
}
