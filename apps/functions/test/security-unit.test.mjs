import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateIngestToken,
  hashIngestToken,
  ingestTokenHint,
  safeEqualStr,
} from "../src/lib/ingestTokenCrypto.ts";
import { parseGithubUrl } from "../src/lib/githubUrl.ts";

describe("ingestTokenCrypto", () => {
  it("generateIngestToken has chp_ prefix and enough entropy", () => {
    const t = generateIngestToken();
    assert.match(t, /^chp_[a-f0-9]{48}$/);
    assert.notEqual(generateIngestToken(), t);
  });

  it("hashIngestToken is stable sha256 hex", () => {
    const t = "chp_abc";
    const h = hashIngestToken(t);
    assert.equal(h.length, 64);
    assert.equal(h, hashIngestToken(t));
    assert.notEqual(h, hashIngestToken("chp_abd"));
  });

  it("ingestTokenHint is last 6 chars", () => {
    assert.equal(ingestTokenHint("chp_1234567890abcdef"), "abcdef");
  });

  it("safeEqualStr is length-safe", () => {
    assert.equal(safeEqualStr("same", "same"), true);
    assert.equal(safeEqualStr("same", "diff"), false);
    assert.equal(safeEqualStr("short", "longer"), false);
  });
});

describe("parseGithubUrl", () => {
  it("parses owner/repo and default branch", () => {
    assert.deepEqual(parseGithubUrl("https://github.com/acme/app"), {
      owner: "acme",
      repo: "app",
      branch: "main",
    });
  });

  it("parses .git suffix and /tree/branch", () => {
    assert.deepEqual(parseGithubUrl("https://github.com/acme/app.git"), {
      owner: "acme",
      repo: "app",
      branch: "main",
    });
    assert.deepEqual(parseGithubUrl("https://github.com/acme/app/tree/develop"), {
      owner: "acme",
      repo: "app",
      branch: "develop",
    });
  });

  it("rejects non-GitHub URLs", () => {
    assert.equal(parseGithubUrl("https://gitlab.com/acme/app"), null);
    assert.equal(parseGithubUrl("not-a-url"), null);
    assert.equal(parseGithubUrl(""), null);
  });
});
