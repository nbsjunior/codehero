import assert from "node:assert/strict";
import {
  evaluateQualityGate,
  maintainabilityRating,
  technicalDebtRatio,
  DEFAULT_QUALITY_GATE,
} from "../dist/index.js";

// SQALE: 5% → A, >5% → B
assert.equal(maintainabilityRating(0.05), "A");
assert.equal(maintainabilityRating(0.0500001), "B");
assert.equal(maintainabilityRating(technicalDebtRatio(1500, 1000)), "A"); // 1500/(1000*30)=0.05
assert.equal(maintainabilityRating(technicalDebtRatio(1501, 1000)), "B");

const pass = evaluateQualityGate({
  newCodeCoverage: 90,
  newCodeDuplication: 1,
  newBlockerIssues: 0,
  securityRating: "A",
  maintainabilityRating: "A",
});
assert.equal(pass.status, "PASSED");
assert.deepEqual(pass.failedConditions, []);

const failCov = evaluateQualityGate({
  newCodeCoverage: 50,
  newCodeDuplication: null,
  newBlockerIssues: 0,
  securityRating: "A",
  maintainabilityRating: "A",
});
assert.equal(failCov.status, "FAILED");
assert.match(failCov.failedConditions[0], /^Cobertura 50%/);
assert.doesNotMatch(failCov.failedConditions[0], /código novo/i);

const skipNull = evaluateQualityGate({
  newCodeCoverage: null,
  newCodeDuplication: null,
  newBlockerIssues: 0,
  securityRating: "A",
  maintainabilityRating: "A",
});
assert.equal(skipNull.status, "PASSED", "null cobertura/dupe pula a condição");

assert.equal(DEFAULT_QUALITY_GATE.minNewCodeCoverage, 80);
assert.equal(DEFAULT_QUALITY_GATE.maxNewCodeDuplication, 3);
console.log("qualityGate ok");
