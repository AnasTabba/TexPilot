import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const [site, email, ...extra] = process.argv.slice(2);
if (!site || !email || extra.length) throw new Error('Usage: node prepare-env.mjs https://inventory.your-domain.example owner@your-domain.example');
const url = new URL(site);
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the HTTPS origin of a domain you control.');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Use a real administrator email address.');
const root = new URL('./', import.meta.url);
const template = await readFile(new URL('.env.example', root), 'utf8');
const value = template.replace('INVENTREE_DB_PASSWORD=GENERATE_DATABASE_PASSWORD', 'INVENTREE_DB_PASSWORD=' + randomBytes(32).toString('hex'))
  .replace('INVENTREE_ADMIN_PASSWORD=GENERATE_ADMIN_PASSWORD', 'INVENTREE_ADMIN_PASSWORD=' + randomBytes(24).toString('hex'))
  .replace('INVENTREE_ADMIN_EMAIL=SET_ADMIN_EMAIL', 'INVENTREE_ADMIN_EMAIL=' + email)
  .replace('INVENTREE_SITE_URL="http://localhost"', 'INVENTREE_SITE_URL="' + url.origin + '"');
await writeFile(new URL('.env', root), value, { flag: 'wx', mode: 0o600 });
console.log('Created private .env at ' + fileURLToPath(new URL('.env', root)) + '. Administrator and database passwords are stored there; no secrets were printed.');
