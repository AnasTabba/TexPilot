import { test, expect, type Page } from "@playwright/test";

// Every control on every screen does what it says. Stock lives in the shared database of the dev
// server, reset to the demo's opening stock before each test; the scanner's model answer is a fixture
// here, so this checks the app's wiring, not the model.
// Reduced motion: no click waits on a screen's entrance animation.
const options = { serviceWorkers: "block", contextOptions: { reducedMotion: "reduce" } } as const;
test.use(options);
const PIN = "2468"; // YARNFLOW_SEED_PIN in playwright.config.ts

async function signIn(page: Page, name = "Anas", pin = PIN) {
  await page.goto("/");
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByLabel("4-digit PIN").fill(pin);
  await expect(page.getByRole("heading", { level: 1, name: "Home", exact: true })).toBeVisible();
}
test.beforeEach(async ({ page }, info) => {
  await page.request.post("/__test/reset");
  if (!info.title.startsWith("sign-in") && !info.title.startsWith("a new person")) await signIn(page);
});

const head = (topk: [string, number][]) => ({ label: topk[0][0], confidence: topk[0][1], topk });
const answer = {
  scan_id: "button-check", verdict: "PASS", structure: head([["jersey", 0.81], ["knit", 0.12]]), treatment: head([["piece_dyed", 0.7]]),
  fibre_family: head([["cellulosic", 0.9]]), garment: { label: "top_tshirt_sweatshirt", confidence: 0.95, box: [0.1, 0.1, 0.9, 0.9] },
  stated_composition: { source: null, fibers: [], ocr_confidence: null, section: null }, flags: [], candidates: {},
  custom: { garment_type: head([["t_shirt", 0.96]]), mix: head([["cotton:100", 0.7]]), finish: head([["dyed", 0.9]]) },
  capture_quality: { blur: 150, exposure: "normal", framing: "good" }, model_version: "scanner-v8", kb_version: "v5",
  timestamp: new Date().toISOString(), timings_ms: { total: 1000 },
};
const photo = "src/assets/fabrics/cotton.webp";

async function mockScanner(page: Page) {
  await page.route("**/api/v1/model", (route) => route.fulfill({ json: { ready: true, model_version: "scanner-v8", mode: "scanner" } }));
  await page.route("**/api/v1/scan", (route) => route.fulfill({ json: answer }));
}
const title = (page: Page, name: string) => expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
async function reviewAndSave(page: Page, save: string) {
  await page.getByRole("button", { name: "Review entry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review before saving" })).toBeVisible();
  await page.getByRole("button", { name: save, exact: true }).click();
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test("sign-in: names, a wrong PIN on the keypad, the right one, and signing out", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Who’s signing in?" })).toBeVisible();
    await expect(page.locator(".yf-person")).toHaveText(["AAnas", "FFahad", "ZZuhair"]);
    await page.getByRole("button", { name: "Fahad", exact: true }).click();
    await page.getByRole("button", { name: "Not Fahad?" }).click();
    await page.getByRole("button", { name: "Anas", exact: true }).click();
    const keypad = page.locator(".yf-keypad");
    for (const key of "1111") await keypad.getByRole("button", { name: key, exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("That name and PIN do not match.");
    await keypad.getByRole("button", { name: "9", exact: true }).click();
    await keypad.getByRole("button", { name: "Delete last digit" }).click();
    await expect(page.locator(".yf-pin-dots .filled")).toHaveCount(0);
    for (const key of PIN) await keypad.getByRole("button", { name: key, exact: true }).click();
    await title(page, "Home");
    await expect(page.locator(".live-sidebar .yf-me")).toContainText("AnasAdmin");
    await page.getByRole("button", { name: "Sign out Anas" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Who’s signing in?" })).toBeVisible();
    await page.goto("/#/inventory");
    await expect(page.getByRole("heading", { level: 1, name: "Who’s signing in?" })).toBeVisible();
  });

  test("a new person asks to join; an admin approves Stores access; both see the same stock; removal signs them out", async ({ page, browser }, info) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New here? Ask for an account" }).click();
    await page.getByLabel("Your name", { exact: true }).fill("Bilal");
    await page.getByLabel("Choose a 4-digit PIN").fill("1357");
    await page.getByLabel("Type it again").fill("1375");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("alert")).toContainText("The two PINs are different.");
    await page.getByLabel("Type it again").fill("1357");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();
    await page.getByRole("button", { name: "Back to sign-in" }).click();
    await expect(page.getByRole("button", { name: "Bilal", exact: true })).toHaveCount(0);

    // Anas, on another device, sees the request waiting and approves it.
    const other = await browser.newContext({ ...options.contextOptions, baseURL: info.project.use.baseURL, viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
    const admin = await other.newPage();
    await signIn(admin);
    await expect(admin.locator(".live-sidebar .yf-nav-count")).toHaveText("1");
    await admin.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /^Team/ }).click();
    const request = admin.getByRole("article", { name: "Bilal wants to join" });
    await request.getByRole("button", { name: "Stores", exact: true }).click();
    await expect(request.getByLabel(/Receive deliveries/)).toBeChecked();
    await expect(request.getByLabel(/QC decisions/)).not.toBeChecked();
    await request.getByRole("button", { name: "Approve Bilal" }).click();
    await expect(admin.locator(".yf-member-row", { hasText: "Bilal" })).toContainText("Stores");

    await signIn(page, "Bilal", "1357");
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /^Team/ })).toHaveCount(0);
    await page.goto("/#/inventory");
    await page.locator(".live-lot-row", { hasText: "LOT-1024" }).click();
    await expect(page.getByRole("heading", { level: 3, name: "Dispatch finished stock" })).toBeVisible();
    await expect(page.locator(".yf-next")).toContainText("Someone with “Dispatch” access records this step.");
    await expect(page.getByRole("button", { name: "Dispatch", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Review quality", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Receive stock", exact: true }).click();
    await page.getByLabel("Weight (kg)", { exact: true }).fill("12.5");
    await reviewAndSave(page, "Save entry");
    await expect(page.getByRole("status").filter({ hasText: "Saved. Everyone on the team sees it now." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo entry" })).toHaveCount(0);
    await page.goto("/#/settings");
    await expect(page.locator(".yf-access li.is-on")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Download backup" })).toHaveCount(0);

    // No reload: Anas's open page picks up Bilal's entry on its next refresh (every 10 seconds).
    await admin.goto("/#/activity");
    await expect(admin.locator(".live-history li", { hasText: "Recorded by Bilal" }).first()).toContainText("12.5", { timeout: 15_000 });
    await admin.goto("/#/team");
    await admin.locator(".yf-member-row", { hasText: "Bilal" }).click();
    admin.once("dialog", (dialog) => dialog.accept());
    await admin.getByRole("button", { name: "Remove Bilal" }).click();
    await expect(admin.locator(".yf-member-row", { hasText: "Bilal" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Who’s signing in?" })).toBeVisible();
    await other.close();
  });

  test("sidebar, brand link and every Home control", async ({ page }) => {
    await page.goto("/#/overview");
    await title(page, "Home");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    for (const [label, h1] of [["Stock", "Stock"], ["Scan", "Scan"], ["History", "History"], ["Team", "Team"], ["Settings", "Settings"], ["Help", "Help"], ["Home", "Home"]]) {
      await nav.getByRole("button", { name: label, exact: true }).click();
      await title(page, h1);
      await expect(nav.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    }
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Stock" }).click();
    await page.locator(".live-sidebar .live-brand").click();
    await title(page, "Home");

    // The next step names the batch on hold and opens it.
    await expect(page.getByRole("heading", { level: 2, name: /Review the QC hold on Viscose/ })).toBeVisible();
    await page.getByRole("button", { name: "Review batch" }).click();
    await title(page, "Batch details");
    await expect(page.getByRole("heading", { level: 2, name: /Viscose/ })).toBeVisible();
    await page.getByRole("button", { name: "All stock" }).click();
    await title(page, "Stock");

    await page.goto("/#/overview");
    await page.locator(".yf-next").getByRole("button", { name: "Scan fabric" }).click();
    await title(page, "Scan");
    await page.goto("/#/overview");
    await page.getByRole("button", { name: "Open Stock" }).click();
    await title(page, "Stock");
    await page.goto("/#/overview");
    await page.locator(".yf-head").getByRole("button", { name: "History" }).click();
    await title(page, "History");
    await page.goto("/#/overview");
    await page.locator("button.yf-row", { hasText: "Combed cotton" }).click();
    await expect(page.getByRole("heading", { level: 2, name: /Combed cotton/ })).toBeVisible();
  });

  test("stock filters, search, new material, new batch and a batch's whole life", async ({ page }) => {
    await page.goto("/#/inventory");
    const views = page.getByRole("group", { name: "Show" });
    for (const [name, rows] of [[/^Needs QC/, 2], [/^In production/, 1], [/^To dispatch/, 2], [/^All/, 4]] as const) {
      await views.getByRole("button", { name }).click();
      await expect(page.locator(".live-lot-row")).toHaveCount(rows);
    }
    await page.getByLabel("Search", { exact: true }).fill("Viscose");
    await expect(page.locator(".live-lot-row")).toHaveCount(1);
    await page.getByLabel("Search", { exact: true }).fill("");

    // A form opens, closes with its X and with Cancel.
    await page.getByRole("button", { name: "New material" }).click();
    await page.getByRole("button", { name: "Close form" }).click();
    await title(page, "Stock");
    await page.getByRole("button", { name: "New material" }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await title(page, "Stock");

    await page.getByRole("button", { name: "New material" }).click();
    await page.getByLabel("Material name", { exact: true }).fill("Carded cotton Ne 20/1");
    await page.getByLabel("SKU", { exact: true }).fill("CTN-20");
    await page.getByRole("button", { name: "Review entry", exact: true }).click();
    await page.getByRole("button", { name: "Edit entry", exact: true }).click();
    await expect(page.getByLabel("SKU", { exact: true })).toHaveValue("CTN-20");
    await reviewAndSave(page, "Save entry");
    await expect(page.getByRole("status").filter({ hasText: "Saved. Everyone on the team sees it now." })).toBeVisible();

    await page.getByRole("button", { name: /New batch of Carded cotton/ }).click();
    await page.getByLabel("Batch / dye lot", { exact: true }).fill("LOT-2001");
    await page.getByLabel("Supplier (optional)", { exact: true }).fill("Test Mills");
    await reviewAndSave(page, "Save entry");
    await title(page, "Batch details");
    await expect(page.getByRole("heading", { level: 3, name: "Receive the first delivery" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dispatch", exact: true })).toBeDisabled();

    await page.getByRole("button", { name: "Receive stock", exact: true }).click();
    await page.getByLabel("Weight (kg)", { exact: true }).fill("100");
    await page.getByLabel("Cartons", { exact: true }).fill("4");
    await page.getByLabel("Cones", { exact: true }).fill("40");
    await reviewAndSave(page, "Save entry");
    await expect(page.getByRole("heading", { level: 3, name: "Inspect this batch" })).toBeVisible();

    await page.getByRole("button", { name: "Add inspection", exact: true }).click();
    await page.getByLabel("Notes", { exact: true }).fill("Shade and count match the order");
    await reviewAndSave(page, "Save inspection");
    await expect(page.getByRole("heading", { level: 3, name: "Record the QC decision" })).toBeVisible();
    await expect(page.locator(".yf-timeline")).toContainText("Manual inspection");

    await page.getByRole("button", { name: "Review quality", exact: true }).click();
    await page.getByLabel("Inspection reason", { exact: true }).fill("Physical check passed");
    await reviewAndSave(page, "Save QC decision");
    await expect(page.locator(".yf-batch .live-panel-heading .live-quality")).toHaveText("QC approved");
    await expect(page.getByRole("heading", { level: 3, name: "Move it into production" })).toBeVisible();

    await page.getByRole("button", { name: "Move stage", exact: true }).click();
    await page.getByLabel("Weight (kg)", { exact: true }).fill("40");
    await reviewAndSave(page, "Save entry");
    await expect(page.getByRole("heading", { level: 3, name: "Dispatch finished stock" })).toBeVisible();

    await page.getByRole("button", { name: "Dispatch", exact: true }).click();
    await page.getByLabel("Weight (kg)", { exact: true }).fill("10");
    await page.getByLabel("Notes", { exact: true }).fill("Order 77");
    await reviewAndSave(page, "Save entry");
    await page.getByRole("button", { name: "Record waste", exact: true }).click();
    await page.getByLabel("Weight (kg)", { exact: true }).fill("1");
    await reviewAndSave(page, "Save entry");
    await expect(page.locator(".yf-flow")).toContainText("49");

    // Undo opens the reversal form already filled in.
    await page.getByRole("button", { name: "Undo entry" }).click();
    await title(page, "History");
    await expect(page.getByLabel("Reason", { exact: true })).toHaveValue("Correction after saving");
    await reviewAndSave(page, "Save reversal");
    await expect(page.getByRole("status").filter({ hasText: "Reversal saved." })).toBeVisible();

    await page.goto("/#/inventory");
    await page.locator(".live-lot-row", { hasText: "LOT-2001" }).click();
    await page.evaluate(() => { (window as unknown as { printed: number }).printed = 0; window.print = () => { (window as unknown as { printed: number }).printed++; }; });
    await page.getByRole("button", { name: "Print batch label" }).click();
    expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  });

  test("history links, settings access and backup, help", async ({ page }) => {
    await page.goto("/#/activity");
    await page.locator(".live-history .live-text-button", { hasText: "LOT-1024" }).first().click();
    await title(page, "Batch details");
    await page.goto("/#/activity");
    await page.getByRole("button", { name: "Reverse entry" }).first().click();
    await expect(page.getByRole("heading", { name: "Reverse this movement" })).toBeVisible();
    await page.getByRole("button", { name: "Close form" }).click();

    await page.goto("/#/settings");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download backup" }).click()]);
    expect(JSON.parse(await (await import("node:fs/promises")).readFile((await download.path())!, "utf8")).products).toHaveLength(4);
    await expect(page.locator(".yf-access li.is-on")).toHaveCount(8);
    await expect(page.locator(".yf-counts")).toContainText("Materials4");
    await expect(page.locator(".yf-counts")).toContainText("People3");

    await page.goto("/#/help");
    for (const summary of await page.locator(".yf-help summary").all()) {
      await summary.click();
      await expect(summary.locator("xpath=..")).toHaveAttribute("open", "");
    }
  });

  test("scan: tabs, connection, upload, analyse, details, download, measure, save to a batch, stock label", async ({ page }) => {
    await mockScanner(page);
    await page.goto("/#/scanner");
    await expect(page.getByText("TexPilot model connected")).toBeVisible();
    await page.getByRole("button", { name: "Model connection" }).click();
    await expect(page.locator(".scan-connect")).toBeVisible();
    await page.getByRole("button", { name: "Model connection" }).click();

    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("Upload photo", { exact: true }).click()]);
    await chooser.setFiles(photo);
    await page.getByRole("button", { name: "Remove selected photo" }).click();
    await expect(page.locator(".scan-camera-empty")).toBeVisible();
    await page.locator('input[type=file][aria-label="Upload material photo"]').setInputFiles(photo);
    await page.getByRole("button", { name: /Care label/ }).click();
    await page.getByRole("button", { name: /Fabric \/ garment/ }).click();
    await page.getByText("Type label composition instead").click();
    await expect(page.locator(".scan-manual-label textarea")).toBeVisible();

    await page.getByRole("button", { name: "Analyze material" }).click();
    await expect(page.locator(".scan-garment-hero h3")).toHaveText("T-shirt");
    await page.locator(".scan-details summary").click();
    await expect(page.locator(".scan-details dl")).toBeVisible();
    const [result] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download result" }).click()]);
    expect(result.suggestedFilename()).toMatch(/\.json$/);

    await page.getByRole("button", { name: "Measure yarn count" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Yarn count" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Work out the yarn" })).toBeDisabled();
    await page.locator(".spec-form input[type=file]").first().setInputFiles(photo);
    await expect(page.getByRole("button", { name: "Work out the yarn" })).toBeEnabled();

    await page.getByRole("button", { name: "Stock label" }).click();
    await page.getByLabel("Barcode or batch number").fill("LOT-1024");
    await page.getByRole("button", { name: "Find batch" }).click();
    await title(page, "Batch details");

    await page.goto("/#/scanner");
    await page.getByRole("button", { name: "Fabric", exact: true }).click();
    await page.getByRole("button", { name: "Save to a batch" }).click();
    await expect(page.getByRole("heading", { name: "Attach TexPilot evidence" })).toBeVisible();
    await page.getByLabel("Notes", { exact: true }).fill("Scan matches the order");
    await reviewAndSave(page, "Save inspection");
    await expect(page.locator(".yf-timeline")).toContainText("TexPilot evidence");
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("bottom bar, More sheet and the search button", async ({ page }) => {
    await page.goto("/#/overview");
    const bar = page.getByRole("navigation", { name: "Phone navigation" });
    for (const [label, h1] of [["Stock", "Stock"], ["Scan", "Scan"], ["History", "History"], ["Home", "Home"]]) {
      await bar.getByRole("button", { name: label, exact: true }).click();
      await title(page, h1);
    }
    await bar.getByRole("button", { name: "More pages" }).click();
    const sheet = page.getByRole("dialog", { name: "Navigation menu" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Team" })).toBeVisible();
    await expect(sheet.locator(".yf-me")).toContainText("Anas");
    await sheet.getByRole("button", { name: "Settings" }).click();
    await title(page, "Settings");
    await expect(sheet).toBeHidden();
    await bar.getByRole("button", { name: "More pages" }).click();
    await sheet.getByRole("button", { name: "Close navigation" }).click();
    await expect(sheet).toBeHidden();
    await page.getByRole("button", { name: "Find a batch" }).click();
    await title(page, "Stock");
    await expect(page.getByLabel("Search", { exact: true })).toBeFocused();
  });
});
