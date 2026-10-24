import { launchBrowser } from "./browser.mjs";
import { expect } from "@playwright/test";
import fs from "node:fs";
const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
await page.goto("http://localhost:5174/#/overview");
expect(await page.locator(".bar-quantity").allTextContents()).toEqual([
  "2,847",
]);
await page.evaluate(async () => {
  const domain = await import("/src/domain.ts");
  const date = new Date(domain.today() + "T12:00:00+05:00");
  date.setUTCDate(date.getUTCDate() - 1);
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
  }).format(date);
  const entry = domain.createEntry(
    {
      kind: "production",
      lot: "1221",
      grams: 123456,
      cartons: 1,
      cones: 24,
      machine: "1A",
      notes: "Browser test fixture only",
      shift: "A",
      date: day,
    },
    "qa-recorded-history",
  );
  localStorage.setItem(
    "yf-entries-v1",
    JSON.stringify(domain.appendEntry(domain.seedEntries(), entry)),
  );
});
await page.reload();
await expect(page.locator(".bar-quantity")).toHaveCount(2);
expect(await page.locator(".bar-quantity").allTextContents()).toEqual([
  "123",
  "2,847",
]);
await page.evaluate(async () => {
  const domain = await import("/src/domain.ts");
  const entries = JSON.parse(localStorage.getItem("yf-entries-v1"));
  localStorage.setItem(
    "yf-entries-v1",
    JSON.stringify(
      domain.reverseEntry(
        entries,
        entries.find((e) => e.id === "qa-recorded-history"),
        "Test reversal",
      ),
    ),
  );
});
await page.reload();
await expect(page.locator(".bar-quantity")).toHaveCount(1);
expect(await page.locator(".bar-quantity").allTextContents()).toEqual([
  "2,847",
]);
const result = {
  checks: [
    "No fabricated history is added to the practice ledger",
    "A real dated production fixture appears on its day",
    "Reversing that production removes it from the chart",
  ],
  passed: true,
};
fs.writeFileSync(
  "docs/progress/polish/history-check.json",
  JSON.stringify(result, null, 2),
);
console.log(result);
await context.close();
await browser.close();
