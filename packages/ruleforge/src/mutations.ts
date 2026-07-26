import type { Mutation } from "./types.ts";

// ---------------------------------------------------------------------------
// Curated mutation pool per rule. Each mutation is a small, reviewable regex
// transformation (widen a match, add an exclusion). In the MVP these are
// hand-authored by the security team; in V1+ this pool is additionally
// populated offline by an LLM reading CWE/CVE writeups and false-positive
// telemetry (see llmGenerator.ts) — but every proposal, regardless of source,
// only becomes a rule change if it wins the deterministic corpus evaluation
// in evolve.ts. Generative AI proposes; the corpus decides.
// ---------------------------------------------------------------------------

export const MUTATION_POOL: Record<string, Mutation[]> = {
  "HERO-SEC-0327-weak-hash": [
    // "add-hashlib-new-alt" foi PROMOVIDA em 2026-07-26 (F1 0.67 -> 1.00) e já
    // está mesclada em contracts/src/rules.ts — removida do pool para não ser
    // reaplicada sobre si mesma. Próxima rodada busca a partir dessa baseline.
    {
      id: "add-crypto-createhash-alt",
      description: "Detecta crypto.createHash('md5'|'sha1') com aspas simples ou template string.",
      apply: (p) => ({ ...p, regex: `${p.regex}|createHash\\(\\s*\`(md5|sha1)\`` }),
    },
  ],
  "HERO-SEC-0798-hardcoded-secret": [
    // "widen-unless-fixture-words" e "widen-charclass-specials" foram
    // PROMOVIDAS em 2026-07-26 (F1 0.50 -> 1.00) e já estão mescladas em
    // contracts/src/rules.ts — removidas do pool pelo mesmo motivo acima.
    {
      id: "narrow-min-length-16",
      description: "Eleva o comprimento mínimo do literal de 12 para 16 caracteres (reduz falsos positivos em valores curtos).",
      apply: (p) => ({ ...p, regex: p.regex.replace("{12,}", "{16,}") }),
    },
  ],
  "HERO-SEC-0089-sql-injection": [
    {
      id: "add-fstring-concat-alt",
      description: "Detecta f-strings Python usadas para montar a query (f\"... {var} ...\").",
      apply: (p) => ({ ...p, regex: `${p.regex}|f['"].*(select|insert|update|delete).*\\{` }),
    },
  ],
  "HERO-SEC-0095-code-injection-eval": [
    {
      id: "widen-unless-typed-input",
      description: "Ignora chamadas já validadas por schema (comentário '# validated').",
      apply: (p) => ({ ...p, unless: `${p.unless}|#\\s*validated` }),
    },
  ],
};

export function poolFor(ruleId: string): Mutation[] {
  return MUTATION_POOL[ruleId] ?? [];
}
