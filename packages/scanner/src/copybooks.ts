import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";
import type { CopybookResolver } from "@codehero/engine";

// ---------------------------------------------------------------------------
// Localizador de copybook em disco.
//
// Em mainframe o copybook vem de uma PDS e o nome no `COPY` não tem extensão.
// Em repositório Git ele virou arquivo, e a extensão varia por convenção de
// cada casa: `.cpy`, `.CPY`, `.cbl`, `.cob`, ou nenhuma. O índice é montado
// UMA vez por diretório e casado sem diferenciar maiúsculas, porque o COBOL
// não diferencia e o Linux diferencia — é o tipo de detalhe que faz o scan
// funcionar na máquina do dev e falhar no CI.
// ---------------------------------------------------------------------------

const EXTENSOES = [".cpy", ".cbl", ".cob", ".cobol", ".inc", ""];

export interface CopybookIndex extends CopybookResolver {
  /** Quantos arquivos entraram no índice. */
  readonly size: number;
  /** Nomes procurados e não encontrados, para o relatório de cobertura. */
  readonly naoEncontrados: Set<string>;
}

/**
 * Monta o índice a partir dos diretórios informados (recursivo).
 *
 * Sem diretório algum, devolve um índice vazio que responde `null` a tudo — e
 * aí todo `COPY` entra em `missing`, que é a resposta honesta: o analisador
 * não tem como saber o que havia ali.
 */
export function buildCopybookIndex(dirs: string[]): CopybookIndex {
  const porNome = new Map<string, string>();
  const naoEncontrados = new Set<string>();

  const varrer = (dir: string, profundidade = 0): void => {
    if (profundidade > 12) return;
    let entradas: string[];
    try {
      entradas = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entradas) {
      const caminho = join(dir, e);
      let st;
      try {
        st = statSync(caminho);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (e === "node_modules" || e === ".git") continue;
        varrer(caminho, profundidade + 1);
        continue;
      }
      const ext = extname(e).toLowerCase();
      if (!EXTENSOES.includes(ext)) continue;
      const nome = basename(e, extname(e)).toUpperCase();
      // Primeiro diretório da lista vence: a ordem de `--copybook` é a ordem
      // de precedência, como o SYSLIB do compilador.
      if (!porNome.has(nome)) porNome.set(nome, caminho);
    }
  };

  for (const d of dirs) if (existsSync(d)) varrer(d);

  return {
    size: porNome.size,
    naoEncontrados,
    resolve(nome: string, library?: string) {
      // `COPY X OF LIB`: tenta LIB.X e depois X — em repositório a biblioteca
      // costuma ser um subdiretório, e o índice já achatou tudo.
      const tentativas = library ? [`${library}.${nome}`, nome] : [nome];
      for (const t of tentativas) {
        const caminho = porNome.get(t.toUpperCase());
        if (!caminho) continue;
        try {
          return { path: caminho, source: readFileSync(caminho, "utf8") };
        } catch {
          continue;
        }
      }
      naoEncontrados.add(library ? `${library}.${nome}` : nome);
      return null;
    },
  };
}
