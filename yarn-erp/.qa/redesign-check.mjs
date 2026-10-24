import { launchBrowser } from "./browser.mjs";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
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
fs.mkdirSync("docs/progress/redesign", { recursive: true });
for (const [width, ur, theme] of [
  [1440, false, "light"],
  [390, false, "light"],
  [390, true, "light"],
  [1440, false, "dark"],
]) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
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
    await page.evaluate(() => document.fonts.ready);
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      smallText: [...document.querySelectorAll("main *")]
        .filter(
          (e) =>
            [...e.childNodes].some(
              (n) => n.nodeType === 3 && n.textContent.trim(),
            ) &&
            e.getBoundingClientRect().width > 0 &&
            parseFloat(getComputedStyle(e).fontSize) < 14,
        )
        .map((e) => ({
          tag: e.tagName,
          text: e.textContent.slice(0, 60),
          size: getComputedStyle(e).fontSize,
        })),
    }));
    results.push({
      route,
      width,
      ur,
      theme,
      ...layout,
      violations: audit.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    });
    if (
      ["overview", "scanner", "production", "login"].includes(route) &&
      theme === "light" &&
      (!ur || route === "overview")
    )
      await page.screenshot({
        path: `docs/progress/redesign/${route}-${ur ? "ur" : "en"}-${width}.png`,
        fullPage: true,
      });
    console.log(
      `${width} ${ur ? "ur" : "en"} ${theme} ${route}: ${audit.violations.length} violations, overflow ${layout.overflow}`,
    );
  }
  await context.close();
}
fs.writeFileSync(
  "docs/progress/redesign/audit.json",
  JSON.stringify({ results, errors }, null, 2),
);
await browser.close();
console.log(
  JSON.stringify({
    screens: results.length,
    errors,
    failures: results.filter(
      (r) => r.overflow || r.violations.length || r.smallText.length,
    ).length,
  }),
);
