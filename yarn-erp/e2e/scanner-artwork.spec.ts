import { test, expect } from "@playwright/test";
import type { ScanResult } from "../src/scanner-client";
import { signIn } from "./helpers";

// Route fixtures must reach the test rather than the production offline worker.
test.use({ serviceWorkers: "block" });

test("model responses choose illustrations; abstentions ignore candidates and label claims", async ({ page }, testInfo) => {
  const head = (label: string) => ({ label, confidence: 0.93, topk: [[label, 0.93] as [string, number]] });
  let result: ScanResult = {
    scan_id: "artwork-fixture-1", verdict: "PASS", structure: head("velvet"),
    treatment: head("printed"), fibre_family: head("protein"),
    garment: { label: "dress", confidence: 0.91, box: [0.1, 0.1, 0.9, 0.9] },
    stated_composition: { source: null, fibers: [], ocr_confidence: null, section: null },
    flags: [], candidates: {}, custom: { mix: head("cotton:98,elastane_spandex:2") },
    capture_quality: { blur: 150, exposure: "normal", framing: "good" },
    model_version: "scanner-v6", kb_version: "v5", timestamp: new Date().toISOString(),
  };
  await page.route("**/api/v1/model", route => route.fulfill({ json: { ready: true, model_version: "scanner-v6", mode: "scanner" } }));
  await page.route("**/api/v1/scan", route => route.fulfill({ json: result }));
  await page.context().setExtraHTTPHeaders({ "x-yarnflow-test-user": "artwork-" + crypto.randomUUID() });
  // The scanner lives behind the shared PIN sign-in now.
  await signIn(page);
  await page.goto("/#/scanner");
  await page.locator("input[type=file]").first().setInputFiles("src/assets/fabrics/denim.webp");
  const analyze = page.getByRole("button", { name: "Analyze material", exact: true });
  await expect(analyze).toBeEnabled();
  await analyze.click();
  // Garment first, with its picture; then one row per composition answer.
  await expect(page.locator('.scan-garment-hero [data-artwork-kind="garment"]')).toHaveAttribute("data-artwork-id", "dress");
  await expect(page.locator(".scan-garment-hero h3")).toHaveText("Dress");
  const fabricArt = page.locator('.scan-rows [data-artwork-kind="structure"]');
  await expect(fabricArt).toHaveAttribute("data-artwork-id", "velvet");
  // Composition: the taught mix head's exact mix.
  await expect(page.locator(".scan-rows")).toContainText("98% Cotton · 2% Elastane (spandex)");
  await expect(page.locator(".scan-pct").first()).toHaveText("91%");
  await expect(page.locator('[data-artwork-kind="verdict"]')).toHaveAttribute("data-artwork-id", "pass");
  await fabricArt.scrollIntoViewIfNeeded();
  await expect.poll(() => fabricArt.locator("img").evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(fabricArt.locator("img")).toHaveCSS("animation-name", "scanner-art-float");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(fabricArt.locator("img")).toHaveCSS("animation-name", "none");
  await page.screenshot({ path: testInfo.outputPath("scanner-artwork.png"), fullPage: true });
  const layout = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth, viewport: innerWidth,
    overflow: [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag: el.tagName, class: el.className, right: el.getBoundingClientRect().right })).slice(0, 12),
  }));
  expect(layout.width <= layout.viewport, JSON.stringify(layout)).toBe(true);

  result = { ...result, scan_id: "artwork-fixture-2", verdict: "FLAG", structure: head("corduroy"),
    garment: { label: "pants", confidence: 0.95, box: [0, 0, 1, 1] } };
  await analyze.click();
  await expect(fabricArt).toHaveAttribute("data-artwork-id", "corduroy");
  await expect(page.locator('[data-artwork-kind="garment"]')).toHaveAttribute("data-artwork-id", "denim");
  await expect(page.locator('[data-artwork-kind="verdict"]')).toHaveAttribute("data-artwork-id", "flag");

  // Heads that abstained still show their top guess with its confidence, never "not sure"; the label's mix wins.
  result = { ...result, scan_id: "artwork-fixture-3", verdict: "INSUFFICIENT_EVIDENCE",
    structure: null, treatment: null, fibre_family: null, garment: null,
    candidates: { structure: [["denim", 0.49]], fibre_family: [["synthetic", 0.45]], garment_type: [["kurta", 0.6]] },
    stated_composition: { source: "care_label", fibers: [{ name: "cotton", pct: 100 }], ocr_confidence: 0.99, section: null },
    custom: { garment_type: null } };
  await analyze.click();
  await expect(page.locator(".scan-garment-hero h3")).toHaveText("Kurta");
  await expect(fabricArt).toHaveAttribute("data-artwork-id", "denim");
  await expect(page.locator(".scan-rows")).toContainText("49%");
  await expect(page.locator(".scan-rows")).toContainText("100% Cotton");
  await expect(page.locator(".scan-results")).not.toContainText(/not sure/i);
  await expect(page.locator('[data-artwork-kind="verdict"]')).toHaveCount(0);
});
