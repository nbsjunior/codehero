/**
 * Quais caminhos entram na linguagem `markdown` do scanner.
 * Só instruções de agente — nunca README/docs genéricos.
 */
export function isAgentInstructionPath(file: string): boolean {
  const n = file.replace(/\\/g, "/");
  const lower = n.toLowerCase();
  const base = lower.split("/").pop() ?? "";

  if (
    base === "agents.md" ||
    base === "claude.md" ||
    base === "gemini.md" ||
    base === "skill.md" ||
    base === "rule.md" ||
    base === "copilot-instructions.md" ||
    base === ".cursorrules" ||
    base === "cursorrules"
  ) {
    return true;
  }
  if (base.endsWith(".mdc")) return true;

  if (lower.includes("/.cursor/rules/") || lower.startsWith(".cursor/rules/")) return true;
  if (
    (lower.includes("/.cursor/skills/") || lower.startsWith(".cursor/skills/")) &&
    base.endsWith(".md")
  ) {
    return true;
  }
  if (
    (lower.includes("/.claude/skills/") || lower.startsWith(".claude/skills/")) &&
    base.endsWith(".md")
  ) {
    return true;
  }
  if (
    (lower.includes("/.claude/") || lower.startsWith(".claude/")) &&
    (base === "claude.md" || base.endsWith(".md"))
  ) {
    if (lower.includes("/.claude/docs/") || lower.startsWith(".claude/docs/")) return false;
    return true;
  }
  if ((lower.includes("/.kiro/") || lower.startsWith(".kiro/")) && base.endsWith(".md")) return true;
  if (/(^|\/)skills\/[^/]+\//.test(lower) && base === "skill.md") return true;
  if (
    (lower.includes("/.github/") || lower.startsWith(".github/")) &&
    base === "copilot-instructions.md"
  ) {
    return true;
  }
  if ((lower.includes("/aidlc-rules/") || lower.startsWith("aidlc-rules/")) && base.endsWith(".md")) {
    return true;
  }
  if (lower.includes("/aws-aidlc-") && base.endsWith(".md")) return true;
  if ((lower.includes("/.aidlc/") || lower.startsWith(".aidlc/")) && base.endsWith(".md")) {
    return true;
  }

  return false;
}
