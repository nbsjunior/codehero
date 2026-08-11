import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildCodeGraph } from "../dist/index.js";
import { callers, callees, enrichFinding, hopsToEntrypoint } from "../dist/index.js";

const root = join(tmpdir(), `codehero-graph-${Date.now()}`);
mkdirSync(root, { recursive: true });
mkdirSync(join(root, "src"), { recursive: true });

writeFileSync(
  join(root, "src", "entry.ts"),
  `
export function main() {
  helper();
  helper();
}
`,
);
writeFileSync(
  join(root, "src", "lib.ts"),
  `
export function helper() {
  return 1;
}
export function unused() {
  return 2;
}
`,
);
writeFileSync(
  join(root, "src", "entry.ts"),
  `
import { helper } from "./lib";

export function main() {
  helper();
}
`,
);

let falhas = 0;
const check = (ok, msg) => {
  if (!ok) {
    falhas++;
    console.log("  FALHA:", msg);
  } else console.log("  ok:", msg);
};

const doc = await buildCodeGraph({
  root,
  files: [join(root, "src", "entry.ts"), join(root, "src", "lib.ts")],
});

check(doc.version === 1, "version 1");
check(doc.nodes.some((n) => n.name === "main" && n.entry), "main is entry");
const helper = doc.nodes.find((n) => n.name === "helper" && n.kind === "function");
check(Boolean(helper), "helper node exists");
const main = doc.nodes.find((n) => n.name === "main" && n.kind === "function");
check(Boolean(main), "main node exists");

if (main && helper) {
  const outs = callees(doc, main.id).map((n) => n.name);
  check(outs.includes("helper"), "main calls helper");
  const ins = callers(doc, helper.id).map((n) => n.name);
  check(ins.includes("main"), "helper called by main");
  const hops = hopsToEntrypoint(doc, helper.id);
  check(hops === 1, `helper hopsToEntry=1 (got ${hops})`);
  const ev = enrichFinding(doc, "src/lib.ts", helper.startLine ?? 2);
  check(ev.fanIn >= 1, `fanIn>=1 (got ${ev.fanIn})`);
  check(ev.priority > 0, `priority>0 (got ${ev.priority})`);
  check(ev.imports.length >= 0, "imports array present");
}

const importEdge = doc.edges.find((e) => e.kind === "imports");
check(Boolean(importEdge), "has import edge");

const { toVizSummary } = await import("../dist/index.js");
const viz = toVizSummary(doc);
check(viz.functions >= 2, `viz functions>=2 (got ${viz.functions})`);
check(viz.calls >= 1, `viz calls>=1 (got ${viz.calls})`);
check(viz.hotspots.length > 0, "viz hotspots");

rmSync(root, { recursive: true, force: true });
if (falhas) {
  console.log(`\n${falhas} falha(s)`);
  process.exit(1);
}
console.log("\ncode-graph ok");
