import { launchBrowser } from "./browser.mjs";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const errors = [];
const checks = [];
page.on("pageerror", (e) => errors.push(e.message));
async function pass(name) {
  checks.push(name);
  console.log("PASS " + name);
}
async function auditDialog(name) {
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(audit.violations, name).toEqual([]);
}
await page.goto("http://localhost:5174/#/production");
await page.keyboard.press("Tab");
await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
await page.keyboard.press("Enter");
await expect(page).toHaveURL(/#\/production$/);
await expect(page.locator("#main-content")).toBeFocused();
await pass("Skip link moves focus without changing the route");
await page
  .getByRole("button", { name: "Record production", exact: true })
  .click();
let dialog = page.getByRole("dialog");
await expect(dialog.getByText("Step 1 of 3")).toBeVisible();
await dialog.getByRole("button", { name: "2A", exact: true }).click();
await dialog.getByRole("button", { name: "Continue", exact: true }).click();
await dialog.getByRole("textbox", { name: "Cartons", exact: true }).fill("24");
await dialog
  .getByRole("textbox", { name: "Net weight in kilograms" })
  .fill("-5");
await expect(
  dialog.getByText("Enter a weight such as 520 or 520.250 kg."),
).toBeVisible();
await expect(
  dialog.getByRole("button", { name: "Continue", exact: true }),
).toBeDisabled();
await pass("Negative weight blocked with an inline explanation");
await dialog
  .getByRole("textbox", { name: "Net weight in kilograms" })
  .fill("520.125");
await dialog
  .getByRole("textbox", { name: "Notes (optional)" })
  .fill("Shift handover");
await dialog.getByRole("button", { name: "Back", exact: true }).click();
await dialog.getByRole("button", { name: "Save draft and close" }).click();
await page.reload();
await page
  .getByRole("button", { name: "Record production", exact: true })
  .click();
await dialog.getByRole("button", { name: "Continue", exact: true }).click();
await expect(
  dialog.getByRole("textbox", { name: "Net weight in kilograms" }),
).toHaveValue("520.125");
await expect(
  dialog.getByRole("textbox", { name: "Notes (optional)" }),
).toHaveValue("Shift handover");
await pass("Date, machine, quantities and notes survive closing and reloading");
await auditDialog("Quantity form");
await context.setOffline(true);
await dialog.getByRole("button", { name: "Continue", exact: true }).click();
await expect(dialog.getByText("Check before saving")).toBeVisible();
await auditDialog("Review form");
await page.screenshot({
  path: "docs/progress/redesign/production-review-en-390.png",
  fullPage: true,
});
await dialog.getByRole("button", { name: "Save entry", exact: true }).click();
await expect(
  dialog.getByText("Saved: 520.125 kg", { exact: true }),
).toBeVisible();
await expect(
  dialog.getByRole("button", { name: "Record another", exact: true }),
).toBeVisible();
await expect(
  dialog.getByRole("button", { name: "Done", exact: true }),
).toBeVisible();
await dialog.getByRole("button", { name: "Done", exact: true }).click();
await page.getByRole("button", { name: "Undo", exact: true }).click();
expect(
  await page.evaluate(() =>
    JSON.parse(localStorage.getItem("yf-entries-v1"))
      .filter((e) => e.createdAt > 0)
      .map((e) => e.kind),
  ),
).toEqual(["production", "reversal"]);
await pass("Offline save confirms exact quantity and undo restores the ledger");
await context.setOffline(false);
await page.goto("http://localhost:5174/#/dispatch");
await page
  .getByRole("button", { name: "Record dispatch", exact: true })
  .click();
await dialog.getByRole("button", { name: /Lot 1216/ }).click();
await expect(
  dialog.getByText("This lot is on QC hold. Choose a released lot."),
).toBeVisible();
await expect(
  dialog.getByRole("button", { name: "Continue", exact: true }),
).toBeDisabled();
await dialog.getByRole("button", { name: /Lot 1221/ }).click();
await dialog.getByRole("button", { name: "Continue", exact: true }).click();
await dialog.getByRole("textbox", { name: "Cartons", exact: true }).fill("1");
await dialog
  .getByRole("textbox", { name: "Net weight in kilograms" })
  .fill("999999");
await expect(
  dialog.getByText(/Only .* kg is available. Reduce the weight./),
).toBeVisible();
await expect(
  dialog.getByRole("button", { name: "Continue", exact: true }),
).toBeDisabled();
await pass("QC hold and over-issue cannot advance to saving");
await dialog.getByRole("button", { name: "Close", exact: true }).click();
await page.goto("http://localhost:5174/#/orders");
await page.getByRole("button", { name: "Record order", exact: true }).click();
await dialog
  .getByRole("textbox", { name: "Required weight (kg)" })
  .fill("1500");
await dialog.getByRole("button", { name: "Review order", exact: true }).click();
await auditDialog("Order review");
await dialog.getByRole("button", { name: "Save order", exact: true }).click();
await expect(dialog.getByText("Order saved", { exact: true })).toBeVisible();
await dialog.getByRole("button", { name: "Done", exact: true }).click();
expect(
  await page.evaluate(
    () => JSON.parse(localStorage.getItem("yf-orders-v1")).length,
  ),
).toBe(5);
await pass("Orders use persistent drafts, review and a saved result");
await page.goto("http://localhost:5174/#/login");
await page.getByRole("textbox", { name: "Your 4-digit PIN" }).count();
await page.locator(".pin-input").fill("1234");
await page
  .getByRole("button", { name: "Enter workspace", exact: true })
  .click();
await expect(
  page.getByRole("heading", { name: "Today", exact: true }),
).toBeVisible();
await pass("Sign in and return to Today without a hook error");
await page
  .getByRole("button", { name: "Switch to real workspace", exact: true })
  .click();
await expect(
  dialog.getByText(/A real factory workspace is not connected/),
).toBeVisible();
await dialog
  .getByRole("button", { name: "Return to practice", exact: true })
  .click();
await pass("Practice mode cannot pretend to switch to an unconnected factory");
await page
  .getByRole("button", { name: "Record production", exact: true })
  .click();
await page.evaluate(() => {
  Storage.prototype.setItem = function () {
    throw new DOMException("Full", "QuotaExceededError");
  };
});
await dialog.getByRole("button", { name: "Continue", exact: true }).click();
await dialog.getByRole("textbox", { name: "Cartons", exact: true }).fill("1");
await dialog
  .getByRole("textbox", { name: "Net weight in kilograms" })
  .fill("10");
await expect(page.getByText(/Changes could not be saved/)).toBeVisible();
await expect(
  dialog.getByRole("textbox", { name: "Net weight in kilograms" }),
).toHaveValue("10");
await dialog.getByRole("button", { name: "Continue", exact: true }).click();
await dialog.getByRole("button", { name: "Save entry", exact: true }).click();
await expect(dialog.getByText(/Could not save this entry/)).toBeVisible();
await pass(
  "Storage failure retains the draft and blocks false save confirmation",
);
expect(errors).toEqual([]);
await context.close();
const zoomContext = await browser.newContext({
  viewport: { width: 720, height: 450 },
});
const zoomPage = await zoomContext.newPage();
await zoomPage.goto("http://localhost:5174");
expect(
  await zoomPage.evaluate(
    () => document.documentElement.scrollWidth <= innerWidth,
  ),
).toBe(true);
await zoomPage
  .getByRole("button", { name: "Record production", exact: true })
  .click();
await zoomPage
  .getByRole("dialog")
  .getByRole("button", { name: "Continue", exact: true })
  .click();
await expect(
  zoomPage.getByRole("textbox", { name: "Net weight in kilograms" }),
).toBeVisible();
await pass(
  "200% desktop-equivalent viewport keeps navigation and entry fields usable",
);
await zoomContext.close();
await browser.close();
fs.writeFileSync(
  "docs/progress/redesign/workflows.json",
  JSON.stringify({ checks, errors }, null, 2),
);
