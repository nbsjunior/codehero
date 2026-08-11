/**
 * Sync docs/wiki → GitHub wiki working tree.
 * Usage: node scripts/sync-github-wiki.mjs <wiki-clone-dir>
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "docs", "wiki");
const dst = process.argv[2];
if (!dst) {
  console.error("Usage: node scripts/sync-github-wiki.mjs <wiki-clone-dir>");
  process.exit(1);
}

function wikiify(md, file) {
  let t = md;
  t = t.replace(/\]\(\.\/([^)#]+)\.md(#[^)]+)?\)/g, (_, p, hash) => `](${p}${hash || ""})`);
  t = t.replace(/\]\(\.\.\/GITHUB_ACTION_ONE_CLICK\.md\)/g, "](GitHub-Action-Setup)");
  t = t.replace(
    /\]\(\.\.\/\.\.\/benchmarks\//g,
    "](https://github.com/nbsjunior/codehero/blob/main/benchmarks/",
  );
  t = t.replace(
    /\]\(\.\.\/\.\.\/reports\//g,
    "](https://github.com/nbsjunior/codehero/blob/main/reports/",
  );
  t = t.replace(
    /\]\(\.\.\/\.\.\/packages\//g,
    "](https://github.com/nbsjunior/codehero/blob/main/packages/",
  );
  t = t.replace(
    /\]\(\.\.\/\.\.\/examples\//g,
    "](https://github.com/nbsjunior/codehero/blob/main/examples/",
  );
  t = t.replace(
    /\]\(\.\.\/\.\.\/scripts\//g,
    "](https://github.com/nbsjunior/codehero/blob/main/scripts/",
  );
  if (file === "README.md") {
    t = t.replace(
      /Action one-click: \[.*?\]\(.*?\)/,
      "Action one-click: [GitHub Action Setup](GitHub-Action-Setup)",
    );
  }
  return t;
}

for (const f of readdirSync(src).filter((x) => x.endsWith(".md"))) {
  const body = wikiify(readFileSync(join(src, f), "utf8"), f);
  const outName = f === "README.md" ? "Home.md" : f;
  writeFileSync(join(dst, outName), body);
  console.log("wrote", outName);
}

const actionSrc = join(root, "docs", "GITHUB_ACTION_ONE_CLICK.md");
let action = wikiify(readFileSync(actionSrc, "utf8"), "x");
action = action.replace(
  /\]\(wiki\/([^)#]+)(?:\.md)?(#[^)]+)?\)/g,
  (_, p, hash) => `](${p}${hash || ""})`,
);
writeFileSync(
  join(dst, "GitHub-Action-Setup.md"),
  [
    "> Espelho do briefing em `docs/GITHUB_ACTION_ONE_CLICK.md` no repositório.",
    "",
    action,
    "",
    "---",
    "",
    "- [Presenca-SARIF](Presenca-SARIF)",
    "- [Posicionamento-e-metricas](Posicionamento-e-metricas)",
    "",
  ].join("\n"),
);
console.log("wrote GitHub-Action-Setup.md");

const note =
  "> **Briefing para CTO / líder técnico:** comece por [Posicionamento-e-metricas](Posicionamento-e-metricas) e o [Home](Home).\n";

function prepend(file, extra = "") {
  const p = join(dst, file);
  if (!existsSync(p)) return;
  let t = readFileSync(p, "utf8");
  if (t.includes("Briefing para CTO")) return;
  writeFileSync(p, note + extra + "\n" + t);
  console.log("noted", file);
}

for (const f of [
  "Getting-Started.md",
  "Running-the-Scanner.md",
  "Firebase-Backend.md",
  "Deploying-to-Firebase.md",
  "Multi-Language-Support.md",
]) {
  prepend(f);
}
prepend("MCP-Integration.md", "> Guia passo a passo: [Conectar-MCP-CodeHero](Conectar-MCP-CodeHero).\n");
prepend(
  "Ruleforge-Guide.md",
  "> Esteira: [Esteira-de-aprendizado-de-regras](Esteira-de-aprendizado-de-regras).\n",
);

console.log("done");
