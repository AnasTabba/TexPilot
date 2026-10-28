// PIN accounts and sessions for the shared Yarnflow database.
// A 4-digit PIN has only 10,000 values, so its real protection is the lockout (5 wrong tries,
// then 5 minutes) and access to the database itself; the salted hash keeps PINs unreadable
// to anyone who reads the users table, including admins.
export const PERMISSIONS = ['receive', 'produce', 'dispatch', 'catalog', 'inspect', 'qc', 'waste', 'reverse', 'suppliers', 'procure', 'sales', 'production', 'payments'];
export const LOCK_AFTER = 5;
export const LOCK_MS = 5 * 60_000;
export const SESSION_MS = 30 * 24 * 3600_000;
const COOKIE = 'yf_session';

const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async text => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
export const randomHex = (bytes = 16) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
export const pinHash = (pin, salt) => sha256(`${salt}:${pin}`);
export const nameKey = name => name.trim().toLowerCase().replace(/\s+/g, ' ');
export const validPin = pin => typeof pin === 'string' && /^\d{4}$/.test(pin);

export function sessionToken(request) {
  return request.headers.get('Cookie')?.match(/(?:^|;\s*)yf_session=([a-f\d]{64})(?:;|$)/)?.[1] || null;
}
export function sessionCookie(request, token) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return token
    ? `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${secure}`
    : `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

/** SQL for one active or pending user; used by the API, the seed script and tests. */
export async function userRow({ id = crypto.randomUUID(), workspaceId, name, pin, role = 'member', status = 'active', permissions = [], createdBy = null, now = Date.now() }) {
  const salt = randomHex();
  return {
    sql: 'INSERT INTO users(id,workspace_id,name,name_key,pin_hash,pin_salt,role,status,permissions,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    args: [id, workspaceId, name.trim(), nameKey(name), await pinHash(pin, salt), salt, role, status, JSON.stringify(permissions), now, createdBy],
  };
}

/** The shared factory workspace and its first admins, all with the same starting PIN. */
export const SEED_ADMINS = ['Anas', 'Fahad', 'Zuhair'];
export async function seedRows(pin, now = Date.now()) {
  if (!validPin(pin)) throw new Error('The seed PIN must be exactly 4 digits.');
  const workspaceId = crypto.randomUUID();
  return [
    { sql: 'INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)', args: [workspaceId, 'FAZ Textile Factory', now] },
    ...await Promise.all(SEED_ADMINS.map(name => userRow({ workspaceId, name, pin, role: 'admin', now }))),
  ];
}
