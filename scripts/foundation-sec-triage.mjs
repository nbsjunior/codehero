#!/usr/bin/env node
/**
 * Offline triage batch (Presence Fase 4) — Foundation-Sec / OpenAI-compatible LLM.
 *
 * NEVER runs on the PR hot path. Reads a SARIF (or findings JSON), optionally
 * calls an OpenAI-compatible endpoint (Ollama / llama.cpp / Foundation-Sec),
 * and writes triage scores for UI / fp-ranker features.
 *
 * Usage:
 *   node scripts/foundation-sec-triage.mjs --sarif codehero.sarif --out triage.json
 *   node scripts/foundation-sec-triage.mjs --sarif codehero.sarif --llm-url http://127.0.0.1:11434/v1 --model foundation-sec
 *
 * Without --llm-url: heuristic triage (severity + path heuristics) — still useful
 * to exercise the pipeline offline.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const opts = {
    sarif: null,
    out: "triage.json",
    llmUrl: null,
    model: "foundation-sec",
    limit: 40,
    mergeSarif: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sarif") opts.sarif = argv[++i];
    else if (a === "--out") opts.out = argv[++i] ?? opts.out;
    else if (a === "--llm-url") opts.llmUrl = argv[++i];
    else if (a === "--model") opts.model = argv[++i] ?? opts.model;
    else if (a === "--limit") opts.limit = parseInt(argv[++i] ?? "40", 10);
    else if (a === "--merge-sarif") opts.mergeSarif = argv[++i] ?? null;
  }
  return opts;
}

function loadFindings(sarifPath) {
  const sarif = JSON.parse(readFileSync(resolve(sarifPath), "utf8"));
  const results = sarif.runs?.[0]?.results ?? [];
  return results.map((r, i) => {
    const loc = r.locations?.[0]?.physicalLocation;
    return {
      id: r.partialFingerprints?.["heroHash/v1"] ?? `r-${i}`,
      ruleId: r.ruleId ?? "?",
      message: r.message?.text ?? "",
      severity: r.properties?.severity ?? r.level ?? "MAJOR",
      file: loc?.artifactLocation?.uri ?? "?",
      line: loc?.region?.startLine ?? 0,
      snippet: r.properties?.snippet ?? "",
      tool: r.properties?.tool ?? (String(r.ruleId || "").startsWith("EXT:") ? String(r.ruleId).split(":")[1] : "codehero"),
    };
  });
}

function heuristicScore(f) {
  let score = 0.55;
  const sev = String(f.severity).toUpperCase();
  if (sev === "BLOCKER" || sev === "CRITICAL" || sev === "error") score += 0.25;
  else if (sev === "MAJOR" || sev === "warning") score += 0.1;
  else score -= 0.1;
  if (/test|spec|mock|fixture|__tests__/i.test(f.file)) score -= 0.35;
  if (/node_modules|dist\/|build\//i.test(f.file)) score -= 0.4;
  if (/EXT:(trivy|osv|grype)/i.test(f.ruleId) || /CVE-|GHSA-/i.test(f.message)) score += 0.15;
  if (/TODO|FIXME|console\.log/i.test(f.message) && /test/i.test(f.file)) score -= 0.2;
  return Math.max(0, Math.min(1, score));
}

async function llmScore(f, llmUrl, model) {
  const prompt = [
    "You are a SAST triage assistant. Score how likely this finding is a TRUE POSITIVE (0.0–1.0).",
    "Reply with ONLY a JSON object: {\"score\": number, \"reason\": string}",
    `rule=${f.ruleId}`,
    `severity=${f.severity}`,
    `file=${f.file}:${f.line}`,
    `message=${f.message}`,
    `snippet=${(f.snippet || "").slice(0, 400)}`,
  ].join("\n");
  const res = await fetch(`${llmUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: "Security triage. JSON only." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON in LLM reply");
  const parsed = JSON.parse(m[0]);
  return {
    score: Math.max(0, Math.min(1, Number(parsed.score) || 0)),
    reason: String(parsed.reason ?? ""),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.sarif) {
    console.error(
      "usage: node scripts/foundation-sec-triage.mjs --sarif <file> [--out triage.json] [--merge-sarif out.sarif] [--llm-url URL] [--model name]",
    );
    process.exit(1);
  }
  const findings = loadFindings(opts.sarif).slice(0, opts.limit);
  const out = [];
  for (const f of findings) {
    let score = heuristicScore(f);
    let reason = "heuristic";
    let mode = "heuristic";
    if (opts.llmUrl) {
      try {
        const r = await llmScore(f, opts.llmUrl, opts.model);
        score = r.score;
        reason = r.reason;
        mode = "llm";
      } catch (err) {
        reason = `llm-fallback: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    out.push({
      ...f,
      triageScore: score,
      triageReason: reason,
      triageMode: mode,
      likelyTruePositive: score >= 0.55,
    });
  }
  writeFileSync(resolve(opts.out), JSON.stringify({ generatedAt: new Date().toISOString(), findings: out }, null, 2));
  const tp = out.filter((x) => x.likelyTruePositive).length;
  console.log(`triage → ${opts.out} (${out.length} findings, ${tp} likely TP, mode=${opts.llmUrl ? "llm+heuristic" : "heuristic"})`);

  if (opts.mergeSarif) {
    const sarif = JSON.parse(readFileSync(resolve(opts.sarif), "utf8"));
    const byId = new Map(out.map((f) => [f.id, f]));
    for (const r of sarif.runs?.[0]?.results ?? []) {
      const id = r.partialFingerprints?.["heroHash/v1"];
      const t = (id && byId.get(id)) || byId.get(`r-${sarif.runs[0].results.indexOf(r)}`);
      if (!t) continue;
      r.properties = r.properties ?? {};
      r.properties.triageScore = t.triageScore;
      r.properties.likelyTruePositive = t.likelyTruePositive;
      r.properties.triageReason = t.triageReason;
      r.properties.triageMode = t.triageMode;
    }
    writeFileSync(resolve(opts.mergeSarif), JSON.stringify(sarif, null, 2));
    console.log(`merged SARIF → ${opts.mergeSarif}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
