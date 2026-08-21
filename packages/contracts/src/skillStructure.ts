import type { HeroRule } from "./rules.ts";
import { isAgentInstructionPath } from "./agentPaths.ts";

/**
 * Validador estrutural de SKILL.md (Cursor skill anatomy + AIDLC compact index).
 *
 * Não usa tree-sitter: frontmatter YAML mínimo + headings markdown.
 * Roda no scan L0 quando o path é um SKILL.md de agente.
 */

export interface SkillStructureFinding {
  ruleId: string;
  startLine: number;
  snippet: string;
  message: string;
}

const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const DESC_MAX = 1024;
/** Índice compacto AIDLC ~100–140; acima disto o skill compete demais pelo contexto. */
const INDEX_SOFT_LINES = 220;
const INDEX_HARD_LINES = 400;

/** Secções aceites (Cursor OU AIDLC). Basta uma. */
const BODY_SECTION_RE =
  /^#{2,3}\s+(instructions|examples|activation|information\s+contract|initialization|process|commands|skill\s+handoff|context\s+recovery)\b/i;

export function isSkillMdPath(file: string): boolean {
  if (!isAgentInstructionPath(file)) return false;
  const base = file.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  return base === "skill.md";
}

function parseFrontmatter(source: string): {
  ok: boolean;
  closed: boolean;
  startLine: number;
  endLine: number;
  raw: string;
  fields: Record<string, string>;
} {
  const lines = source.split(/\r?\n/);
  const first = lines[0] ?? "";
  if (lines.length === 0 || first.trim() !== "---") {
    return { ok: false, closed: false, startLine: 1, endLine: 1, raw: "", fields: {} };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) {
    return {
      ok: false,
      closed: false,
      startLine: 1,
      endLine: Math.min(lines.length, 30),
      raw: lines.slice(0, 30).join("\n"),
      fields: {},
    };
  }
  const raw = lines.slice(1, end).join("\n");
  const fields: Record<string, string> = {};
  // YAML mínimo: chave: valor (valor pode continuar na linha; blocos `|`/`>` ignorados além da 1ª linha).
  let currentKey: string | null = null;
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (m) {
      currentKey = (m[1] ?? "").toLowerCase();
      let val = (m[2] ?? "").trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (val === "|" || val === ">" || val === "|-" || val === ">-") {
        fields[currentKey] = "";
        continue;
      }
      fields[currentKey] = val;
    } else if (currentKey && /^\s+\S/.test(line) && fields[currentKey] !== undefined) {
      // Continuação indentada (description multilinha simples).
      const cont = line.trim();
      fields[currentKey] = fields[currentKey] ? `${fields[currentKey]} ${cont}` : cont;
    }
  }
  return { ok: true, closed: true, startLine: 1, endLine: end + 1, raw, fields };
}

/**
 * Valida estrutura de um SKILL.md. Idempotente e sem I/O.
 */
export function validateSkillMd(source: string): SkillStructureFinding[] {
  const out: SkillStructureFinding[] = [];
  const lines = source.split(/\r?\n/);
  const lineCount = lines.length;
  const fm = parseFrontmatter(source);

  if (!fm.ok && !fm.closed && lines[0]?.trim() !== "---") {
    out.push({
      ruleId: "HERO-SMELL-skill-no-frontmatter",
      startLine: 1,
      snippet: (lines[0] ?? "").slice(0, 120),
      message:
        "SKILL.md sem frontmatter YAML (`---` … `---`) — name/description são obrigatórios para descoberta do agente.",
    });
    return out;
  }

  if (!fm.closed) {
    out.push({
      ruleId: "HERO-SMELL-skill-unclosed-frontmatter",
      startLine: 1,
      snippet: fm.raw.slice(0, 120) || "---",
      message: "Frontmatter de SKILL.md aberto com `---` mas sem fecho `---`.",
    });
    return out;
  }

  const name = (fm.fields.name ?? "").trim();
  const description = (fm.fields.description ?? "").trim();

  if (!("name" in fm.fields) || !name) {
    out.push({
      ruleId: "HERO-SMELL-skill-missing-name",
      startLine: fm.startLine,
      snippet: "---",
      message: "Frontmatter de SKILL.md sem `name:` — identificador obrigatório (Cursor/AIDLC).",
    });
  } else if (!NAME_RE.test(name) || name.length > 64) {
    const nameLine =
      lines.findIndex((l, i) => i > 0 && i < fm.endLine && /^name\s*:/i.test(l)) + 1 || fm.startLine;
    out.push({
      ruleId: "HERO-SMELL-skill-invalid-name",
      startLine: nameLine,
      snippet: `name: ${name}`.slice(0, 120),
      message:
        "`name` inválido: use 1–64 chars, minúsculas, números e hífens (sem começar/terminar com hífen).",
    });
  }

  if (!("description" in fm.fields)) {
    out.push({
      ruleId: "HERO-SMELL-skill-missing-description",
      startLine: fm.startLine,
      snippet: "---",
      message:
        "Frontmatter de SKILL.md sem `description:` — o agente usa isto para decidir quando ativar a skill.",
    });
  } else if (!description) {
    const descLine =
      lines.findIndex((l, i) => i > 0 && i < fm.endLine && /^description\s*:/i.test(l)) + 1 ||
      fm.startLine;
    out.push({
      ruleId: "HERO-SMELL-skill-empty-description",
      startLine: descLine,
      snippet: "description:",
      message: "`description` está vazio — descreva WHAT + WHEN (gatilhos) em terceira pessoa.",
    });
  } else {
    const descLine =
      lines.findIndex((l, i) => i > 0 && i < fm.endLine && /^description\s*:/i.test(l)) + 1 ||
      fm.startLine;
    if (description.length > DESC_MAX) {
      out.push({
        ruleId: "HERO-SMELL-skill-description-too-long",
        startLine: descLine,
        snippet: description.slice(0, 80) + "…",
        message: `description com ${description.length} chars (máx ${DESC_MAX}) — enxugue para caber no system prompt.`,
      });
    }
    if (/^(i\s+can|i\s+will|i'?m\s+|you\s+can\s+use|you\s+can\s+help)\b/i.test(description)) {
      out.push({
        ruleId: "HERO-SMELL-skill-description-first-person",
        startLine: descLine,
        snippet: description.slice(0, 120),
        message:
          "description em 1ª/2ª pessoa — escreva em terceira pessoa (é injectada no system prompt).",
      });
    }
  }

  const bodyStart = fm.endLine; // 0-based index of first body line
  let hasH1 = false;
  let hasBodySection = false;
  for (let i = bodyStart; i < lines.length; i++) {
    const t = (lines[i] ?? "").trim();
    if (/^#\s+\S/.test(t)) hasH1 = true;
    if (BODY_SECTION_RE.test(t)) hasBodySection = true;
  }

  if (!hasH1) {
    out.push({
      ruleId: "HERO-SMELL-skill-missing-h1",
      startLine: Math.min(bodyStart + 1, lineCount) || 1,
      snippet: (lines[bodyStart] ?? "").slice(0, 120),
      message: "SKILL.md sem título H1 (`# …`) após o frontmatter.",
    });
  }

  if (!hasBodySection) {
    out.push({
      ruleId: "HERO-SMELL-skill-missing-body-section",
      startLine: Math.min(bodyStart + 1, lineCount) || 1,
      snippet: (lines[bodyStart] ?? "").slice(0, 120),
      message:
        "SKILL.md sem secção estrutural (`## Instructions` / `Activation` / `Information Contract` / `Process` / …) — índice AIDLC/Cursor incompleto.",
    });
  }

  if (lineCount > INDEX_HARD_LINES) {
    out.push({
      ruleId: "HERO-SMELL-skill-index-too-long",
      startLine: 1,
      snippet: `${lineCount} lines`,
      message: `SKILL.md com ${lineCount} linhas (limite duro ${INDEX_HARD_LINES}) — mova detalhe para actions/references (índice compacto AIDLC).`,
    });
  } else if (lineCount > INDEX_SOFT_LINES) {
    out.push({
      ruleId: "HERO-SMELL-skill-index-bloated",
      startLine: 1,
      snippet: `${lineCount} lines`,
      message: `SKILL.md com ${lineCount} linhas (alvo AIDLC ~100–140; aviso acima de ${INDEX_SOFT_LINES}) — prefira carregar actions/ on-demand.`,
    });
  }

  return out;
}

/** Metadados das regras estruturais de SKILL.md (detecção via validateSkillMd). */
export const SKILL_STRUCTURE_RULES: HeroRule[] = (
  [
    {
      id: "HERO-SMELL-skill-no-frontmatter",
      name: "SkillNoFrontmatter",
      languages: ["markdown"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: [],
      owasp: [],
      message: "SKILL.md sem frontmatter YAML.",
      sddTemplateId: "sdd.agent.skill-structure",
      category: "code-smell",
      pattern: { regex: "(?!)" },
    },
    {
      id: "HERO-SMELL-skill-unclosed-frontmatter",
      name: "SkillUnclosedFrontmatter",
      languages: ["markdown"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: [],
      owasp: [],
      message: "Frontmatter de SKILL.md sem fecho.",
      sddTemplateId: "sdd.agent.skill-structure",
      category: "code-smell",
      pattern: { regex: "(?!)" },
    },
    {
      id: "HERO-SMELL-skill-missing-name",
      name: "SkillMissingName",
      languages: ["markdown"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: [],
      owasp: [],
      message: "SKILL.md sem name no frontmatter.",
      sddTemplateId: "sdd.agent.skill-structure",
      category: "code-smell",
      pattern: { regex: "(?!)" },
    },
    {
      id: "HERO-SMELL-skill-invalid-name",
      name: "SkillInvalidName",
      languages: ["markdown"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: [],
      owasp: [],
      message: "name de SKILL.md inválido.",
      sddTemplateId: "sdd.agent.skill-structure",
      category: "code-smell",
      pattern: { regex: "(?!)" },
    },
    {
      id: "HERO-SMELL-skill-missing-description",
      name: "SkillMissingDescription",
      languages: ["markdown"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: [],
      owasp: [],
      message: "SKILL.md sem description no frontmatter.",
      sddTemplateId: "sdd.agent.skill-structure",
      category: "code-smell",
      pattern: { regex: "(?!)" },
    },
    {
      id: "HERO-SMELL-skill-empty-description",
      name: "SkillEmptyDescription",
      languages: ["markdown"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: [],
      owasp: [],
      message: "description de SKILL.md vazio.",
      sddTemplateId: "sdd.agent.skill-structure",
      category: "code-smell",
      pattern: { regex: "(?!)" },
    },
    {
      id: "HERO-SMELL-skill-description-too-long",
      name: "SkillDescriptionTooLong",
      languages: ["markdown"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: [],
      owasp: [],
      message: "description de SKILL.md acima de 1024 chars.",
      sddTemplateId: "sdd.agent.skill-structure",
      category: "code-smell",
      pattern: { regex: "(?!)" },
    },
    {
      id: "HERO-SMELL-skill-description-first-person",
      name: "SkillDescriptionFirstPerson",
      languages: ["markdown"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 2,
      cwe: [],
      owasp: [],
      message: "description de SKILL.md em 1ª/2ª pessoa.",
      sddTemplateId: "sdd.agent.skill-structure",
      category: "code-smell",
      pattern: { regex: "(?!)" },
    },
    {
      id: "HERO-SMELL-skill-missing-h1",
      name: "SkillMissingH1",
      languages: ["markdown"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 2,
      cwe: [],
      owasp: [],
      message: "SKILL.md sem H1.",
      sddTemplateId: "sdd.agent.skill-structure",
      category: "code-smell",
      pattern: { regex: "(?!)" },
    },
    {
      id: "HERO-SMELL-skill-missing-body-section",
      name: "SkillMissingBodySection",
      languages: ["markdown"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 15,
      cwe: [],
      owasp: [],
      message: "SKILL.md sem secção estrutural de corpo.",
      sddTemplateId: "sdd.agent.skill-structure",
      category: "code-smell",
      pattern: { regex: "(?!)" },
    },
    {
      id: "HERO-SMELL-skill-index-bloated",
      name: "SkillIndexBloated",
      languages: ["markdown"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 20,
      cwe: [],
      owasp: [],
      message: "SKILL.md índice inchado (aviso).",
      sddTemplateId: "sdd.agent.skill-structure",
      category: "code-smell",
      pattern: { regex: "(?!)" },
    },
    {
      id: "HERO-SMELL-skill-index-too-long",
      name: "SkillIndexTooLong",
      languages: ["markdown"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 30,
      cwe: [],
      owasp: [],
      message: "SKILL.md índice demasiado longo.",
      sddTemplateId: "sdd.agent.skill-structure",
      category: "code-smell",
      pattern: { regex: "(?!)" },
    },
  ] as HeroRule[]
).map((r) => ({ ...r, implementation: "structural" as const }));
