import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const assets = (await readdir("dist/assets")).map((name) => "/assets/" + name);
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
  `cache.addAll(${JSON.stringify(["/", "/icon.svg", "/manifest.webmanifest", ...assets])})`,
);
await writeFile("dist/sw.js", worker);
console.log(`Offline shell prepared: ${assets.length} local assets.`);
