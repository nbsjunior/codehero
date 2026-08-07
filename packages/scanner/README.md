# @codehero/scanner

Análise estática com **gate de build determinístico**. Mesma entrada, mesma saída — nenhum modelo de linguagem participa do scan.

```bash
npx @codehero/scanner .
```

Sai com código 1 se houver achado acima do limiar configurado; 0 caso contrário. É isso que o torna usável em CI.

## O que ele faz

Três níveis, do mais barato ao mais caro:

| Nível | O que vê | Custo |
|---|---|---|
| **L0** | padrão por linha, com máscara léxica que separa código de comentário e de string | microssegundos por arquivo |
| **L1** | a **árvore**: distingue `eval(entrada)` de `eval("literal")`, vê `catch` vazio com as chaves em linhas diferentes, sabe se a chamada está dentro de um laço | ~13 ms por arquivo de 25 KB |
| **L2** | fluxo de dados (fonte → sumidouro), hoje só JS/TS | por arquivo, sob demanda |

Linguagens: JavaScript, TypeScript, Python, Java, C#, Go, COBOL e DB2 SQL PL.

## O diferencial: legado

COBOL e DB2 não são um checkbox aqui. O motor tem parser próprio para ambos e analisa a **costura** entre eles — que é onde moram os defeitos que derrubam batch em produção e que nenhuma ferramenta que olhe só o COBOL ou só o SQL consegue ver:

- host variable menor que a coluna (`PIC S9(4)` recebendo `INTEGER`) — trunca em silêncio;
- cursor aberto e nunca fechado;
- `EXEC SQL` dentro de `PERFORM` — no mainframe a CPU é faturada;
- `COMMIT` em laço com cursor sem `WITH HOLD` — `SQLCODE -501` só quando o volume passa do ponto de commit, ou seja, em produção;
- `SQLCODE` não checado, com fecho transitivo de `PERFORM`;
- em SQL PL, `EXECUTE IMMEDIATE` de variável **remendada com `||`** — a montagem e a execução ficam em statements diferentes, então nenhuma regex por linha liga as duas pontas.

## Integração com ferramentas existentes

Importa SARIF de ESLint, Semgrep, Opengrep, PMD, SpotBugs e oxlint, e colapsa o eco entre elas — quando duas ferramentas apontam o mesmo defeito, você vê um achado, não dois. Análise de dependências (SCA) nunca é absorvida, porque nunca é eco.

## Uso

```bash
npx @codehero/scanner . --metrics
```

- `--metrics` liga métricas estruturais (complexidade, duplicação, aninhamento). Custa parsing; deixe desligado se você só quer o gate.
- `--format sarif` para consumir em outra ferramenta.

## Limites, ditos na frente

- Rastreamento de fluxo (L2) existe só para JS/TS. Nas demais linguagens as regras valem no nível de padrão e de árvore — o catálogo diz qual regra é qual.
- Achados do tipo `SECURITY_HOTSPOT` **não reprovam o build**, por desenho: eles pedem revisão humana, e reprovar CI por eles gera ruído que ninguém lê.
- Regras estruturais silenciam quando a árvore tem erro de sintaxe. Um match daí seria artefato, não achado.

## Licença

Apache-2.0. Código em <https://github.com/nbsjunior/codehero>.
