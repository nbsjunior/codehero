import type { Finding } from "./engine.ts";
import type { ImportedFinding } from "./importSarif.ts";
import { resolve } from "node:path";

/**
 * Remove o apontamento de terceiro quando uma regra PROPRIA ja cobriu a mesma
 * linha do mesmo arquivo.
 *
 * A regra propria vence, e nao o contrario, por dois motivos: ela carrega a
 * ficha do CodeHero (risco, como corrigir, template SDD) e participa do gate
 * com severidade calibrada. O id de terceiro sobrevive em `alsoRuleIds` do
 * achado nativo, entao a procedencia nao se perde.
 *
 * Vulnerabilidade de DEPENDENCIA (SCA) nunca e absorvida: ela fala do
 * `node_modules`, nao da linha — coincidir de arquivo e linha seria acidente.
 */
export function colapsaEcoEntreFerramentas(
  nativos: Finding[],
  importados: ImportedFinding[],
  cwd: string,
): { restantes: ImportedFinding[]; absorvidos: number } {
  if (importados.length === 0) return { restantes: importados, absorvidos: 0 };

  // Caminho ABSOLUTO dos dois lados: o achado nativo vem relativo ao cwd e a
  // ferramenta externa emite absoluto no SARIF. Comparar como vêm nunca casa, e
  // o colapso virava um no-op silencioso — o eco continuava e o log dizia zero.
  // No Windows a comparação também ignora caixa, porque o sistema de arquivos
  // ignora e as ferramentas divergem em `C:` vs `c:`.
  const norm = (f: string) => {
    const abs = resolve(cwd, f).replace(/\\/g, "/");
    return process.platform === "win32" ? abs.toLowerCase() : abs;
  };
  const chave = (f: string, l: number) => `${norm(f)}:${l}`;
  // Vários nativos podem estar na MESMA linha (o `==` e o `eval()` de
  // `if (a == b) return eval(x)`). Guardar todos e escolher depois pela coluna
  // mais próxima: absorver `no-eval` sob a regra do `==` daria um rastro de
  // conformidade errado, ainda que a contagem final fosse a mesma.
  const cobertas = new Map<string, Finding[]>();
  for (const n of nativos) {
    const k = chave(n.file, n.startLine);
    const lista = cobertas.get(k);
    if (lista) lista.push(n);
    else cobertas.set(k, [n]);
  }

  const restantes: ImportedFinding[] = [];
  let absorvidos = 0;
  for (const imp of importados) {
    if (imp.isDependency) {
      restantes.push(imp);
      continue;
    }
    const candidatos = cobertas.get(chave(imp.file, imp.startLine));
    if (!candidatos || candidatos.length === 0) {
      restantes.push(imp);
      continue;
    }
    const nativo = candidatos.reduce((melhor, c) =>
      Math.abs(c.startColumn - imp.startColumn) < Math.abs(melhor.startColumn - imp.startColumn)
        ? c
        : melhor,
    );
    nativo.alsoRuleIds = [...new Set([...(nativo.alsoRuleIds ?? []), imp.ruleId])];
    absorvidos++;
  }
  return { restantes, absorvidos };
}
