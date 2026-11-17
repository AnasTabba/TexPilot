import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const assets = (await readdir("dist/assets")).sort().map((name) => "/assets/" + name);
const version = createHash("sha256")
  .update(assets.join("\n"))
  .digest("hex")
  .slice(0, 12);
let worker = await readFile("public/sw.js", "utf8");
worker = worker.replace(
  "const CACHE='yarnflow-shell-v1';",
  `const CACHE='yarnflow-${version}';`,
);
worker = worker.replace(
  "cache.addAll(['/','/icon.svg'])",
  `cache.addAll(${JSON.stringify(["/", "/offline.html", "/icon.svg", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest", ...assets])})`,
);
worker = worker.replace(
  "const PUBLIC_SHELL=['/','/icon.svg'];",
  `const PUBLIC_SHELL=${JSON.stringify(["/", "/offline.html", "/icon.svg", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest", ...assets])};`,
);
if (worker.includes("const CACHE='yarnflow-shell-v1';") || worker.includes("cache.addAll(['/','/icon.svg'])") || worker.includes("const PUBLIC_SHELL=['/','/icon.svg'];")) throw new Error("Offline shell transform did not apply");
await writeFile("dist/sw.js", worker);
console.log(`Offline shell prepared: ${assets.length} local assets.`);
