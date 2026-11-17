import { test, expect } from "@playwright/test";
import type { ScanResult } from "../src/scanner-client";
import { signIn } from "./helpers";

// Route fixtures must reach the test rather than the production offline worker.
test.use({ serviceWorkers: "block" });

// 1x1 PNG: the fault map is whatever the scanner sends; the screen only has to show it.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("the fault check shows fault, no fault, not run and nothing at all, without overflow", async ({ page }, testInfo) => {
  const head = (label: string) => ({ label, confidence: 0.93, topk: [[label, 0.93] as [string, number]] });
  const base: ScanResult = {
    scan_id: "fault-fixture", verdict: "INSUFFICIENT_EVIDENCE", structure: head("denim"), treatment: null, fibre_family: null,
    garment: { label: "pants", confidence: 0.9, box: [0.1, 0.1, 0.9, 0.9] },
    stated_composition: { source: null, fibers: [], ocr_confidence: null, section: null },
    flags: [], candidates: {}, custom: {}, capture_quality: { blur: 150, exposure: "normal", framing: "good" },
    model_version: "scanner-v8+fault=fault-wfdd-v1", kb_version: "v5", timestamp: new Date().toISOString(),
  };
  const fault = { score: 0.612, is_fault: true, threshold: 0.4, heatmap_png_b64: PNG, model_version: "fault-wfdd-v1", skipped_reason: null };
  let result: ScanResult = { ...base, fault };
  await page.route("**/api/v1/model", route => route.fulfill({ json: { ready: true, model_version: base.model_version, mode: "scanner" } }));
  await page.route("**/api/v1/scan", route => route.fulfill({ json: result }));
  await page.context().setExtraHTTPHeaders({ "x-yarnflow-test-user": "fault-" + crypto.randomUUID() });
  await signIn(page, "Qasim");
  await page.goto("/#/scanner");
  await page.locator("input[type=file]").first().setInputFiles("src/assets/fabrics/denim.webp");
  const analyze = page.getByRole("button", { name: "Analyze material", exact: true });
  const block = page.locator(".scan-fault");

  await analyze.click();
  await expect(block).toContainText("Possible fabric fault");
  await expect(page.locator(".scan-details")).toContainText("0.612 · limit 0.400");
  await expect(block).toHaveClass(/flag/);
  await expect.poll(() => block.getByRole("img", { name: "Fault heat map" }).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await block.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("scanner-fault.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  result = { ...base, fault: { ...fault, score: 0.2, is_fault: false } };
  await analyze.click();
  await expect(block).toContainText("No fabric fault found");
  await expect(block).toHaveClass(/pass/);

  result = { ...base, fault: { ...fault, score: 0, is_fault: false, heatmap_png_b64: null, skipped_reason: "garment too small for a close-up fault check" } };
  await analyze.click();
  await expect(block).toHaveCount(0); // a skipped check shows nothing

  result = { ...base, fault: null }; // a scanner serving no fault model
  await analyze.click();
  await expect(page.locator(".scan-rows")).toBeVisible();
  await expect(block).toHaveCount(0);
});
