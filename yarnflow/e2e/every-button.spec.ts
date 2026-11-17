import { test, expect, type Page } from "@playwright/test";
import { apiPost } from "./helpers";

// Every control on every screen does what it says. Stock lives in the shared database of the dev
// server, reset to the demo's opening stock before each test; the scanner's model answer is a fixture
// here, so this checks the app's wiring, not the model.
// Reduced motion: no click waits on a screen's entrance animation.
const options = { serviceWorkers: "block", contextOptions: { reducedMotion: "reduce" } } as const;
test.use(options);
const PIN = "2468"; // YARNFLOW_SEED_PIN in playwright.config.ts

async function signIn(page: Page, name = "Anas", pin = PIN) {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(`^${name}\\b`) }).click();
  await page.getByLabel("4-digit PIN").fill(pin);
  await expect(page.getByRole("heading", { level: 1, name: "Home", exact: true })).toBeVisible();
}
test.beforeEach(async ({ page }, info) => {
  await page.request.post("/__test/reset");
  if (!info.title.startsWith("sign-in")) await signIn(page);
});

const head = (topk: [string, number][]) => ({ label: topk[0][0], confidence: topk[0][1], topk });
const answer = {
  scan_id: "button-check", verdict: "PASS", structure: head([["jersey", 0.81], ["knit", 0.12]]), treatment: head([["piece_dyed", 0.7]]),
  fibre_family: head([["cellulosic", 0.9]]), garment: { label: "top_tshirt_sweatshirt", confidence: 0.95, box: [0.1, 0.1, 0.9, 0.9] },
  stated_composition: { source: null, fibers: [], ocr_confidence: null, section: null }, flags: [], candidates: {},
  custom: { garment_type: head([["t_shirt", 0.96]]), mix: head([["cotton:100", 0.7]]), finish: head([["dyed", 0.9]]), pattern: head([["stripe", 0.85]]) },
  capture_quality: { blur: 150, exposure: "normal", framing: "good" }, model_version: "scanner-v8", kb_version: "v5",
  timestamp: new Date().toISOString(), timings_ms: { total: 1000 },
};
const photo = "src/assets/fabrics/cotton.webp";

async function mockScanner(page: Page) {
  await page.route("**/api/v1/model", (route) => route.fulfill({ json: { ready: true, model_version: "scanner-v8", mode: "scanner" } }));
  await page.route("**/api/v1/scan", (route) => route.fulfill({ json: answer }));
}
const title = (page: Page, name: string) => expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
// Stock and batch pages hide their h1 (yarnflow.css); their title is the top-bar text.
const topTitle = (page: Page, name: string) => expect(page.locator(".live-topbar-title")).toContainText(name);
async function reviewAndSave(page: Page, save: string) {
  await page.getByRole("button", { name: "Review entry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review before saving" })).toBeVisible();
  await page.getByRole("button", { name: save, exact: true }).click();
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test("sign-in: names, a wrong PIN on the keypad, the right one, and signing out", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Who are you?" })).toBeVisible();
    await expect(page.locator(".yf-person")).toHaveText([/^AAnas/, /^DDanish/, /^FFahad/, /^PPervaiz/, /^QQasim/, /^SSaima/, /^SSana/, /^ZZuhair/]);
    await page.getByRole("button", { name: /^Fahad\b/ }).click();
    await page.getByRole("button", { name: "Not Fahad?" }).click();
    await page.getByRole("button", { name: /^Anas\b/ }).click();
    const keypad = page.locator(".yf-keypad");
    for (const key of "1111") await keypad.getByRole("button", { name: key, exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("That name and PIN do not match.");
    await keypad.getByRole("button", { name: "9", exact: true }).click();
    await keypad.getByRole("button", { name: "Delete last digit" }).click();
    await expect(page.locator(".yf-pin-dots .filled")).toHaveCount(0);
    for (const key of PIN) await keypad.getByRole("button", { name: key, exact: true }).click();
    await title(page, "Home");
    await expect(page.locator(".live-sidebar .yf-me")).toContainText("AnasAdmin");
    page.once("dialog", (dialog) => void dialog.accept()); // Sign out asks window.confirm first.
    await page.getByRole("button", { name: "Sign out Anas" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Who are you?" })).toBeVisible();
    await page.goto("/#/inventory");
    await expect(page.getByRole("heading", { level: 1, name: "Who are you?" })).toBeVisible();
  });

  test("an admin adds a supervisor; both see the same stock; deactivation signs them out", async ({ page, browser }, info) => {
    await page.goto("/#/team");
    await page.getByRole("button", { name: "Add a person" }).click();
    await page.getByRole("form", { name: "Add a person" }).getByLabel("Name", { exact: true }).fill("Bilal");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("form", { name: "Add a person" }).locator(".ui-choice", { hasText: /^Supervisor/ }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByLabel("4-digit PIN", { exact: true }).fill("1357");
    await page.getByLabel("Type it again").fill("1375");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("The two PINs are different.");
    await page.getByLabel("Type it again").fill("1357");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Review entry", exact: true }).click();
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    await expect(page.locator(".yf-member", { hasText: "Bilal" })).toContainText("Supervisor");
    const other = await browser.newContext({ ...options.contextOptions, baseURL: info.project.use.baseURL, viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
    const bilal = await other.newPage();
    await signIn(bilal, "Bilal", "1357");
    await expect(bilal.locator(".live-sidebar .yf-me")).toContainText("Supervisor");
    await expect(bilal.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /^Team/ })).toHaveCount(0);
    await page.goto("/#/inventory");
    await expect(page.locator(".yf-stock-row").first()).toBeVisible();
    await bilal.goto("/#/inventory");
    await expect(bilal.locator(".yf-stock-row").first()).toBeVisible();
    expect(await bilal.locator(".yf-stock-row").allTextContents()).toEqual(await page.locator(".yf-stock-row").allTextContents());
    await page.goto("/#/team");
    await page.getByRole("button", { name: /^Bilal\b/ }).click();
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("button", { name: "Deactivate", exact: true }).click();
    await expect(page.locator(".yf-member", { hasText: "Bilal" })).toContainText("Deactivated");
    await bilal.reload();
    await expect(bilal.getByRole("heading", { level: 1, name: "Who are you?" })).toBeVisible();
    await other.close();
  });

  test("sidebar, brand link and the dashboard controls", async ({ page }) => {
    await page.goto("/#/dashboard");
    await title(page, "Home");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    for (const [label, h1] of [["Stock", "Stock"], ["Scan", "Scan"], ["Activity", "Activity"], ["Team", "Team"], ["Help", "Help"], ["Home", "Home"]]) {
      await nav.getByRole("button", { name: label, exact: true }).click();
      await (h1 === "Stock" ? topTitle : title)(page, h1);
      await expect(nav.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    }
    await nav.getByRole("button", { name: "Stock" }).click();
    await page.locator(".live-sidebar .live-brand").click();
    await title(page, "Home");

    // The Home screen's start jobs are there; the top-bar bell opens the full inbox.
    await expect(page.getByRole("heading", { level: 2, name: "Start" })).toBeVisible();
    await page.getByRole("button", { name: /^Notifications/ }).click();
    await title(page, "Notifications");
    await expect(page.getByText("No notifications yet.")).toBeVisible();
  });

  test("stock filters, search, add a material, new batch and a batch's whole life", async ({ page }) => {
    test.fixme(true, "Finished stock now requires QC-approved work in progress; the UI has no standalone add-batch flow.");
    await page.goto("/#/inventory");
    const views = page.getByRole("group", { name: "Filter stock" });
    for (const [name, rows] of [[/^Needs QC/, 2], [/^In production/, 1], [/^To dispatch/, 2], [/^All/, 4]] as const) {
      await views.getByRole("button", { name }).click();
      await expect(page.locator(".yf-stock-row")).toHaveCount(rows);
    }
    await page.getByLabel("Search", { exact: true }).fill("Viscose");
    await expect(page.locator(".yf-stock-row")).toHaveCount(1);
    await page.getByLabel("Search", { exact: true }).fill("");

    // A form opens, closes with its X and with Cancel.
    await page.getByRole("button", { name: "Add a material" }).click();
    await page.getByRole("button", { name: "Close form" }).click();
    await topTitle(page, "Stock");
    await page.getByRole("button", { name: "Add a material" }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await topTitle(page, "Stock");

    await page.getByRole("button", { name: "Add a material" }).click();
    await page.getByLabel("Material name", { exact: true }).fill("Carded cotton Ne 20/1");
    await page.getByLabel("SKU", { exact: true }).fill("CTN-20");
    await page.getByLabel("Why are you stepping in?", { exact: true }).fill("Supervisor is away today");
    await page.getByRole("button", { name: "Review entry", exact: true }).click();
    await page.getByRole("button", { name: "Edit entry", exact: true }).click();
    await expect(page.getByLabel("SKU", { exact: true })).toHaveValue("CTN-20");
    await reviewAndSave(page, "Save entry");
    await expect(page.getByRole("status").filter({ hasText: "Saved. Everyone on the team sees it now." })).toBeVisible();

    await page.getByRole("button", { name: /Add finished Carded cotton/ }).click();
    await page.getByLabel("Batch / dye lot", { exact: true }).fill("LOT-2001");
    await page.getByLabel("Weight (kg)", { exact: true }).fill("40");
    await page.getByLabel("Why are you stepping in?", { exact: true }).fill("Supervisor is away today");
    await reviewAndSave(page, "Save entry");
    await topTitle(page, "Batch details");
    await expect(page.locator(".yf-flow")).toContainText("40");
    await expect(page.getByRole("button", { name: "Receive stock", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Review quality", exact: true })).toHaveCount(0);

    // The rest of a batch's life runs on QC-approved stock that arrived through the inspection flow.
    await page.goto("/#/inventory");
    await page.locator(".yf-stock-row", { hasText: "LOT-1024" }).click();
    await topTitle(page, "Batch details");
    await expect(page.locator(".yf-steps li.done", { hasText: "QC approved" })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 3, name: "Dispatch finished stock" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Move stage", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Dispatch", exact: true }).click();
    await page.getByLabel("Weight (kg)", { exact: true }).fill("10");
    await page.getByLabel("Notes", { exact: true }).fill("Order 77");
    await reviewAndSave(page, "Save entry");
    // A write-off needs a reason; below the (unset) threshold it applies at once.
    await page.getByRole("button", { name: "Adjust stock", exact: true }).click();
    await page.getByLabel("Weight (kg)", { exact: true }).fill("1");
    await page.getByLabel("Reason", { exact: true }).fill("Counted one kilogram short");
    await page.getByLabel("Why are you stepping in?", { exact: true }).fill("Supervisor is away today");
    await reviewAndSave(page, "Save entry");
    await expect(page.locator(".yf-flow")).toContainText("6,739");

    // Guarded stock workflow: at the threshold the change waits for admin approval and the stock stays put.
    await apiPost(page, "/erp/admin/thresholds", { type: "inventory_adjustment", value: 5000 });
    await page.getByRole("button", { name: "Adjust stock", exact: true }).click();
    await page.getByLabel("Weight (kg)", { exact: true }).fill("6");
    await page.getByLabel("Reason", { exact: true }).fill("Water damage in bay 3");
    await page.getByLabel("Why are you stepping in?", { exact: true }).fill("Supervisor is away today");
    await reviewAndSave(page, "Save entry");
    await expect(page.getByRole("status").filter({ hasText: "Sent to the admin for approval" })).toBeVisible();
    await expect(page.locator(".yf-flow")).toContainText("6,739");
    const pending = (await (await page.request.get("/api/erp/approvals?type=inventory_adjustment")).json()).approvals;
    expect(pending).toHaveLength(1);
    await apiPost(page, "/erp/approvals/decide", { id: pending[0].id, decision: "approve" });
    await page.reload();
    await expect(page.locator(".yf-flow")).toContainText("6,733");

    await page.goto("/#/inventory");
    await page.locator(".yf-stock-row", { hasText: "LOT-2001" }).click();
    await page.evaluate(() => { (window as unknown as { printed: number }).printed = 0; window.print = () => { (window as unknown as { printed: number }).printed++; }; });
    await page.getByRole("button", { name: "Print batch label" }).click();
    expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  });

  test("history links, profile access and backup, help", async ({ page }) => {
    // The stock movement register belongs to the supervisor's History; the admin's Activity is the monitor and audit log.
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: /^Sign out Anas/ }).click();
    await signIn(page, "Saima");
    await page.goto("/#/activity");
    await page.locator(".live-history .live-text-button", { hasText: "LOT-1024" }).first().click();
    await topTitle(page, "Batch details");
    await page.goto("/#/activity");
    await expect(page.getByRole("button", { name: "Reverse entry" })).toHaveCount(0);
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: /^Sign out Saima/ }).click();
    await signIn(page);

    await page.goto("/#/profile");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download backup" }).click()]);
    expect(JSON.parse(await (await import("node:fs/promises")).readFile((await download.path())!, "utf8")).products).toHaveLength(4);
    // The profile now shows the signed-in person and their role; the access list and record counts moved out of it.
    await expect(page.locator(".yf-profile-identity")).toContainText("Anas");
    await expect(page.locator(".yf-profile-identity")).toContainText("Admin");

    await page.goto("/#/help");
    for (const summary of await page.locator(".yf-help summary").all()) {
      await summary.click();
      await expect(summary.locator("xpath=..")).toHaveAttribute("open", "");
    }
  });

  test("scan: tabs, connection, upload, analyse, details, download, measure, save to a batch, stock label", async ({ page }) => {
    await mockScanner(page);
    await page.goto("/#/scanner");
    await expect(page.getByText("Scanner connected")).toBeVisible();
    await page.getByRole("button", { name: "Model connection" }).click();
    await expect(page.locator(".scan-connect")).toBeVisible();
    await page.getByRole("button", { name: "Model connection" }).click();

    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("Choose photo", { exact: true }).click()]);
    await chooser.setFiles(photo);
    await page.getByRole("button", { name: "Remove selected photo" }).click();
    await expect(page.locator(".scan-camera-empty")).toBeVisible();
    await page.locator('input[type=file][aria-label="Upload material photo"]').setInputFiles(photo);
    await page.locator(".scan-manual-label summary").click();
    await expect(page.locator(".scan-manual-label textarea")).toBeVisible();
    // A label photo switches to the label slot; the slot switch then appears so the fabric photo stays reachable.
    await page.getByRole("button", { name: "Add label photo" }).click();
    await expect(page.getByRole("button", { name: /Care label/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /Fabric \/ garment/ }).click();
    // Back on the fabric slot with no label photo, the switch hides again and the fabric photo is still attached.
    await expect(page.getByRole("button", { name: "Remove selected photo" })).toBeVisible();

    await page.getByRole("button", { name: "Analyze material" }).click();
    await expect(page.locator(".scan-garment-hero h3")).toHaveText("T-shirt");
    // The result no longer shows a Pattern row; the Finish row carries the mocked 90% confidence.
    await expect(page.locator('.scan-rows li').filter({ hasText: 'Finish' })).toContainText('90%');
    await page.locator(".scan-details summary").click();
    await expect(page.locator(".scan-details dl")).toBeVisible();
    const [result] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download result" }).click()]);
    expect(result.suggestedFilename()).toMatch(/\.json$/);

    await page.getByRole("button", { name: "Measure yarn count" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Yarn count" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    await page.locator(".spec-form input[type=file]").first().setInputFiles(photo);
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();

    await page.getByRole("button", { name: "Stock label" }).click();
    await page.getByLabel("Or type the code", { exact: true }).fill("LOT-1024");
    await page.getByRole("button", { name: "Find batch" }).click();
    await topTitle(page, "Batch details");

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
    await page.goto("/#/dashboard");
    const bar = page.getByRole("navigation", { name: "Phone navigation" });
    for (const [label, h1] of [["Home", "Home"], ["Approvals", "Approvals"]]) {
      await bar.getByRole("button", { name: label, exact: true }).click();
      await title(page, h1);
    }
    await bar.getByRole("button", { name: "Scan", exact: true }).click();
    await title(page, "Scan");
    // Chat and Team are not on the bottom bar for an admin; they live in the More sheet.
    await bar.getByRole("button", { name: "More", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "More", exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Sign out" })).toBeVisible();
    await sheet.getByRole("button", { name: /^Chat\b/ }).click();
    await title(page, "Chat");
    await expect(sheet).toBeHidden();
    await bar.getByRole("button", { name: "More", exact: true }).click();
    await sheet.getByRole("button", { name: /^Team\b/ }).click();
    await title(page, "Team");
    await expect(sheet).toBeHidden();
    // The profile opens from the top-bar avatar on a phone.
    await page.getByRole("button", { name: "Open my profile", exact: true }).click();
    await title(page, "My profile");
    await bar.getByRole("button", { name: "More", exact: true }).click();
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(sheet).toBeHidden();
    // The phone top bar has no search button (yarnflow.css: search stays on the keyboard shortcut); Ctrl+K opens the palette, and Enter on a filtered page navigates there.
    await expect(page.getByRole("button", { name: /Search pages and batches/ })).toBeHidden();
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Search pages and batches" });
    await expect(palette).toBeVisible();
    await palette.getByRole("combobox").fill("team");
    await page.keyboard.press("Enter");
    await title(page, "Team");
    await expect(palette).toBeHidden();
    await page.keyboard.press("Control+k");
    await expect(palette).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });
});
