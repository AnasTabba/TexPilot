import { test, expect } from "@playwright/test";
import type { ScanResult } from "../src/scanner-client";

// Route fixtures must reach the test rather than the production offline worker.
test.use({ serviceWorkers: "block" });

test("model responses choose illustrations; abstentions ignore candidates and label claims", async ({ page }, testInfo) => {
  const head = (label: string) => ({ label, confidence: 0.93, topk: [[label, 0.93] as [string, number]] });
  let result: ScanResult = {
    scan_id: "artwork-fixture-1", verdict: "PASS", structure: head("velvet"),
    treatment: head("printed"), fibre_family: head("protein"),
    garment: { label: "dress", confidence: 0.91, box: [0.1, 0.1, 0.9, 0.9] },
    stated_composition: { source: null, fibers: [], ocr_confidence: null, section: null },
    flags: [], candidates: {}, custom: {},
    capture_quality: { blur: 150, exposure: "normal", framing: "good" },
    model_version: "scanner-v6", kb_version: "v5", timestamp: new Date().toISOString(),
  };
  await page.route("**/api/v1/model", route => route.fulfill({ json: { ready: true, model_version: "scanner-v6", mode: "scanner" } }));
  await page.route("**/api/v1/scan", route => route.fulfill({ json: result }));
  await page.context().setExtraHTTPHeaders({ "x-yarnflow-test-user": "artwork-" + crypto.randomUUID() });
  await page.goto("/");
  await page.getByLabel("Workspace name").fill("Scanner artwork test");
  await page.getByRole("form", { name: "Start your shared workspace" }).getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Stock", exact: true })).toBeVisible();
  await page.goto("/#/scanner");
  await page.getByRole("button", { name: "Fabric inspection", exact: true }).click();
  await page.locator("input[type=file]").first().setInputFiles("src/assets/fabrics/denim.webp");
  const analyze = page.getByRole("button", { name: "Analyze material", exact: true });
  await expect(analyze).toBeEnabled();
  await analyze.click();
  const mainArt = page.locator(".scan-fabric-illustration .scanner-artwork");
  await expect(mainArt).toHaveAttribute("data-artwork-id", "velvet");
  for (const [kind, id] of [["treatment", "printed"], ["fibre_family", "protein"], ["garment", "dress"], ["verdict", "pass"]]) {
    await expect(page.locator(`[data-artwork-kind="${kind}"]`)).toHaveAttribute("data-artwork-id", id);
  }
  await expect(page.locator(".scan-seen img")).toBeVisible();
  await expect(page.locator(".scan-seen-box")).toContainText("dress");
  await expect(page.locator(".scan-confidence").first()).toContainText("93");
  await mainArt.scrollIntoViewIfNeeded();
  await expect.poll(() => mainArt.locator("img").evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(mainArt.locator("img")).toHaveCSS("animation-name", "scanner-art-float");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(mainArt.locator("img")).toHaveCSS("animation-name", "none");
  await page.screenshot({ path: testInfo.outputPath("scanner-artwork.png"), fullPage: true });
  const layout = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth, viewport: innerWidth,
    overflow: [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag: el.tagName, class: el.className, right: el.getBoundingClientRect().right })).slice(0, 12),
  }));
  expect(layout.width <= layout.viewport, JSON.stringify(layout)).toBe(true);

  result = { ...result, scan_id: "artwork-fixture-2", verdict: "FLAG", structure: head("corduroy"),
    garment: { label: "pants", confidence: 0.95, box: [0, 0, 1, 1] } };
  await analyze.click();
  await expect(mainArt).toHaveAttribute("data-artwork-id", "corduroy");
  await expect(page.locator('[data-artwork-kind="garment"]')).toHaveAttribute("data-artwork-id", "denim");
  await expect(page.locator('[data-artwork-kind="verdict"]')).toHaveAttribute("data-artwork-id", "flag");

  result = { ...result, scan_id: "artwork-fixture-3", verdict: "INSUFFICIENT_EVIDENCE",
    structure: null, treatment: null, fibre_family: null, garment: null,
    candidates: { structure: [["denim", 0.49]], fibre_family: [["synthetic", 0.45]] },
    stated_composition: { source: "care_label", fibers: [{ name: "cotton", pct: 100 }], ocr_confidence: 0.99, section: null },
    custom: { wash: head("velvet") } };
  await analyze.click();
  await expect(mainArt).toHaveAttribute("data-artwork-id", "uncertain");
  await expect(page.locator('.scan-predictions [data-artwork-id="uncertain"]')).toHaveCount(3);
  await expect(page.locator('[data-artwork-kind="verdict"]')).toHaveAttribute("data-artwork-id", "insufficient_evidence");
  await expect(page.locator('[data-artwork-kind="garment"]')).toHaveCount(0);
  await expect(page.locator('.scan-predictions [data-artwork-id="velvet"]')).toHaveCount(0);
  await expect(page.locator(".scan-answer")).toContainText("100% Cotton");
});
