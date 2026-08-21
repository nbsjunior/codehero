import assert from "node:assert/strict";
import { validateSkillMd, isSkillMdPath } from "../dist/skillStructure.js";

assert.equal(isSkillMdPath("skills/foo/SKILL.md"), true);
assert.equal(isSkillMdPath("AGENTS.md"), false);
assert.equal(isSkillMdPath("README.md"), false);

{
  const f = validateSkillMd("# Just a title\n");
  assert.ok(f.some((x) => x.ruleId === "HERO-SMELL-skill-no-frontmatter"));
}

{
  const f = validateSkillMd("---\nname: bad_Name\ndescription: x\n---\n# T\n\n## Instructions\nDo it.\n");
  assert.ok(f.some((x) => x.ruleId === "HERO-SMELL-skill-invalid-name"));
}

{
  const f = validateSkillMd("---\nname: ok-skill\n---\n# T\n\n## Instructions\nDo it.\n");
  assert.ok(f.some((x) => x.ruleId === "HERO-SMELL-skill-missing-description"));
}

{
  const f = validateSkillMd(
    "---\nname: ok-skill\ndescription: I can help with PDFs\n---\n# T\n\n## Instructions\nDo it.\n",
  );
  assert.ok(f.some((x) => x.ruleId === "HERO-SMELL-skill-description-first-person"));
}

{
  const f = validateSkillMd(
    "---\nname: ok-skill\ndescription: Processes PDFs when the user mentions PDF files.\n---\n# PDF Skill\n\nSome prose without sections.\n",
  );
  assert.ok(f.some((x) => x.ruleId === "HERO-SMELL-skill-missing-body-section"));
}

{
  const f = validateSkillMd(`---
name: ok-skill
description: Processes PDFs when the user mentions PDF files.
---
# PDF Skill

## Instructions
Use pdfplumber.
`);
  assert.equal(f.length, 0, JSON.stringify(f));
}

{
  const f = validateSkillMd(`---
name: aidlc
description: AI-DLC workflow orchestrator. Use when starting or resuming AIDLC phases.
---
# AI-DLC Orchestrator

## Activation
Say hello.

## Information Contract
Inputs and outputs.
`);
  assert.equal(f.length, 0, JSON.stringify(f));
}

console.log("skillStructure ok");
