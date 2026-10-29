// UI-finish verification: sign in with the seeded test PIN and capture the working screens
// in English, Urdu and reduced motion, at desktop and phone sizes. Run against the Vite
// dev server (npm run dev, API dev server up) or a built preview:
//   node scripts/ui-shots.mjs --base http://127.0.0.1:5182 --out .shots/before
import { chromium, webkit, devices } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const base = flag("--base", "http://127.0.0.1:5182");
const shortBase = new URL(base).port;
const outRoot = path.resolve(import.meta.dirname, "..", flag("--out", `.shots/${shortBase}`));
const label = flag("--label", "");
const suffix = label ? `.${label}.png` : ".png";

fs.mkdirSync(outRoot, { recursive: true });
const reset = async () => {
  const response = await fetch(base + "/__test/reset", { method: "POST" });
  if (!response.ok && response.status !== 204) throw new Error(`reset failed: ${response.status}`);
};

const executableFor = browserType => {
  if (fs.existsSync(browserType.executablePath())) return {};
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  if (!fs.existsSync(cache)) return {};
  const prefixes = {
    chromium: [["chromium_headless_shell-", "chrome-headless-shell-mac-arm64/chrome-headless-shell"], ["chromium-", "chrome-mac/Chromium"]],
    webkit: [["webkit-", "pw_run.sh"]],
  }[browserType.name()] || [];
  for (const [prefix, deep] of prefixes)
    for (const entry of fs.readdirSync(cache).filter(name => name.startsWith(prefix)).sort().reverse()) {
      const candidate = path.join(cache, entry, deep);
      if (fs.existsSync(candidate)) return { executablePath: candidate };
    }
  return {};
};
const chromiumOptions = executableFor(chromium);
const webkitOptions = executableFor(webkit);

const store = name => path.join(outRoot, `${name}${suffix}`);
const sign = async (page, name = "Anas", pinPin = "4-digit PIN", urdu = false) => {
  await page.goto(base + "/", { waitUntil: "load" });
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByLabel(pinPin).fill("2468");
  await page.getByRole("heading", { name: urdu ? "ہوم" : "Home", exact: true }).waitFor({ timeout: 20000 });
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const pages = [
  { hash: "#/inventory", heading: "Stock" },
  { hash: "#/scanner", heading: "Scan" },
  { hash: "#/activity", heading: "History" },
  { hash: "#/help", heading: "Help" },
  { hash: "#/settings", heading: "Settings" },
  { hash: "#/procurement", heading: "Procurement" },
];

const englishDesktop = [
  {
    name: "signin-people", run: async page => {
      await page.goto(base + "/", { waitUntil: "networkidle" });
      await page.waitForSelector(".yf-people");
      await wait(1000);
      await page.screenshot({ path: store("signin-people") });
    },
  },
  {
    name: "signin-pin-active", run: async page => {
      await page.goto(base + "/", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Anas", exact: true }).click();
      await wait(1000);
      await page.screenshot({ path: store("signin-pin-active") });
    },
  },
  {
    name: "signin-language-urdu", run: async page => {
      await page.goto(base + "/", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Switch language to Urdu" }).click();
      await wait(1000);
      await page.screenshot({ path: store("signin-language-urdu") });
    },
  },
  {
    name: "signin-pin-typo", run: async page => {
      await page.goto(base + "/", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Anas", exact: true }).click();
      await page.getByLabel("4-digit PIN").fill("9999");
      await page.getByRole("alert").waitFor({ timeout: 20000 });
      await wait(800);
      await page.screenshot({ path: store("signin-pin-typo") });
    },
  },
];
for (const item of pages) {
  englishDesktop.push({
    name: "desktop-" + item.hash.slice(2), run: async page => {
      await sign(page);
      await page.evaluate(hash => { location.hash = hash; }, item.hash);
      await page.getByRole("heading", { name: item.heading, exact: true }).first().waitFor({ timeout: 20000 });
      await wait(1200);
      await page.screenshot({ path: store("desktop-" + item.hash.slice(2)), fullPage: item.hash !== "#/scanner" });
    },
  });
}
englishDesktop.push(
  {
    name: "desktop-home", run: async page => {
      await sign(page);
      await wait(1200);
      await page.screenshot({ path: store("desktop-home") });
    },
  },
  {
    name: "desktop-batch", run: async page => {
      await sign(page);
      await page.goto(base + "/#/inventory");
      const row = page.locator(".live-lot-row").first();
      await row.waitFor({ timeout: 20000 });
      await row.click();
      await page.getByRole("heading", { name: "Batch details" }).waitFor({ timeout: 20000 });
      await wait(1400);
      await page.screenshot({ path: store("desktop-batch"), fullPage: true });
    },
  },
  {
    name: "desktop-form", run: async page => {
      await sign(page);
      await page.goto(base + "/#/inventory");
      const row = page.locator(".live-lot-row").first();
      await row.waitFor({ timeout: 20000 });
      await row.click();
      await page.getByRole("button", { name: "Receive stock" }).click();
      await page.getByRole("heading", { name: "Stock entry" }).waitFor({ timeout: 20000 });
      await wait(1000);
      await page.screenshot({ path: store("desktop-form") });
    },
  },
);

const englishPhone = [
  {
    name: "phone-signin-people", run: async page => {
      await page.goto(base + "/", { waitUntil: "networkidle" });
      await page.waitForSelector(".yf-people");
      await wait(1000);
      await page.screenshot({ path: store("phone-signin-people") });
    },
  },
  {
    name: "phone-home", run: async page => {
      await sign(page);
      await wait(1200);
      await page.screenshot({ path: store("phone-home") });
    },
  },
  {
    name: "phone-stock", run: async page => {
      await sign(page);
      await page.locator(".live-bottom-nav button", { hasText: "Stock" }).click();
      await page.getByRole("heading", { name: "Stock" }).first().waitFor({ timeout: 20000 });
      await wait(1200);
      await page.screenshot({ path: store("phone-stock"), fullPage: true });
    },
  },
  {
    name: "phone-scanner", run: async page => {
      await sign(page);
      await page.locator(".live-bottom-nav button", { hasText: "Scan" }).click();
      await page.getByRole("heading", { name: "Scan" }).first().waitFor({ timeout: 20000 });
      await wait(1200);
      await page.screenshot({ path: store("phone-scanner") });
    },
  },
  {
    name: "phone-menu", run: async page => {
      await sign(page);
      await page.getByRole("button", { name: /More pages/ }).click();
      await wait(900);
      await page.screenshot({ path: store("phone-menu") });
    },
  },
];

const urduDesktop = [
  {
    name: "urdu-signin", run: async page => {
      await page.goto(base + "/", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Switch language to Urdu" }).click();
      await wait(1000);
      await page.screenshot({ path: store("urdu-signin") });
    },
  },
  {
    name: "urdu-home", run: async page => {
      await page.goto(base + "/", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Switch language to Urdu" }).click();
      await sign(page, "Anas", "چار ہندسوں کا پن", true);
      await wait(1400);
      await page.screenshot({ path: store("urdu-home"), fullPage: true });
    },
  },
  {
    name: "urdu-stock", run: async page => {
      await page.goto(base + "/", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Switch language to Urdu" }).click();
      await sign(page, "Anas", "چار ہندسوں کا پن", true);
      await page.evaluate(() => { location.hash = "#/inventory"; });
      await page.getByRole("heading", { name: "اسٹاک", exact: true }).first().waitFor({ timeout: 20000 });
      await wait(1200);
      await page.screenshot({ path: store("urdu-stock") });
    },
  },
];

const reduced = [
  {
    name: "reduced-home", run: async page => {
      await sign(page);
      await wait(500);
      await page.screenshot({ path: store("reduced-home") });
    },
  },
];
const phoneNarrow = [
  {
    name: "phone-narrow-home", run: async page => {
      await sign(page);
      await wait(1000);
      await page.screenshot({ path: store("phone-narrow-home"), fullPage: true });
    },
  },
];

const results = [];
const runSet = async (browser, contextFactory, set) => {
  for (const shot of set) {
    const context = await contextFactory();
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await reset().catch(() => {});
    try { await shot.run(page); results.push(`ok ${shot.name}`); }
    catch (error) { results.push(`FAIL ${shot.name}: ${String(error && error.message).slice(0, 180)}`); }
    await context.close();
  }
};
{
  const browser = await chromium.launch({ headless: true, ...chromiumOptions });
  await runSet(
    browser,
    () => browser.newContext({ viewport: { width: 1440, height: 900 } }),
    [...englishDesktop, ...urduDesktop],
  );
  await runSet(browser, () => browser.newContext({ ...devices["Desktop Chrome"], reducedMotion: "reduce" }), reduced);
  await browser.close();
}
if (Object.keys(webkitOptions).length || fs.existsSync(webkit.executablePath())) {
  const browser = await webkit.launch({ headless: true, ...webkitOptions, timeout: 45000 });
  await runSet(browser, () => browser.newContext({ ...devices["iPhone 13"] }), englishPhone);
  await runSet(browser, () => browser.newContext({ ...devices["iPhone 13"] }), phoneNarrow);
  await browser.close();
} else results.push("skip phone (webkit not found)");

fs.writeFileSync(path.join(outRoot, `results${suffix.replace(".png", "")}.txt`), results.join("\n") + "\n");
console.log(results.join("\n"));
