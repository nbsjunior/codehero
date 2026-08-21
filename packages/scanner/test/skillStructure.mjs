import assert from "node:assert/strict";
import { analyzeSource } from "../dist/engine.js";

const bad = `---
name: Bad_Skill
description: I can help with everything
---
# Title only
`;

const findings = analyzeSource("skills/demo/SKILL.md", bad);
const ids = new Set(findings.map((f) => f.rule.id));
assert.ok(ids.has("HERO-SMELL-skill-invalid-name"), [...ids].join(","));
assert.ok(ids.has("HERO-SMELL-skill-description-first-person"), [...ids].join(","));
assert.ok(ids.has("HERO-SMELL-skill-missing-body-section"), [...ids].join(","));

const good = `---
name: demo-skill
description: Demonstrates skill lint. Use when testing CodeHero agent structure rules.
---
# Demo Skill

## Instructions
Keep this short.
`;
const ok = analyzeSource("skills/demo/SKILL.md", good).filter((f) =>
  f.rule.id.startsWith("HERO-SMELL-skill-"),
);
assert.equal(ok.length, 0, ok.map((f) => f.rule.id).join(","));

// README não é skill path — languageForFile retorna null
assert.equal(analyzeSource("README.md", bad).length, 0);

console.log("analyzeSource skill structure ok");
