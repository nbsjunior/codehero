import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HeroRule } from "@codehero/contracts";
import type { EngineFinding } from "./types.ts";

export interface CacheEntry {
  contentHash: string;
  rulesHash: string;
  findings: EngineFinding[];
}

export function rulesetHash(rules: HeroRule[]): string {
  const payload = rules
    .map((r) =>
      [
        r.id,
        r.pattern.regex,
        r.pattern.unless ?? "",
        r.ast ? JSON.stringify(r.ast) : "",
        r.taint ? JSON.stringify(r.taint) : "",
      ].join("|"),
    )
    .sort()
    .join("\n");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export class ScanCache {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  static contentHash(source: string): string {
    return createHash("sha256").update(source).digest("hex");
  }

  private keyPath(file: string): string {
    const h = createHash("sha256").update(file).digest("hex").slice(0, 24);
    return join(this.dir, `${h}.json`);
  }

  get(file: string, source: string, rulesHash: string): EngineFinding[] | null {
    const path = this.keyPath(file);
    if (!existsSync(path)) return null;
    try {
      const entry = JSON.parse(readFileSync(path, "utf8")) as CacheEntry;
      if (entry.contentHash !== ScanCache.contentHash(source)) return null;
      if (entry.rulesHash !== rulesHash) return null;
      return entry.findings;
    } catch {
      return null;
    }
  }

  set(file: string, source: string, rulesHash: string, findings: EngineFinding[]): void {
    const path = this.keyPath(file);
    const entry: CacheEntry = {
      contentHash: ScanCache.contentHash(source),
      rulesHash,
      findings,
    };
    writeFileSync(path, JSON.stringify(entry));
  }
}
