import assert from "node:assert/strict";
import { test } from "node:test";
import { faultHeadline } from "../src/scan-fault-text.ts";

const base = { score: 0.4, is_fault: false, threshold: 0.5, heatmap_png_b64: null, model_version: "f", skipped_reason: null };

test("self-relative, no fault: asks for a look, never says no fault found", () => {
  const h = faultHeadline({ ...base, reference: "self_relative" });
  assert.equal(h?.tone, "check");
  assert.equal(h?.en, "Fabric unlike the fabrics the fault check learned. Marked spots are only unusual areas: check by eye.");
  assert.ok(!h?.en.includes("No fabric fault found"));
});

test("self-relative, fault: unusual area", () => {
  const h = faultHeadline({ ...base, is_fault: true, reference: "self_relative" });
  assert.equal(h?.tone, "check");
  assert.match(h!.en, /^Unusual area marked\. Fabric unlike the fabrics the fault check learned: check by eye\.$/);
});

test("trained or missing reference keeps today's wording", () => {
  for (const reference of ["trained", undefined, null] as const) {
    const ok = faultHeadline({ ...base, reference });
    assert.deepEqual([ok?.tone, ok?.en], ["pass", "No fabric fault found"]);
    const bad = faultHeadline({ ...base, is_fault: true, reference });
    assert.deepEqual([bad?.tone, bad?.en], ["flag", "Possible fabric fault: look at the marked area"]);
  }
});

test("skipped or missing fault hides the block", () => {
  assert.equal(faultHeadline({ ...base, skipped_reason: "garment too small" }), null);
  assert.equal(faultHeadline(null), null);
  assert.equal(faultHeadline(undefined), null);
});

test("every headline has Urdu", () => {
  for (const reference of ["trained", "self_relative", undefined] as const)
    for (const is_fault of [true, false]) assert.ok(faultHeadline({ ...base, is_fault, reference })!.ur.length > 0);
});

test("Urdu uses plain trade wording", () => {
  const all = ["trained", "self_relative"].flatMap((reference) => [true, false].map((is_fault) => faultHeadline({ ...base, is_fault, reference: reference as "trained" | "self_relative" })!.ur)).join(" ");
  assert.ok(!all.includes("جانچ سیکھی گئی"));
  assert.ok(all.includes("جانچنے والا ماڈل سکھایا گیا"));
});
