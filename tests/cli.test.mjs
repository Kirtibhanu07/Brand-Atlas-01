import test from "node:test";
import assert from "node:assert/strict";
import { mergeCandidates } from "../src/records.mjs";

const record = (name, confidence, reviewRequired, sha256) => ({
  name,
  nameSource: reviewRequired ? "asset filename" : "alt text",
  confidence,
  reviewRequired,
  relationship: "Sponsor",
  section: "Official sponsors",
  brandUrl: "",
  sourcePage: "https://club.example/",
  sourceUrl: `https://cdn.example/${name}.png`,
  evidence: "Official sponsors",
  logo: { sha256, path: `logos/${name}.png`, previewPath: `previews/${name}.png` },
});

test("deduplicates one logo asset and keeps the strongest brand name", () => {
  const brands = mergeCandidates([
    record("Image 17", 0.45, true, "same-image"),
    record("Acme Sports", 0.96, false, "same-image"),
  ]);

  assert.equal(brands.length, 1);
  assert.equal(brands[0].name, "Acme Sports");
  assert.equal(brands[0].reviewRequired, false);
  assert.equal(brands[0].logos.length, 1);
  assert.equal(brands[0].evidence.length, 2);
});
