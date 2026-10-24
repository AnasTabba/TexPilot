import { chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export function launchBrowser() {
  let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  // A downloaded Playwright browser is preferred; a cached earlier build also works locally.
  if (!executablePath && !fs.existsSync(chromium.executablePath())) {
    const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
    if (fs.existsSync(cache))
      for (const entry of fs
        .readdirSync(cache)
        .filter((name) => name.startsWith("chromium_headless_shell-"))
        .sort()
        .reverse()) {
        const candidate = path.join(
          cache,
          entry,
          "chrome-headless-shell-mac-arm64/chrome-headless-shell",
        );
        if (fs.existsSync(candidate)) {
          executablePath = candidate;
          break;
        }
      }
  }
  return chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
}
