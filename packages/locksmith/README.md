# @codehero/locksmith

Deterministic validation for COBOL→Java (and similar) migrations — student side of the **Locksmith Loop** ([AmEx arXiv:2607.28271](https://arxiv.org/abs/2607.28271)).

## Pipeline

1. **Witness Search** — pairwise, 3-way, LHS, ART, MAP-Elites, UCB1 until branch coverage plateaus (±2).
2. **Locked Paragraph Analyzer** — residual unreachable paragraphs / branch probes.
3. **Mutation Skills** — `dispatcher-arm` and `call-injection` applied to **both** harnesses.
4. **Parity Gate** — PASS iff `paragraphs_hit` ∧ `stub_log` ∧ `terminal_state` match.
5. Keep mutation only if **coverage↑ ∧ parity PASS**; then recurse Witness Search.

Authoring Layer (AI) is optional: pass `config.authoring` to propose skills. The oracle never trusts the Teacher alone.

## CLI

```bash
npm run build:locksmith
npm run locksmith -- analyze examples/legacy/sample.cbl
npm run locksmith -- run examples/legacy/sample.cbl
# Exercita Mutation Skills (LOCKED-VAULT fora do domínio de Witness Search):
npm run locksmith -- run examples/legacy/locksmith-locked.cbl
```

## Library

```ts
import { runLocksmithLoop } from "@codehero/locksmith";

const report = runLocksmithLoop({
  sourcePath: "examples/legacy/sample.cbl",
  javaRunner: myInstrumentedJavaHarness, // optional; default = COBOL mirror
});
```

## Honesty

This package ships a **CFG mock runner** (not GnuCOBOL/JVM). It validates the Locksmith *control loop* and harness mutations end-to-end. Swap `javaRunner` for a real instrumented target when available.
