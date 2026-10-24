import { launchBrowser } from "./browser.mjs";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
const root = "docs/progress/polish";
fs.mkdirSync(root, { recursive: true });
const browser = await launchBrowser();
const results = [];
const errors = [];
const routes = [
  "overview",
  "production",
  "inventory",
  "orders",
  "dispatch",
  "register",
  "more",
  "scanner",
  "reports",
  "settings",
  "help",
  "search",
  "close",
  "masters",
  "users",
  "import",
  "home",
  "components",
  "sync",
  "login",
];
async function capture(
  page,
  name,
  width,
  ur = false,
  theme = "light",
  dialog = false,
) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    async () =>
      await Promise.allSettled(
        document.getAnimations().map((animation) => animation.finished),
      ),
  );
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    smallText: [...document.querySelectorAll('main *,[role="dialog"] *')]
      .filter(
        (e) =>
          e.getBoundingClientRect().width > 0 &&
          [...e.childNodes].some(
            (n) => n.nodeType === 3 && n.textContent.trim(),
          ) &&
          parseFloat(getComputedStyle(e).fontSize) < 14,
      )
      .map((e) => ({
        text: e.textContent.slice(0, 60),
        size: getComputedStyle(e).fontSize,
      })),
  }));
  await page.screenshot({
    path: `${root}/${name}-${ur ? "ur" : "en"}-${theme}-${width}.png`,
    fullPage: !dialog,
  });
  results.push({
    name,
    width,
    ur,
    theme,
    ...layout,
    violations: audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  });
  console.log(
    `${width} ${name} ${ur ? "ur" : theme}: ${audit.violations.length} violations, overflow ${layout.overflow}`,
  );
  fs.writeFileSync(
    `${root}/audit.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
}
for (const [width, ur, theme] of [
  [1440, false, "light"],
  [1024, false, "light"],
  [390, false, "light"],
  [390, true, "light"],
  [1440, false, "dark"],
]) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) =>
    errors.push({ width, ur, theme, error: e.message }),
  );
  await page.goto("http://localhost:5174");
  await page.evaluate(
    ({ ur, theme }) => {
      localStorage.setItem("yf-language", JSON.stringify(ur));
      localStorage.setItem("yf-theme", JSON.stringify(theme));
    },
    { ur, theme },
  );
  for (const route of routes) {
    await page.goto(`http://localhost:5174/#/${route}`);
    await page.reload();
    await page.locator("h1").waitFor();
    await page.waitForFunction(
      (theme) => document.documentElement.dataset.theme === theme,
      theme,
    );
    await capture(page, route, width, ur, theme);
  }
  if (!ur && theme === "light") {
    async function visit(route) {
      await page.goto("http://localhost:5174/#/" + route);
      await page.locator("h1").waitFor();
    }
    for (const [kind, route, action] of [
      ["production", "production", "Record production"],
      ["receipt", "inventory", "Receive yarn"],
      ["dispatch", "dispatch", "Record dispatch"],
      ["issue", "home", "Issue to machine"],
    ]) {
      await visit(route);
      await page.getByRole("button", { name: action, exact: true }).click();
      let d = page.getByRole("dialog");
      await capture(page, `${kind}-step1`, width, false, "light", true);
      await d.getByRole("button", { name: "Continue", exact: true }).click();
      await capture(page, `${kind}-step2`, width, false, "light", true);
      await d.getByRole("textbox", { name: "Cartons", exact: true }).fill("1");
      await d
        .getByRole("textbox", { name: "Net weight in kilograms" })
        .fill("20.125");
      await d.getByRole("button", { name: "Continue", exact: true }).click();
      await capture(page, `${kind}-review`, width, false, "light", true);
      await d.getByRole("button", { name: "Close", exact: true }).click();
    }
    await visit("orders");
    await page
      .getByRole("button", { name: "Record order", exact: true })
      .click();
    let d = page.getByRole("dialog");
    await capture(page, "order-form", width, false, "light", true);
    await d.getByRole("textbox", { name: "Required weight (kg)" }).fill("1200");
    await d.getByRole("button", { name: "Review order", exact: true }).click();
    await capture(page, "order-review", width, false, "light", true);
    await d.getByRole("button", { name: "Close", exact: true }).click();
    await visit("production");
    await page
      .getByRole("button", { name: "View entry", exact: true })
      .first()
      .click();
    await capture(page, "entry-detail", width, false, "light", true);
    await d.getByRole("button", { name: "Reverse entry", exact: true }).click();
    await capture(page, "entry-reversal", width, false, "light", true);
    await d.getByRole("button", { name: "Close", exact: true }).click();
    await visit("overview");
    await page.getByRole("button", { name: "Review lot", exact: true }).click();
    await capture(page, "lot-detail", width, false, "light", true);
    await d.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "View order", exact: true })
      .first()
      .click();
    await capture(page, "order-detail", width, false, "light", true);
    await d.getByRole("button", { name: "Close", exact: true }).click();
    await visit("reports");
    await page.getByRole("button", { name: /Daily summary/ }).click();
    await capture(page, "report-detail", width, false, "light", true);
    await d.getByRole("button", { name: "Close", exact: true }).click();
    await visit("settings");
    for (const name of ["Appearance", "Data & masters", "People & devices"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await capture(
        page,
        `settings-${name.replaceAll(/[^a-zA-Z]/g, "").toLowerCase()}`,
        width,
      );
    }
  }
  await context.close();
}
await browser.close();
const failures = results.filter(
  (r) => r.overflow || r.violations.length || r.smallText.length,
);
console.log(
  JSON.stringify({
    screens: results.length,
    failures: failures.length,
    errors,
  }),
);
if (failures.length || errors.length) process.exitCode = 1;
