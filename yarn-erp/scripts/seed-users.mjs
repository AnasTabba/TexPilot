// Prints the SQL that creates the shared workspace and the three admins, for
// `wrangler d1 execute <db> --remote --file`. The PIN comes from SEED_PIN and only its salted hash is printed.
import { seedRows } from '../server/auth.mjs';
const literal = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const rows = await seedRows(process.env.SEED_PIN);
for (const { sql, args } of rows) { let n = 0; console.log(sql.replace(/\?/g, () => literal(args[n++])) + ';'); }
