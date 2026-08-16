import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeAnalysisSummary } from "../src/lib/analysisSummary.ts";

function smell(fp, effort = 60, severity = "MAJOR") {
  return {
    ruleId: "HERO-smell",
    message: { text: "smell" },
    partialFingerprints: { "heroHash/v1": fp },
    properties: {
      severity,
      issueType: "CODE_SMELL",
      remediationEffortMin: effort,
    },
  };
}

function vuln(fp, severity = "CRITICAL") {
  return {
    ruleId: "HERO-vuln",
    message: { text: "vuln" },
    partialFingerprints: { "heroHash/v1": fp },
    properties: { severity, issueType: "VULNERABILITY" },
  };
}

function blocker(fp) {
  return {
    ruleId: "HERO-block",
    message: { text: "block" },
    partialFingerprints: { "heroHash/v1": fp },
    properties: { severity: "BLOCKER", issueType: "BUG" },
  };
}

describe("computeAnalysisSummary — escopo código novo", () => {
  it("sem fingerprints: blockers existentes reprovam o gate", () => {
    const summary = computeAnalysisSummary([blocker("b1"), smell("s1", 0)], 1000, []);
    assert.equal(summary.qualityGate.status, "FAILED");
    assert.ok(summary.qualityGate.failedConditions.some((c) => /Blocker/i.test(c)));
  });

  it("com fingerprints: só blockers no diff contam", () => {
    const summary = computeAnalysisSummary(
      [blocker("old"), blocker("new"), smell("s1", 0)],
      1000,
      ["new"],
    );
    assert.equal(summary.qualityGate.status, "FAILED");
    // exatamente 1 blocker no escopo new
    assert.ok(summary.qualityGate.failedConditions.some((c) => /Blocker issues 1/.test(c)));
  });

  it("PR sem smells novos NÃO zera a dívida overall do inventário", () => {
    const results = [smell("old-debt", 3000), smell("pr-clean", 0)];
    const withScope = computeAnalysisSummary(results, 1000, ["pr-clean"]);
    const overall = computeAnalysisSummary(results, 1000, []);
    assert.equal(withScope.debtMinutes, overall.debtMinutes);
    assert.equal(withScope.debtMinutes, 3000);
    assert.equal(withScope.maintainabilityRating, overall.maintainabilityRating);
  });

  it("securityRating persistido é overall; gate pode usar só new-code", () => {
    const results = [vuln("old-crit", "CRITICAL"), smell("n1", 0)];
    const summary = computeAnalysisSummary(results, 1000, ["n1"]);
    // Dashboard: ainda há CRITICAL no inventário
    assert.equal(summary.securityRating, "D");
    // Gate new-code: sem vuln no diff → security A; maint pode falhar por dívida overall
    assert.ok(
      !summary.qualityGate.failedConditions.some((c) => /Security rating/.test(c)),
      `não deveria falhar security no new-code: ${summary.qualityGate.failedConditions.join("; ")}`,
    );
  });

  it("gateSuppressed não conta no blocker nem na dívida", () => {
    const r = blocker("b1");
    r.properties.gateSuppressed = true;
    const smellSup = smell("s1", 9000);
    smellSup.properties.gateSuppressed = true;
    const summary = computeAnalysisSummary([r, smellSup], 1000, []);
    assert.equal(summary.gateSuppressedCount, 2);
    assert.equal(summary.debtMinutes, 0);
    assert.ok(!summary.qualityGate.failedConditions.some((c) => /Blocker/i.test(c)));
  });
});
