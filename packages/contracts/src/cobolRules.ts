import type { HeroRule } from "./rules.ts";

/**
 * COBOL CORE rules — L0 pattern pack aligned with IBM ZCodeScan / RAA / shop
 * coding standards (structured COBOL, EXEC SQL hygiene, CICS smell, secrets).
 *
 * Sources (intent, not a byte-for-byte port of proprietary analyzers):
 * - IBM ZCodeScan rule catalog (`zcodescan.cobol.rules.*`)
 * - IBM RAA unstructured-control / essential-complexity signals (ALTER, GO TO, ENTRY…)
 * - Common COBOL quality practices (NEXT SENTENCE, PERFORM THRU, SELECT *, etc.)
 *
 * Only rules that are reliable as **line-oriented regex** are included.
 * Nesting limits, unused variables, cross-paragraph flow, and true dataflow
 * need tree-sitter / CFG — out of scope for this pack.
 *
 * `ibmRef` in comments maps to the closest ZCodeScan rule id for reviewers.
 */
export const COBOL_CORE_RULES: HeroRule[] = (
  [
    // --- Security / credentials -------------------------------------------------
    {
      id: "HERO-SEC-0798-cobol-value-secret",
      name: "CobolValueSecret",
      languages: ["cobol"],
      severity: "BLOCKER",
      type: "VULNERABILITY",
      remediationEffortMin: 20,
      cwe: ["CWE-798"],
      owasp: ["A07:2021-Identification and Authentication Failures"],
      message:
        "Credencial embutida em cláusula VALUE da DATA DIVISION: o valor vai no load module e quem tem o binário tem a senha.",
      sddTemplateId: "sdd.secret.externalize",
      category: "sensitive-data-exposure",
      // A regra irmã (0798-cobol-hardcoded-secret) só vê `MOVE 'x' TO WS-SENHA`,
      // que é atribuição em PROCEDURE DIVISION. Segredo em COBOL costuma estar
      // na DECLARAÇÃO — `05 WS-SENHA PIC X(8) VALUE 'admin123'` — e quase
      // sempre dentro de copybook compartilhado por dezenas de programas.
      //
      // Só passou a ser detectável quando a expansão de copybook entrou: antes
      // o analisador via a linha `COPY CLIENTE.` e nada do que havia dentro.
      pattern: {
        scope: "any",
        regex:
          "(?i)\\b[\\w-]*(PASSWORD|PASSWD|SENHA|PWD|SECRET|APIKEY|API-KEY|TOKEN|CREDENTIAL|PASSPHRASE)[\\w-]*\\s+PIC\\s+[^.]*?\\bVALUE\\s+['\"][^'\"]{4,}['\"]",
        // Valor de preenchimento não é segredo: SPACES, ZEROS, ALL '*' e
        // marcadores óbvios de exemplo saem antes de virar BLOCKER.
        unless:
          "(?i)\\bVALUE\\s+(SPACES?|ZEROS?|ZEROES|LOW-VALUES?|HIGH-VALUES?|ALL\\b)|['\"](x{4,}|\\*{4,}|EXEMPLO|EXAMPLE|DUMMY|CHANGEME|TROCAR)['\"]",
      },
    },
    {
      id: "HERO-SEC-0798-cobol-hardcoded-secret",
      name: "CobolHardcodedSecret",
      languages: ["cobol"],
      severity: "BLOCKER",
      type: "VULNERABILITY",
      remediationEffortMin: 15,
      cwe: ["CWE-798"],
      owasp: ["A07:2021-Identification and Authentication Failures"],
      message: "Credencial hardcoded em MOVE … TO (PASSWORD/SECRET/APIKEY).",
      sddTemplateId: "sdd.secret.externalize",
      category: "sensitive-data-exposure",
      // ibmRef: UnprotectedAuthCredentialRule
      pattern: {
        scope: "any",
        regex:
          "(?i)MOVE\\s+['\"][^'\"]{8,}['\"]\\s+TO\\s+[\\w-]*(PASSWORD|PWD|SECRET|APIKEY|DB-PASS|TOKEN|CREDENTIAL)",
      },
    },
    {
      id: "HERO-SEC-cobol-accept-console",
      name: "CobolAcceptFromConsole",
      languages: ["cobol"],
      severity: "CRITICAL",
      type: "VULNERABILITY",
      remediationEffortMin: 20,
      cwe: ["CWE-20"],
      owasp: ["A04:2021-Insecure Design"],
      message: "ACCEPT … FROM CONSOLE lê entrada interativa — risco em batch/produção e difícil de auditar.",
      sddTemplateId: "sdd.generic.secure-fix",
      category: "security-misconfiguration",
      // ibmRef: AcceptFromConsoleRule
      pattern: {
        regex: "(?i)\\bACCEPT\\b[^.\\n]*\\bFROM\\s+CONSOLE\\b",
      },
    },
    {
      id: "HERO-SEC-cobol-sql-select-star",
      name: "CobolSqlSelectStar",
      languages: ["cobol"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 15,
      cwe: ["CWE-89"],
      owasp: ["A03:2021-Injection"],
      message: "SELECT * em EXEC SQL: acopla o programa à ordem das colunas e dificulta revisão de segurança.",
      sddTemplateId: "sdd.generic.smell",
      category: "string-injection",
      // ibmRef: SqlAvoidSelectStarRule
      pattern: {
        regex: "(?i)\\bSELECT\\s+\\*",
      },
    },
    {
      id: "HERO-SEC-cobol-sql-no-where",
      name: "CobolSqlDeleteUpdateNoWhere",
      languages: ["cobol"],
      severity: "CRITICAL",
      type: "VULNERABILITY",
      remediationEffortMin: 25,
      cwe: ["CWE-89"],
      owasp: ["A03:2021-Injection"],
      message: "DELETE/UPDATE sem WHERE na mesma linha — risco de afetar a tabela inteira.",
      sddTemplateId: "sdd.sqli.parametrize",
      category: "string-injection",
      // ibmRef: SqlWhereRule
      pattern: {
        scope: "any",
        regex: "(?i)\\b(DELETE\\s+FROM|UPDATE)\\s+[\\w.\"`]+(?![^\\n]*\\bWHERE\\b)",
        unless: "(?i)\\bWHERE\\b",
      },
    },
    {
      id: "HERO-SEC-cobol-sql-ddl",
      name: "CobolSqlDdlInApp",
      languages: ["cobol"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 30,
      cwe: [],
      owasp: [],
      message: "DDL (CREATE/DROP/ALTER/TRUNCATE) em programa de aplicação — isole em scripts de migração.",
      sddTemplateId: "sdd.generic.smell",
      category: "security-misconfiguration",
      // ibmRef: SqlNoDdlInAppRule
      pattern: {
        regex: "(?i)\\b(CREATE|DROP|ALTER|TRUNCATE)\\s+(TABLE|INDEX|VIEW|SCHEMA)\\b",
      },
    },
    {
      id: "HERO-SEC-cobol-sql-like-leading-wildcard",
      name: "CobolSqlLikeLeadingWildcard",
      languages: ["cobol"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: [],
      owasp: [],
      message: "LIKE com curingas à esquerda ('%…') impede uso eficiente de índice.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      // ibmRef: SqlNoLeadingWildcardLikeRule
      pattern: {
        scope: "any",
        regex: "(?i)\\bLIKE\\s+['\"]%",
      },
    },
    {
      id: "HERO-SEC-cobol-sql-lock-table",
      name: "CobolSqlLockTable",
      languages: ["cobol"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 20,
      cwe: [],
      owasp: [],
      message: "LOCK TABLE no programa — contention e risco operacional em produção.",
      sddTemplateId: "sdd.generic.smell",
      category: "security-misconfiguration",
      // ibmRef: SqlNoLockTableRule
      pattern: {
        regex: "(?i)\\bLOCK\\s+TABLE\\b",
      },
    },

    // --- Unstructured control flow (RAA / ZCodeScan) ---------------------------
    {
      id: "HERO-SMELL-0goto-cobol",
      name: "CobolGoTo",
      languages: ["cobol"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 15,
      cwe: [],
      owasp: [],
      message: "GO TO: fluxo não estruturado — prefira PERFORM / IF / EVALUATE.",
      sddTemplateId: "sdd.smell.restructure-goto",
      category: "code-smell",
      // ibmRef: GotoRule
      pattern: {
        regex: "(?i)\\bGO\\s+TO\\b",
        unless: "(?i)GO\\s+TO\\.\\s*$",
      },
    },
    {
      id: "HERO-SMELL-goto-depending-cobol",
      name: "CobolGoToDependingOn",
      languages: ["cobol"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 25,
      cwe: [],
      owasp: [],
      message: "GO TO … DEPENDING ON — use EVALUATE / tabela de PERFORM.",
      sddTemplateId: "sdd.smell.restructure-goto",
      category: "code-smell",
      // ibmRef: GotoDependingOnRule
      pattern: {
        regex: "(?i)\\bGO\\s+TO\\b[^.\\n]*\\bDEPENDING\\s+ON\\b",
      },
    },
    {
      id: "HERO-SMELL-alter-cobol",
      name: "CobolAlter",
      languages: ["cobol"],
      severity: "CRITICAL",
      type: "CODE_SMELL",
      remediationEffortMin: 30,
      cwe: [],
      owasp: [],
      message: "ALTER muda o destino de GO TO em runtime — fluxo imprevisível (RAA: nó não redutível).",
      sddTemplateId: "sdd.smell.remove-alter-cobol",
      category: "code-smell",
      // ibmRef: AlterRule
      pattern: {
        regex: "(?i)\\bALTER\\s+[\\w-]+\\s+TO\\b",
      },
    },
    {
      id: "HERO-SMELL-next-sentence-cobol",
      name: "CobolNextSentence",
      languages: ["cobol"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: [],
      owasp: [],
      message: "NEXT SENTENCE salta para fora do bloco estruturado — use CONTINUE / END-IF.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      // ibmRef: NextSentenceRule
      pattern: {
        regex: "(?i)\\bNEXT\\s+SENTENCE\\b",
      },
    },
    {
      id: "HERO-SMELL-perform-thru-cobol",
      name: "CobolPerformThru",
      languages: ["cobol"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 20,
      cwe: [],
      owasp: [],
      message: "PERFORM … THRU/THROUGH acopla parágrafos intermediários — prefira PERFORM de parágrafo único.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      // ibmRef: PerformWithThroughRule
      pattern: {
        regex: "(?i)\\bPERFORM\\s+[\\w-]+\\s+(THRU|THROUGH)\\s+[\\w-]+",
      },
    },
    {
      id: "HERO-SMELL-entry-cobol",
      name: "CobolEntry",
      languages: ["cobol"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 40,
      cwe: [],
      owasp: [],
      message: "ENTRY cria múltiplos pontos de entrada — eleva complexidade essencial (RAA).",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      // ibmRef: EntryRule
      pattern: {
        scope: "any",
        regex: "(?i)^\\s{6,}ENTRY\\s+['\"]?[\\w-]+",
      },
    },
    {
      id: "HERO-SMELL-cancel-cobol",
      name: "CobolCancel",
      languages: ["cobol"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 15,
      cwe: [],
      owasp: [],
      message: "CANCEL de subprograma — estado compartilhado e ciclo de vida difíceis de raciocinar.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      // ibmRef: CancelRule
      pattern: {
        scope: "any",
        regex: "(?i)\\bCANCEL\\s+['\"]?[\\w-]+",
      },
    },
    {
      id: "HERO-SMELL-exit-program-cobol",
      name: "CobolExitProgram",
      languages: ["cobol"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: [],
      owasp: [],
      message: "EXIT PROGRAM — em programas modernos prefira GOBACK (retorno explícito).",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      // ibmRef: ExitProgramRule
      pattern: {
        regex: "(?i)\\bEXIT\\s+PROGRAM\\b",
      },
    },
    {
      id: "HERO-SMELL-stop-run-cobol",
      name: "CobolStopRun",
      languages: ["cobol"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: [],
      owasp: [],
      message: "STOP RUN encerra a run unit — em subprogramas/CICS prefira GOBACK.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      // ibmRef: StopRunRule
      pattern: {
        regex: "(?i)\\bSTOP\\s+RUN\\b",
      },
    },

    // --- Data division / legacy constructs ------------------------------------
    {
      id: "HERO-SMELL-level77-cobol",
      name: "CobolLevel77",
      languages: ["cobol"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: [],
      owasp: [],
      message: "Item nível 77 é legado — agrupe sob 01 WORKING-STORAGE.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      // ibmRef: NoLevel77Rule
      pattern: {
        regex: "(?i)^\\s{6,}77\\s+[\\w-]+",
      },
    },
    {
      id: "HERO-SMELL-occurs-depending-cobol",
      name: "CobolOccursDependingOn",
      languages: ["cobol"],
      severity: "MAJOR",
      type: "CODE_SMELL",
      remediationEffortMin: 25,
      cwe: ["CWE-119"],
      owasp: [],
      message: "OCCURS DEPENDING ON exige disciplina de limites — risco de overflow se o contador estiver errado.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      // ibmRef: OccursDependingOnRule
      pattern: {
        regex: "(?i)\\bOCCURS\\b[^\\.\\n]*\\bDEPENDING\\s+ON\\b",
      },
    },
    {
      id: "HERO-SMELL-redefines-cobol",
      name: "CobolRedefines",
      languages: ["cobol"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 15,
      cwe: [],
      owasp: [],
      message: "REDEFINES sobrepõe memória — documente o layout e evite se um grupo tipado basta.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      // ibmRef: RedefinesAvoidRule
      pattern: {
        regex: "(?i)\\bREDEFINES\\s+[\\w-]+",
      },
    },
    {
      id: "HERO-SMELL-occurs-one-cobol",
      name: "CobolOccursOne",
      languages: ["cobol"],
      severity: "INFO",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: [],
      owasp: [],
      message: "OCCURS 1 não agrega valor — remova a cláusula OCCURS.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      // ibmRef: DataOccursOneRule
      pattern: {
        regex: "(?i)\\bOCCURS\\s+1\\b(?!\\s*TO)",
      },
    },
    {
      id: "HERO-SMELL-move-corresponding-cobol",
      name: "CobolMoveCorresponding",
      languages: ["cobol"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 15,
      cwe: [],
      owasp: [],
      message: "MOVE CORRESPONDING é frágil a mudanças de nomes de campos — mova campos explicitamente.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      // ibmRef: CorrespondingRule
      pattern: {
        regex: "(?i)\\bMOVE\\s+CORR(ESPONDING)?\\b",
      },
    },

    // --- I/O, debug, hygiene --------------------------------------------------
    {
      id: "HERO-SMELL-accept-datetime-cobol",
      name: "CobolAcceptDateTime",
      languages: ["cobol"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: [],
      owasp: [],
      message: "ACCEPT FROM DATE/DAY/TIME — prefira função intrínseca (FUNCTION CURRENT-DATE) quando disponível.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      // ibmRef: AcceptDateTimeRule
      pattern: {
        regex: "(?i)\\bACCEPT\\b[^.\\n]*\\bFROM\\s+(DATE|DAY|TIME|DAY-OF-WEEK)\\b",
      },
    },
    {
      id: "HERO-SMELL-display-console-cobol",
      name: "CobolDisplayUponConsole",
      languages: ["cobol"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: [],
      owasp: [],
      message: "DISPLAY … UPON CONSOLE em produção polui operador e pode vazar dados.",
      sddTemplateId: "sdd.smell.remove-debug",
      category: "security-misconfiguration",
      // ibmRef: DisplayUponConsoleRule
      pattern: {
        regex: "(?i)\\bDISPLAY\\b[^.\\n]*\\bUPON\\s+CONSOLE\\b",
      },
    },
    {
      id: "HERO-SMELL-display-cobol",
      name: "CobolDisplay",
      languages: ["cobol"],
      severity: "INFO",
      type: "CODE_SMELL",
      remediationEffortMin: 2,
      cwe: [],
      owasp: [],
      message: "DISPLAY residual — remova ou substitua por logging controlado.",
      sddTemplateId: "sdd.smell.remove-debug",
      category: "security-misconfiguration",
      // ibmRef: NoDisplayRule
      pattern: {
        regex: "(?i)^\\s{6,}DISPLAY\\s+",
        unless: "(?i)UPON\\s+CONSOLE",
      },
    },
    {
      id: "HERO-SMELL-debug-mode-cobol",
      name: "CobolDebugFeatures",
      languages: ["cobol"],
      severity: "CRITICAL",
      type: "CODE_SMELL",
      remediationEffortMin: 15,
      cwe: [],
      owasp: [],
      message: "Recurso de debug em código (WITH DEBUGGING MODE / READY TRACE / EXHIBIT) — não leve a produção.",
      sddTemplateId: "sdd.smell.remove-debug",
      category: "security-misconfiguration",
      // ibmRef: DebugFeaturesInProdRule
      pattern: {
        regex: "(?i)(WITH\\s+DEBUGGING\\s+MODE|\\bREADY\\s+TRACE\\b|\\bRESET\\s+TRACE\\b|\\bEXHIBIT\\b)",
      },
    },
    {
      id: "HERO-SMELL-todo-cobol",
      name: "CobolTodoComment",
      languages: ["cobol"],
      severity: "INFO",
      type: "CODE_SMELL",
      remediationEffortMin: 5,
      cwe: [],
      owasp: [],
      message: "Comentário TODO/FIXME/HACK no fonte COBOL.",
      sddTemplateId: "sdd.smell.resolve-todo",
      category: "code-smell",
      // ibmRef: TrackTodoRule / TrackFixMeRule
      pattern: {
        scope: "comments",
        regex: "(?i)\\*(.*\\b(TODO|FIXME|HACK|XXX)\\b)",
      },
    },
    {
      id: "HERO-SMELL-sort-merge-cobol",
      name: "CobolSortOrMerge",
      languages: ["cobol"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 30,
      cwe: [],
      owasp: [],
      message: "SORT/MERGE embutido no programa — considere utilitário de sistema ou serviço dedicado.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      // ibmRef: FileSortAvoidRule / FileMergeAvoidRule
      pattern: {
        regex: "(?i)^\\s{6,}(SORT|MERGE)\\s+[\\w-]+",
      },
    },
    {
      id: "HERO-SMELL-xml-parse-cobol",
      name: "CobolXmlParse",
      languages: ["cobol"],
      severity: "MAJOR",
      type: "SECURITY_HOTSPOT",
      remediationEffortMin: 25,
      cwe: ["CWE-611"],
      owasp: ["A05:2021-Security Misconfiguration"],
      message: "XML PARSE — valide origem do XML e desabilite entidades externas quando possível (XXE).",
      sddTemplateId: "sdd.xxe.disable-external-entities",
      category: "xxe",
      // ibmRef: XMLParseRule
      pattern: {
        regex: "(?i)\\bXML\\s+PARSE\\b",
      },
    },
    {
      id: "HERO-SMELL-string-no-overflow-cobol",
      name: "CobolStringWithoutOverflow",
      languages: ["cobol"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: ["CWE-119"],
      owasp: [],
      message: "STRING sem ON OVERFLOW na mesma linha — truncamento silencioso possível.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      // ibmRef: StringNoTruncationRule (aprox. L0)
      pattern: {
        regex: "(?i)\\bSTRING\\b(?![^\\.\\n]*\\bON\\s+OVERFLOW\\b)",
        unless: "(?i)\\bEND-STRING\\b",
      },
    },
    {
      id: "HERO-SMELL-call-dynamic-cobol",
      name: "CobolDynamicCall",
      languages: ["cobol"],
      severity: "MAJOR",
      type: "SECURITY_HOTSPOT",
      remediationEffortMin: 20,
      cwe: ["CWE-94"],
      owasp: ["A03:2021-Injection"],
      message: "CALL com identificador (dinâmico) — prefira CALL literal ou valide a lista permitida de programas.",
      sddTemplateId: "sdd.generic.secure-fix",
      category: "security-misconfiguration",
      // ibmRef: StaticCallNameRule (inverso: flag dinâmico)
      pattern: {
        scope: "any",
        regex: "(?i)\\bCALL\\s+[\\w-]+(?![\\w-]*\\s*['\"])",
        unless: "(?i)\\bCALL\\s+['\"]",
      },
    },

    // --- CICS / SQL status hygiene (line-level) --------------------------------
    {
      id: "HERO-SMELL-cics-xctl-cobol",
      name: "CobolCicsXctl",
      languages: ["cobol"],
      severity: "INFO",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: [],
      owasp: [],
      message: "EXEC CICS XCTL transferindo controle — confirme tratamento de RESP e que não há código morto assumido.",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      pattern: {
        regex: "(?i)\\bEXEC\\s+CICS\\s+XCTL\\b",
      },
    },
    {
      id: "HERO-SMELL-cics-handle-cobol",
      name: "CobolCicsHandle",
      languages: ["cobol"],
      severity: "MINOR",
      type: "CODE_SMELL",
      remediationEffortMin: 15,
      cwe: [],
      owasp: [],
      message: "EXEC CICS HANDLE CONDITION — estilo legado; prefira RESP/RESP2 por comando (ibmRef: CicsNoHandleRule).",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      pattern: {
        regex: "(?i)\\bEXEC\\s+CICS\\s+HANDLE\\b",
      },
    },
    {
      id: "HERO-SMELL-exec-sql-no-sqlcode-hint-cobol",
      name: "CobolExecSqlNeedsStatusCheck",
      languages: ["cobol"],
      severity: "INFO",
      type: "CODE_SMELL",
      remediationEffortMin: 10,
      cwe: [],
      owasp: [],
      message: "EXEC SQL presente — garanta checagem de SQLCODE/SQLSTATE após o bloco (revisão manual se multi-linha).",
      sddTemplateId: "sdd.generic.smell",
      category: "code-smell",
      // ibmRef: CheckSqlcodeAfterExecSqlRule (hint only — true check needs CFG)
      pattern: {
        regex: "(?i)\\bEXEC\\s+SQL\\b",
        unless: "(?i)SQLCODE|SQLSTATE|SQLCA",
      },
    },
  ] as HeroRule[]
).map((r) => ({ ...r, implementation: "core" as const }));
