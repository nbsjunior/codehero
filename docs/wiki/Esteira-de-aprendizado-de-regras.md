# Esteira de aprendizado de regras (Ruleforge)

**Para o CTO:** a IA **propõe** mutações offline; o **corpus golden + F1 decidem** o que entra no CI. O scanner do PR permanece determinístico — propriedade exigível em auditoria e due diligence.

Núcleo do posicionamento “líder no ciclo pós-finding”: [Posicionamento-e-metricas.md](./Posicionamento-e-metricas.md).  
Docs interativas: https://codehero.web.app/docs/#aprendizado-continuo

## Em uma frase

IA propõe · corpus prova · o gate não muda de natureza.

## Passo a passo

```mermaid
flowchart LR
  subgraph O["1 · Observar"]
    S["Scan CI / IDE / prévia"]
    F["Feedback FP / FN"]
  end
  subgraph P["2 · Propor"]
    D["Dress code / orquestração de agentes · lote offline"]
    M["Pool de mutações"]
  end
  subgraph V["3 · Provar"]
    C["Corpus golden"]
    G["Busca evolutiva P·R·F1"]
  end
  subgraph U["4 · Publicar"]
    Q{"ΔF1>0 ∧ P≥0.85?"}
    R["RuleSet ativo"]
    X["REJECTED auditável"]
  end
  S --> F --> D --> M --> G
  C --> G
  G --> Q
  Q -->|sim| R
  Q -->|não| X
  R --> S
```

| Passo | O que acontece | O que **não** acontece |
|---|---|---|
| **1. Observar** | Findings + flags FP/FN + resultados de correção viram telemetria | LLM não lê o diff do PR para “inventar” regra na hora |
| **2. Propor** | Orquestração de agentes / dress code / curadoria humana alimentam o pool (`ruleforgeDaily`) | Proposta não publica sozinha no RuleSet |
| **3. Provar** | `@codehero/ruleforge` mede P, R, F1 no corpus (`evolve.ts`) | Não há “confiança” subjetiva do modelo |
| **4. Publicar** | Só com ΔF1&gt;0, P≥0,85 e zero regressão | Sem republicar plugin / Action |

## Como isso difere (slide para o board)

```mermaid
flowchart TB
  subgraph other["Clássico / só-IA"]
    A1["Release do vendor"]
    A2["ou LLM por arquivo no PR"]
    A1 --> A3["Time espera patch ou engole FP"]
    A2 --> A4["Resultado pode variar"]
  end
  subgraph hero["CodeHero"]
    B1["Telemetria + política"]
    B2["IA propõe offline"]
    B3["Corpus decide"]
    B4["CI determinístico"]
    B1 --> B2 --> B3 --> B4
  end
```

| Critério | CodeHero | Suite enterprise | Scanner só de IA |
|---|---|---|---|
| Quem decide a regra | Corpus + F1 | Vendor | Modelo / prompt |
| LLM no arquivo do PR? | Não | Em geral não | Sim |
| Mesmo commit → mesmo resultado | Sim | Sim | Não garantido |
| Política do time em linguagem natural | Dress code → regra | Raro | Não estruturado |

## Cenário exercitado (run real)

```bash
npm run ruleforge:evaluate
npm run ruleforge:evolve-all
```

- 20 regras no corpus golden com **P = R = F1 = 1,00**.
- Evolve: baseline F1 = 1,000 · 5 gerações · melhor = 1,000 → **REJECTED — sem ganho de F1**.

**Leitura de produto:** o portão funcionou. Regras já perfeitas **não** são “melhoradas” por cosmética. Promoção só com **ganho comprovado**.

### Cenário de promoção (fluxo de produto)

1. Dev marca FP: `console.log` em arquivo de teste.
2. Admin publica dress code: “proibido `console.log` em produção”.
3. A orquestração propõe a regra + casos no corpus.
4. Se ΔF1&gt;0 e P≥0,85 → RuleSet.
5. Próximo PR: scanner determinístico — sem LLM no hot path.

## CLI útil

| Comando | Função |
|---|---|
| `npm run ruleforge:evaluate` | Tabela P/R/F1 por regra |
| `npm run ruleforge:evolve-all` | Busca evolutiva em lote |
| Job cloud `ruleforgeDaily` | Orquestração 1×/dia |

## Links

- Docs: https://codehero.web.app/docs/#aprendizado-continuo
- Código: `packages/ruleforge/`, `apps/functions/src/ruleforgeDaily.ts`
