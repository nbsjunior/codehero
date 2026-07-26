import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import "./lib/firebase.ts"; // ensure Admin app is initialized

/**
 * Public one-click signup. Creates the Auth user with Admin SDK and returns a
 * custom token so the web client can sign in even when the Email/Password
 * provider is disabled in the Firebase Console (common shared-project footgun).
 */
export const registerAccount = onCall({ cors: true }, async (request) => {
  if (request.auth?.uid) {
    throw new HttpsError("already-exists", "Você já está autenticado.");
  }

  const email = String(request.data?.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(request.data?.password ?? "");
  const displayName = String(request.data?.displayName ?? "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "Email inválido.");
  }
  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "A senha precisa ter pelo menos 6 caracteres.");
  }
  if (password.length > 128) {
    throw new HttpsError("invalid-argument", "Senha muito longa.");
  }

  const auth = getAuth();
  try {
    const user = await auth.createUser({
      email,
      password,
      emailVerified: false,
      displayName: displayName || undefined,
    });
    const customToken = await auth.createCustomToken(user.uid, { registeredVia: "codehero-portal" });
    return { uid: user.uid, customToken };
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Já existe uma conta com esse email — use Entrar.");
    }
    if (code === "auth/invalid-password" || code === "auth/weak-password") {
      throw new HttpsError("invalid-argument", "A senha precisa ter pelo menos 6 caracteres.");
    }
    console.error("registerAccount failed", err);
    throw new HttpsError("internal", "Não foi possível criar a conta. Tente de novo.");
  }
});
