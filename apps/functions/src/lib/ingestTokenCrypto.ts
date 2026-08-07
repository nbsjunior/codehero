import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** CI / MCP / scanner bearer — shown once from callables, never client-readable after. */
export function generateIngestToken(): string {
  return `chp_${randomBytes(24).toString("hex")}`;
}

export function hashIngestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function ingestTokenHint(token: string): string {
  return token.slice(-6);
}

export function safeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
