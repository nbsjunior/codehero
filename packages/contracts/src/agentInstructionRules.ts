import type { HeroRule } from "./rules.ts";

/**
 * Higiene de instruções de agentes (AGENTS.md, SKILL.md, .cursor/rules, AIDLC…).
 *
 * Escopo: só arquivos classificados como `markdown` pelo scanner via
 * `isAgentInstructionPath` — não varre README/docs genéricos.
 *
 * Fontes (intent, não cópia):
 * - OWASP LLM Top 10 (LLM01 Prompt Injection)
 * - awslabs/aidlc-workflows (HITL, decision gates, steering)
 * - aws-samples/sample-aidlc-decisions-driven-skill (skill anatomy, human gates)
 * - Boas práticas de SKILL.md / system prompt (frontmatter, constraints, SDD)
 */
export const AGENT_INSTRUCTION_RULES: HeroRule[] = (
  [
    {
      id: "HERO-SEC-agent-prompt-injection",
      name: "AgentPromptInjectionPhrase",
      languages: ["markdown"],
      severity: "CRITICAL",
      type: "VULNERABILITY",
      remediationEffortMin: 20,
      cwe: ["CWE-74"],
      owasp: ["A03:2021-Injection"],
      message:
        "Frase clássica de prompt injection em arquivo de instrução de agente (ignore previous / disregard instructions).",
      sddTemplateId: "sdd.agent.remove-injection",
      category: "prompt-injection",
      pattern: {
        scope: "any",
        regex:
          "(?i)\\b(ignore|disregard|forget|override)\\s+(all\\s+)?(previous|prior|above|earlier|system)\\s+(instructions?|prompts?|rules?|context)\\b|\\b(ignore|disregard)\\s+all\\s+(safety|security|policy)\\b",
        unless: "(?i)(detect|prevent|avoid|never\\s+include|do\\s+not\\s+use|example\\s+of\\s+attack|anti-?injection)",
      },
    },
    {
      id: "HERO-SEC-agent-role-hijack",
      name: "AgentRoleHijack",
      languages: ["markdown"],
      severity: "CRITICAL",
      type: "VULNERABILITY",
      remediationEffortMin: 20,
      cwe: ["CWE-74"],
      owasp: ["A03:2021-Injection"],
      message:
        "Sequestro de persona/papel em instrução de agente (you are now / DAN / jailbreak) — risco de desvio do system prompt.",
      sddTemplateId: "sdd.agent.remove-injection",
      category: "prompt-injection",
      pattern: {
        scope: "any",
        regex:
          "(?i)\\b(you\\s+are\\s+now\\b|jailbreak\\b|\\bDAN\\s+mode\\b|developer\\s+mode\\s+enabled|pretend\\s+you\\s+have\\s+no\\s+restrictions|do\\s+anything\\s+now)\\b",
        unless: "(?i)(detect|prevent|avoid|never|anti-?jailbreak|example\\s+of)",
      },
    },
    {
      id: "HERO-SEC-agent-fake-chat-markers",
      name: "AgentFakeChatMarkers",
      languages: ["markdown"],
      severity: "CRITICAL",
      type: "VULNERABILITY",
      remediationEffortMin: 15,
      cwe: ["CWE-74"],
      owasp: ["A03:2021-Injection"],
      message:
        "Marcadores falsos de turno/sistema (`</system>`, `<|im_start|>`, `[INST]`) em instrução — clássico de prompt injection.",
      sddTemplateId: "sdd.agent.remove-injection",
      category: "prompt-injection",
      pattern: {
        scope: "any",
        regex:
          "(?i)(<\\|im_start\\|>|<\\|im_end\\|>|<\\/\\s*system\\s*>|<\\s*system\\s*>|\\[/INST\\]|\\[INST\\]|<<SYS>>|<\\/SYS>)",
        unless: "(?i)(detect|prevent|example\\s+of\\s+attack|anti-?injection)",
      },
    },
    {
      id: "HERO-SEC-agent-exfiltrate-secrets",
      name: "AgentExfiltrateSecrets",
      languages: ["markdown"],
      severity: "BLOCKER",
      type: "VULNERABILITY",
      remediationEffortMin: 25,
      cwe: ["CWE-200", "CWE-798"],
      owasp: ["A01:2021-Broken Access Control"],
      message:
        "Instrução de agente pede exfiltração de segredos/env/credenciais — não deve existir em steering/SKILL.",
      sddTemplateId: "sdd.agent.harden-instructions",
      category: "sensitive-data-exposure",
      pattern: {
        scope: "any",
        regex:
          "(?i)\\b(dump|exfiltrat|print|reveal|send|upload|post)\\b.{0,40}\\b(api[_-]?key|secret|password|passwd|credentials?|\\.env|process\\.env|AWS_SECRET|private[_-]?key)\\b|\\b(cat|type|Get-Content)\\s+(\\.env|/etc/passwd|~\\/\\.ssh)",
        unless: "(?i)(never|do\\s+not|don't|prohibit|forbid|must\\s+not|never\\s+read|never\\s+print|example\\s+of\\s+bad)",
      },
    },
    {
      id: "HERO-SEC-agent-disable-safety",
      name: "AgentDisableSafety",
      languages: ["markdown"],
      severity: "CRITICAL",
      type: "SECURITY_HOTSPOT",
      remediationEffortMin: 15,
      cwe: ["CWE-693"],
      owasp: [],
      message:
        "Instrução pede para desligar recusas/safety (`never refuse`, `ignore safety`) — enfraquece o guardrail do agente.",
      sddTemplateId: "sdd.agent.harden-instructions",
      category: "security-misconfiguration",
      pattern: {
        scope: "any",
        regex:
          "(?i)\\b(never\\s+refuse|always\\s+comply|ignore\\s+(all\\s+)?(safety|guardrails?|policies)|no\\s+ethical\\s+guidelines|disable\\s+(safety|guardrails?))\\b",
        unless: "(?i)(never\\s+write|do\\s+not\\s+include|prohibit|forbid|anti-pattern)",
      },
    },
    {
      id: "HERO-SMELL-agent-skip-human-gate",
      name: "AgentSkipHumanGate",
      languages: ["markdown"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: [],
      owasp: [],
      message:
        "Instrução pula gate humano (AIDLC decision gate / HITL): `don't ask` / `skip confirmation` / `auto-approve`.",
      sddTemplateId: "sdd.agent.restore-hitl",
      category: "code-smell",
      pattern: {
        scope: "any",
        regex:
          "(?i)\\b(don'?t|do\\s+not|never)\\s+(ask|wait\\s+for)\\s+(the\\s+)?(user|human|approval|confirmation)\\b|\\b(skip|bypass)\\s+(all\\s+)?(confirmation|approval|human|decision\\s*gates?)\\b|\\bauto-?approve\\b|\\bproceed\\s+without\\s+(asking|approval|confirmation)\\b",
        unless: "(?i)(except|unless|only\\s+when|must\\s+ask|always\\s+ask|require\\s+approval)",
      },
    },
    {
      id: "HERO-SMELL-agent-unbounded-shell",
      name: "AgentUnboundedShell",
      languages: ["markdown"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 15,
      cwe: ["CWE-78"],
      owasp: [],
      message:
        "Instrução concede shell/ferramentas sem limite (`any command`, `all tools`, `unrestricted`) — preferir allowlist.",
      sddTemplateId: "sdd.agent.constrain-tools",
      category: "code-smell",
      pattern: {
        scope: "any",
        regex:
          "(?i)\\b(run|execute|use)\\s+(any|every|all)\\s+(command|shell|tool|bash|powershell)s?\\b|\\bunrestricted\\s+(shell|tools?|access)\\b|\\bfull\\s+access\\s+to\\s+(the\\s+)?(filesystem|system|network)\\b",
        unless: "(?i)(never|do\\s+not|don't|forbid|prohibit|must\\s+not|deny)",
      },
    },
    {
      id: "HERO-SMELL-agent-reveal-system-prompt",
      name: "AgentRevealSystemPrompt",
      languages: ["markdown"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: ["CWE-200"],
      owasp: [],
      message:
        "Instrução pede para revelar/repetir o system prompt — anti-padrão de higiene e vetor de vazamento.",
      sddTemplateId: "sdd.agent.harden-instructions",
      category: "prompt-injection",
      pattern: {
        scope: "any",
        regex:
          "(?i)\\b(reveal|print|repeat|output|show|dump)\\b.{0,30}\\b(system\\s+prompt|hidden\\s+instructions?|your\\s+instructions)\\b|\\bwhat\\s+are\\s+your\\s+(system\\s+)?instructions\\b",
        unless: "(?i)(never|do\\s+not|don't|forbid|prohibit|must\\s+not|refuse)",
      },
    },
    {
      id: "HERO-SMELL-agent-commit-secrets-ok",
      name: "AgentAllowsCommitSecrets",
      languages: ["markdown"],
      severity: "BLOCKER",
      type: "VULNERABILITY",
      remediationEffortMin: 10,
      cwe: ["CWE-540"],
      owasp: ["A05:2021-Security Misconfiguration"],
      message:
        "Instrução autoriza commit/push de segredos ou `.env` — política proibida em arquivos de agente.",
      sddTemplateId: "sdd.agent.harden-instructions",
      category: "sensitive-data-exposure",
      pattern: {
        scope: "any",
        regex:
          "(?i)\\b(commit|push|check\\s*in)\\b.{0,40}\\b(secrets?|credentials?|\\.env|api[_-]?keys?)\\b|\\b(it'?s\\s+ok|allowed|feel\\s+free)\\s+to\\s+(commit|push).{0,30}(secret|\\.env|password)",
        unless: "(?i)(never|do\\s+not|don't|forbid|prohibit|must\\s+not|warn\\s+if)",
      },
    },
    {
      id: "HERO-SMELL-agent-no-decision-record",
      name: "AgentNoDecisionRecord",
      languages: ["markdown"],
      severity: "INFO",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: [],
      owasp: [],
      message:
        "Fluxo AIDLC/skill sem registro durável de decisão (decision gate em chat-only) — preferir artefato em markdown versionado.",
      sddTemplateId: "sdd.agent.restore-hitl",
      category: "code-smell",
      pattern: {
        scope: "any",
        regex:
          "(?i)\\b(decide\\s+silently|keep\\s+decisions?\\s+in\\s+chat\\s+only|do\\s+not\\s+(write|create|persist)\\s+(a\\s+)?(decision|gate|manifest))\\b",
        unless: "(?i)(never|do\\s+not\\s+say|avoid\\s+phrasing|anti-pattern)",
      },
    },
  ] as HeroRule[]
).map((r) => ({ ...r, implementation: "core" as const }));
