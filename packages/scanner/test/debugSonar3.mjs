import { RULES, matchPattern, lexicalProfileFor } from "@codehero/contracts";

// S1313 — IP hardcoded com lookbehind
const ip = RULES.find((r) => r.id === "SONAR-js-S1313");
console.log("S1313 regex:", ip.pattern.regex);
for (const t of ['const ip = "192.168.1.1";', '"10.0.0.1"', "x = 192.168.0.1"]) {
  const m = matchPattern(ip.pattern, t, { profile: "clike" });
  console.log(m.length > 0 ? "✅" : "❌", JSON.stringify(t), "| scope:", ip.pattern.scope ?? "code");
}

// S3330 — a regra procura httpOnly ausente? ou false explícito?
const ck = RULES.find((r) => r.id === "SONAR-js-S3330");
console.log("\nS3330 regex:", ck.pattern.regex);
console.log("  full:", JSON.stringify(ck.pattern));
for (const t of ['res.cookie("s", v, { httpOnly: false })', 'document.cookie = "s=" + v']) {
  const m = matchPattern(ck.pattern, t, { profile: "clike" });
  console.log(m.length > 0 ? "✅" : "❌", JSON.stringify(t));
}

// py-S2076 — regex é de JS?
const py = RULES.find((r) => r.id === "SONAR-py-S2076");
console.log("\npy-S2076 regex:", py.pattern.regex);
console.log("  languages:", py.languages);
