import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { FieldValue } from "firebase-admin/firestore";
import { interpretDressCode, type DressCodeDraftRule } from "./genkit/dressCodeFlow.ts";
import { db } from "./lib/firebase.ts";

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

function toOverlayRule(draft: DressCodeDraftRule, dressCodeId: string) {
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
}

/**
 * One-click dress code: NL → Genkit → rascunho (e opcionalmente regras ativas).
 * Global exige platform admin; project exige membro da org (ou admin).
 */
export const submitDressCode = onCall(
  { secrets: [GEMINI_API_KEY], timeoutSeconds: 120 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "sign-in required");

    const data = request.data as SubmitDressCodeInput;
    const text = data?.naturalLanguage?.trim() ?? "";
    if (text.length < 8) throw new HttpsError("invalid-argument", "dress code text too short");
    if (text.length > 8000) throw new HttpsError("invalid-argument", "dress code text too long");

    const scope = data.scope === "project" ? "project" : "global";
    if (scope === "global") await requirePlatformAdmin(uid);
    else {
      if (!data.orgId || !data.projectId) {
        throw new HttpsError("invalid-argument", "orgId and projectId required for project scope");
      }
      await requireOrgMember(uid, data.orgId);
    }

    wireGeminiKey();
    const proposal = await interpretDressCode(text);
    const dressCodeId = db.collection("_").doc().id;
    const activate = data.activate !== false;
    const overlays = proposal.rules.map((r) => toOverlayRule(r, dressCodeId));

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
    };
  },
);

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
