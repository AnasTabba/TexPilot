import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
const assets = {};
async function collect(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'server') continue;
    const path = join(dir, entry.name); const url = prefix + '/' + entry.name;
    if (entry.isDirectory()) await collect(path, url);
    else { const suffix = '.' + entry.name.split('.').at(-1); assets[url] = [types[suffix] || 'application/octet-stream', (await readFile(path)).toString('base64')]; }
  }
}
await collect('dist');
await writeFile('server/assets.generated.mjs', 'export default ' + JSON.stringify(assets) + ';\n');
try {
  await mkdir('dist/server', { recursive: true });
  await build({ entryPoints: ['server/worker.mjs'], outfile: 'dist/server/index.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true });
  await mkdir('dist/.openai', { recursive: true });
  await writeFile('dist/.openai/hosting.json', await readFile('.openai/hosting.json'));
} finally { await rm('server/assets.generated.mjs', { force: true }); }
console.log(`Built HTTPS Worker with ${Object.keys(assets).length} bundled static assets and shared inventory API.`);
