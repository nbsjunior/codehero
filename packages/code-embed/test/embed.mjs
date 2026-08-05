import {
  embedPaths,
  kmeans,
  chooseK,
  cosine,
  annotateSarifWithClusters,
} from "../dist/index.js";

let falhas = 0;
const check = (ok, msg) => {
  if (!ok) {
    falhas++;
    console.log("  FALHA: " + msg);
  }
};

console.log("=== embeddings: funções parecidas ficam perto");
// AST sintética via caminhos (sem tree-sitter no unit test).
const sortLike = embedPaths([
  "function_declaration>statement_block>for_statement",
  "function_declaration>statement_block>if_statement",
  "T:for_statement",
  "T:if_statement",
  "T:binary_expression",
]);
const sortLike2 = embedPaths([
  "function_declaration>statement_block>for_statement",
  "function_declaration>statement_block>if_statement",
  "T:for_statement",
  "T:if_statement",
  "T:binary_expression",
]);
const httpHandler = embedPaths([
  "function_declaration>statement_block>call_expression",
  "function_declaration>statement_block>return_statement",
  "T:call_expression",
  "T:member_expression",
  "T:string",
]);
const simSame = cosine(sortLike, sortLike2);
const simDiff = cosine(sortLike, httpHandler);
console.log(`  mesma forma=${simSame.toFixed(3)} vs handler=${simDiff.toFixed(3)}`);
check(simSame > 0.99, "mesmos caminhos → cosine ≈ 1");
check(simSame > simDiff, "formas diferentes → cosine menor");

console.log("\n=== K-Means separa dois grupos");
const g1 = Array.from({ length: 8 }, (_, i) => {
  const v = new Float64Array(8);
  v[0] = 1;
  v[1] = 0.1 * i;
  return v;
});
const g2 = Array.from({ length: 8 }, (_, i) => {
  const v = new Float64Array(8);
  v[0] = -1;
  v[1] = 0.1 * i;
  return v;
});
const pts = [...g1, ...g2];
const km = kmeans(pts, 2, { seed: 42 });
const a0 = km.assignments[0];
const split = km.assignments.slice(0, 8).every((a) => a === a0) &&
  km.assignments.slice(8).every((a) => a !== a0);
console.log(`  k=${km.k} inertia=${km.inertia.toFixed(3)} split=${split}`);
check(split, "dois grupos devem cair em clusters distintos");
check(chooseK(100) >= 2, "chooseK razoável");

console.log("\n=== annotate SARIF");
const report = {
  version: "code-embed-v1",
  generatedAt: new Date().toISOString(),
  dim: 8,
  k: 1,
  inertia: 0,
  iterations: 1,
  functionCount: 1,
  fileCount: 1,
  clusters: [{ id: "fam-1-0", size: 1, sampleFiles: ["src/a.ts"] }],
  functions: [
    {
      id: "src/a.ts:1:foo",
      file: "src/a.ts",
      name: "foo",
      startLine: 1,
      endLine: 20,
      embedding: [],
      clusterId: "fam-1-0",
      clusterIndex: 0,
      familySize: 1,
      outlierScore: 0.2,
    },
  ],
};
const sarif = {
  runs: [
    {
      results: [
        {
          ruleId: "R",
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "src/a.ts" },
                region: { startLine: 5 },
              },
            },
          ],
          properties: {},
        },
      ],
    },
  ],
};
const { annotated } = annotateSarifWithClusters(sarif, report);
check(annotated === 1, "deve anotar 1 finding");
check(sarif.runs[0].results[0].properties.clusterId === "fam-1-0", "clusterId no SARIF");

console.log(falhas === 0 ? "\ntodas as asserções passaram" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
