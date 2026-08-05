import assert from "node:assert/strict";
import { ruleFpRate, shouldSuppressInGate, DEFAULT_GATE_SUPPRESS } from "../dist/index.js";

const low = ruleFpRate(2, 3); // rate 0.4, n=5
assert.equal(shouldSuppressInGate(low), false, "rate abaixo do limiar");

const high = ruleFpRate(4, 1); // rate 0.8, n=5
assert.equal(shouldSuppressInGate(high), true, "FP alto com n≥5");

const few = ruleFpRate(10, 0); // rate 1, n=10 — wait n=10
assert.equal(few.n, 10);
assert.equal(shouldSuppressInGate(ruleFpRate(3, 0)), false, "n=3 < minFeedback");
assert.equal(shouldSuppressInGate(ruleFpRate(3, 0), { minFeedback: 3, minFpRate: 0.6 }), true);

assert.equal(DEFAULT_GATE_SUPPRESS.minFeedback, 5);
assert.equal(DEFAULT_GATE_SUPPRESS.minFpRate, 0.6);
console.log("gateSuppress ok");
