import assert from "node:assert/strict";
import { isAgentInstructionPath, languageForFile } from "../dist/engine.js";

// languageForFile is re-exported path — engine.js exports it.
// But isAgentInstructionPath may only be from contracts; engine re-exports it.

assert.equal(isAgentInstructionPath("AGENTS.md"), true);
assert.equal(isAgentInstructionPath("docs/README.md"), false);
assert.equal(isAgentInstructionPath(".cursor/rules/foo.mdc"), true);
assert.equal(isAgentInstructionPath("skills/aidlc-design/SKILL.md"), true);
assert.equal(isAgentInstructionPath(".kiro/steering/aidlc.md"), true);
assert.equal(isAgentInstructionPath("aidlc-rules/aws-aidlc-rules/core-workflow.md"), true);
assert.equal(isAgentInstructionPath("packages/foo/README.md"), false);

assert.equal(languageForFile("AGENTS.md"), "markdown");
assert.equal(languageForFile("README.md"), null);
assert.equal(languageForFile("src/app.ts"), "typescript");

console.log("agentPaths / languageForFile ok");
