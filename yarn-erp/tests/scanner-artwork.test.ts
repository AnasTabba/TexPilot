import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import manifest from "../artwork/scanner-outcomes/manifest.json" with { type: "json" };
import { scannerArtworkId, type ArtworkKind } from "../src/scanner-artwork.ts";

test("every fixed scanner outcome maps to an existing deployable illustration", () => {
  const kinds: Record<string, ArtworkKind> = {
    Fabric: "structure", "Fibre family": "fibre_family", Treatment: "treatment",
    Garment: "garment", Verification: "verdict",
  };
  for (const [group, kind] of Object.entries(kinds)) {
    const mapping = manifest.groups[group as keyof typeof manifest.groups];
    for (const [label, expected] of Object.entries(mapping)) {
      assert.equal(scannerArtworkId(kind, label), expected);
      assert.ok(existsSync(new URL(`../artwork/scanner-outcomes/still/${expected}.webp`, import.meta.url)));
    }
  }
});

test("abstentions and unknown or mismatched labels never borrow a confident illustration", () => {
  for (const kind of ["structure", "treatment", "fibre_family", "garment", "verdict"] as const) {
    for (const label of [null, undefined, "", "new_factory_label", "constructor", "__proto__"]) {
      assert.equal(scannerArtworkId(kind, label), "uncertain");
    }
  }
  assert.equal(scannerArtworkId("fibre_family", "cotton"), "uncertain");
  assert.equal(scannerArtworkId("structure", "polyester"), "uncertain");
  assert.equal(scannerArtworkId("structure", "PASS"), "uncertain");
  assert.equal(scannerArtworkId("garment", "pants"), "denim");
  assert.equal(scannerArtworkId("verdict", "INSUFFICIENT_EVIDENCE"), "insufficient_evidence");
});
