import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { FieldValue } from "firebase-admin/firestore";
import { isUnsafeRegex } from "@codehero/contracts";
import { db } from "./lib/firebase.ts";
import { requireOrgRole, requireVerifiedEmail } from "./lib/authz.ts";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

function wireGeminiKey(): void {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new HttpsError("failed-precondition", "GEMINI_API_KEY secret is empty");
  process.env.GOOGLE_GENAI_API_KEY = key;
  process.env.GOOGLE_API_KEY = key;
}

async function requirePlatformAdmin(uid: string): Promise<void> {
  const snap = await db.doc(`platformAdmins/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "not a platform admin");
}

async function requireOrgMember(uid: string, orgId: string): Promise<void> {
  const snap = await db.doc(`orgs/${orgId}/members/${uid}`).get();
  if (!snap.exists) {
    const admin = await db.doc(`platformAdmins/${uid}`).get();
    if (!admin.exists) throw new HttpsError("permission-denied", "not an org member");
  }
}

function toOverlayRule(
  draft: {
    idSlug: string;
    name: string;
    message: string;
    category: string;
    severity: string;
    languages: string[];
    patternRegex: string;
    patternUnless?: string;
  },
  dressCodeId: string,
) {
  return {
    id: `HERO-DRESS-${draft.idSlug}`,
    name: draft.name,
    message: draft.message,
    category: draft.category,
    severity: draft.severity,
    type: draft.category === "code-smell" ? "CODE_SMELL" : "VULNERABILITY",
    languages: draft.languages,
    remediationEffortMin: 10,
    cwe: [],
    owasp: [],
    sddTemplateId: "sdd.smell.remove-debug",
    pattern: {
      regex: draft.patternRegex,
      ...(draft.patternUnless ? { unless: draft.patternUnless } : {}),
    },
    dressCodeId,
    engine: "pattern" as const,
  };
}

export interface SubmitDressCodeInput {
  naturalLanguage: string;
  /** global = toda a plataforma; project = um repositório */
  scope: "global" | "project";
  orgId?: string;
  projectId?: string;
  /** se true, ativa imediatamente as regras overlay */
  activate?: boolean;
  /** se true, cria propostas pendentes na esteira (não ativa direto) */
  requireApproval?: boolean;
}

/**
 * One-click dress code: NL → Genkit → rascunho (e opcionalmente regras ativas).
 * Global exige platform admin; project exige membro da org (ou admin).
 */
export const submitDressCode = onCall(
  { secrets: [GEMINI_API_KEY], timeoutSeconds: 120, cors: true, invoker: "public", memory: "512MiB" },
  async (request) => {
    try {
      return await handleSubmitDressCode(request);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("submitDressCode failed", err);
      const msg = err instanceof Error ? err.message : String(err);
      // Prefer failed-precondition so the client receives the message (INTERNAL is stripped).
      throw new HttpsError(
        "failed-precondition",
        `Falha ao interpretar o dress code: ${msg.slice(0, 300)}`,
      );
    }
  },
);

async function handleSubmitDressCode(request: {
  auth?: { uid: string } | null;
  data: SubmitDressCodeInput;
}): Promise<Record<string, unknown>> {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
    await requireVerifiedEmail(uid);

    const data = request.data as SubmitDressCodeInput;
    const text = data?.naturalLanguage?.trim() ?? "";
    if (text.length < 8) throw new HttpsError("invalid-argument", "dress code text too short");
    if (text.length > 8000) throw new HttpsError("invalid-argument", "dress code text too long");

    const scope = data.scope === "project" ? "project" : "global";
    const requireApproval = !!data.requireApproval;
    const activate = !requireApproval && data.activate !== false;

    if (scope === "global") await requirePlatformAdmin(uid);
    else {
      if (!data.orgId || !data.projectId) {
        throw new HttpsError("invalid-argument", "orgId and projectId required for project scope");
      }
      // Draft / propose: any member. Activate overlays: owner|admin only.
      if (activate) await requireOrgRole(data.orgId, uid, ["owner", "admin"]);
      else await requireOrgMember(uid, data.orgId);
    }

    wireGeminiKey();
    const { interpretDressCode } = await import("./genkit/dressCodeFlow.ts");
    const proposal = await interpretDressCode(text);
    const dressCodeId = db.collection("_").doc().id;

    const safeRules = proposal.rules.filter(
      (r) => !isUnsafeRegex(r.patternRegex) && !(r.patternUnless && isUnsafeRegex(r.patternUnless)),
    );
    const unsafeCount = proposal.rules.length - safeRules.length;
    const overlays = safeRules.map((r) => toOverlayRule(r, dressCodeId));

    if (requireApproval) {
      const { enqueueNewRuleProposals } = await import("./ruleProposals.ts");
      const day = new Date().toISOString().slice(0, 10);
      const queued = await enqueueNewRuleProposals(
        overlays.map((r) => ({
          family: (r.category === "code-smell" ? "dress" : "security") as "dress" | "security" | "smell",
          title: `Dress code: ${r.name}`,
          rationale: proposal.summary,
          rule: {
            id: r.id,
            name: r.name,
            message: r.message,
            severity: r.severity as "BLOCKER" | "CRITICAL" | "MAJOR" | "MINOR" | "INFO",
            type: r.type as "VULNERABILITY" | "BUG" | "CODE_SMELL" | "SECURITY_HOTSPOT",
            category: r.category,
            languages: r.languages,
            pattern: r.pattern,
            remediationEffortMin: r.remediationEffortMin,
          },
          corpusCases: [],
          source: `dressCode:${dressCodeId}`,
          runDay: day,
          scope,
          orgId: scope === "project" ? data.orgId! : null,
          projectId: scope === "project" ? data.projectId! : null,
        })),
      );
      const dressPath =
        scope === "global" ? `dressCodes/${dressCodeId}` : `orgs/${data.orgId}/projects/${data.projectId}/dressCodes/${dressCodeId}`;
      await db.doc(dressPath).set({
        id: dressCodeId,
        naturalLanguage: text,
        scope,
        orgId: scope === "project" ? data.orgId! : null,
        projectId: scope === "project" ? data.projectId! : null,
        summary: proposal.summary,
        status: "pending_approval",
        proposedRules: overlays,
        proposalsQueued: queued,
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        dressCodeId,
        summary: proposal.summary,
        status: "pending_approval",
        scope,
        ruleCount: overlays.length,
        rules: overlays,
        unsafeRulesRejected: unsafeCount,
        proposalsQueued: queued,
      };
    }

    const doc = {
      id: dressCodeId,
      naturalLanguage: text,
      scope,
      orgId: scope === "project" ? data.orgId! : null,
      projectId: scope === "project" ? data.projectId! : null,
      summary: proposal.summary,
      status: activate ? "active" : "draft",
      proposedRules: overlays,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (scope === "global") {
      await db.doc(`dressCodes/${dressCodeId}`).set(doc);
      if (activate) {
        const batch = db.batch();
        for (const rule of overlays) {
          batch.set(db.doc(`platformDressRules/${rule.id}`), {
            ...rule,
            active: true,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
      }
    } else {
      const base = `orgs/${data.orgId}/projects/${data.projectId}`;
      await db.doc(`${base}/dressCodes/${dressCodeId}`).set(doc);
      if (activate) {
        const batch = db.batch();
        for (const rule of overlays) {
          batch.set(db.doc(`${base}/dressRules/${rule.id}`), {
            ...rule,
            active: true,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
      }
    }

    return {
      dressCodeId,
      summary: proposal.summary,
      status: activate ? "active" : "draft",
      scope,
      ruleCount: overlays.length,
      rules: overlays,
      unsafeRulesRejected: unsafeCount,
    };
}

/** Lista dress codes (global para admin; project para membro). */
export const listDressCodes = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "sign-in required");
  const { scope, orgId, projectId } = (request.data ?? {}) as {
    scope?: "global" | "project";
    orgId?: string;
    projectId?: string;
  };

  if (scope === "project") {
    if (!orgId || !projectId) throw new HttpsError("invalid-argument", "orgId/projectId required");
    await requireOrgMember(uid, orgId);
    const snap = await db.collection(`orgs/${orgId}/projects/${projectId}/dressCodes`).orderBy("createdAt", "desc").limit(50).get();
    return { items: snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.()?.toISOString?.() ?? null })) };
  }

  await requirePlatformAdmin(uid);
  const snap = await db.collection("dressCodes").orderBy("createdAt", "desc").limit(50).get();
  return { items: snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.()?.toISOString?.() ?? null })) };
});
