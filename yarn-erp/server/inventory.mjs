/** Shared inventory API: PIN sessions (server/auth.mjs) give identity, D1 supplies durable SQL. */
import { LOCK_AFTER, LOCK_MS, ROLE_PERMISSIONS, SESSION_MS, nameKey, pinHash, randomHex, sessionCookie, sessionToken, sha256, validPin } from './auth.mjs';
import { adminApi } from './admin.mjs';
import { ErpProblem } from './erp-utils.mjs';
import { supplierPortal } from './supplier-portal.mjs';
import { staffProcurement } from './procurement.mjs';
import { receiving } from './receiving.mjs';
import { salesApi } from './sales.mjs';
import { buyerPortalApi } from './buyer-portal.mjs';
import { notificationsApi } from './notify.mjs';
import { approvalsApi } from './governance.mjs';
const approvalHandlers = {};
const erp = { admin: adminApi, notifications: notificationsApi, sales: salesApi };
erp.approvals = (rq, env, m, p, d) => approvalsApi(rq, env, m, p, d, approvalHandlers);
const STAGES = ['raw', 'wip', 'finished', 'cops'];
const uuid = () => crypto.randomUUID();
class Problem extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new Problem(status, message); };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});
function text(value, label, min = 1, max = 200) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\u0000-\u0008]/.test(value)) fail(422, `${label} must contain ${min}–${max} characters.`);
  return value.trim();
}
function id(value) {
  const result = text(value, 'Record ID', 36, 36);
  if (!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(result)) fail(422, 'Use a valid record ID.');
  return result;
}
function integer(value, label, minimum = 0, maximum = 1_000_000_000) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(422, `${label} must be a whole number from ${minimum} to ${maximum}.`);
  return value;
}
function keys(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) fail(422, 'Unexpected request fields. Refresh the app and try again.');
}
async function body(request) {
  if (!request.headers.get('Content-Type')?.includes('application/json')) fail(415, 'Send JSON.');
  const reader = request.body?.getReader();
  const chunks = []; let length = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 65536) { await reader.cancel(); fail(413, 'The request is too large.'); }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(length); let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, 'The request is not valid JSON.'); }
}
async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
const rows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
const first = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const statement = (db, sql, ...args) => db.prepare(sql).bind(...args);
// Admins can do everything; everyone else needs the permission an admin gave them. Scanning needs none.
const allow = (member, permission, what) => { if (!member.admin && !member.permissions.includes(permission)) fail(403, `You don't have permission to ${what}. Ask an admin.`); };
const adminOnly = member => { if (!member.admin) fail(403, 'Only an admin can do this.'); };
const movementPermission = { receive: ['receive', 'receive stock'], transfer: ['produce', 'move stock between stages'], dispatch: ['dispatch', 'dispatch stock'], waste: ['waste', 'record waste'] };

async function snapshot(db, member) {
  const w = member.workspace_id;
  const [workspace, products, lots, balances, movements, members, inspections, qualityEvents, photos, pending] = await Promise.all([
    first(db, 'SELECT * FROM workspaces WHERE id=?', w),
    rows(db, 'SELECT * FROM products WHERE workspace_id=? ORDER BY name', w),
    rows(db, 'SELECT * FROM lots WHERE workspace_id=? ORDER BY created_at DESC,id DESC', w),
    rows(db, 'SELECT b.* FROM balances b JOIN lots l ON l.id=b.lot_id WHERE l.workspace_id=?', w),
    rows(db, 'SELECT * FROM movements WHERE workspace_id=? ORDER BY created_at DESC,id DESC LIMIT 100', w),
    rows(db, "SELECT name,portal_role AS role,created_at AS joined_at FROM users WHERE workspace_id=? AND status='active' AND deactivated_at IS NULL AND portal_role IS NOT NULL ORDER BY created_at", w),
    rows(db, 'SELECT * FROM inspections WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100', w),
    rows(db, 'SELECT * FROM quality_events WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100', w),
    rows(db, 'SELECT id,lot_id,content_type,size,actor_name,created_at FROM inspection_photos WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100', w),
    // Admins see how many account requests are waiting for them.
    member.admin ? first(db, "SELECT COUNT(*) AS n FROM users WHERE workspace_id=? AND status='pending' AND deactivated_at IS NULL", w).then(row => row.n) : 0,
  ]);
  return { workspace, member, products, lots, balances, movements, members, inspections, qualityEvents, photos, pending, serverTime: Date.now(), backend: 'Yarnflow / Cloudflare D1' };
}

async function saveMovement(db, member, data, reversal = false) {
  let record;
  if (reversal) {
    keys(data, ['id', 'movementId', 'note']);
    allow(member, 'reverse', 'reverse entries');
    const original = await first(db, 'SELECT * FROM movements WHERE id=? AND workspace_id=?', id(data.movementId), member.workspace_id);
    if (!original) fail(404, 'This movement was not found.');
    if (await first(db,'SELECT id FROM goods_receipts WHERE movement_id=?',original.id)) fail(409,'Reverse this purchase receipt from Incoming stock so the purchase order stays reconciled.');
    if (original.action === 'reverse') fail(409, 'A reversal cannot be reversed.');
    record = { id: id(data.id), lotId: original.lot_id, action: 'reverse', fromStage: original.to_stage,
      toStage: original.from_stage, grams: original.grams, cartons: original.cartons,
      cones: original.cones, note: text(data.note, 'Reversal reason', 3, 1000), reverses: original.id };
  } else {
    keys(data, ['id', 'lotId', 'action', 'grams', 'cartons', 'cones', 'stage', 'toStage', 'note']);
    if (!['receive', 'dispatch', 'transfer', 'waste'].includes(data.action)) fail(422, 'Choose a valid stock movement.');
    allow(member, ...movementPermission[data.action]);
    if (!STAGES.includes(data.stage) || (data.action === 'transfer' && (!STAGES.includes(data.toStage) || data.stage === data.toStage))) fail(422, 'Choose different, valid stock stages.');
    record = { id: id(data.id), lotId: id(data.lotId), action: data.action,
      fromStage: data.action === 'receive' ? null : data.stage,
      toStage: data.action === 'receive' ? data.stage : data.action === 'transfer' ? data.toStage : null,
      grams: integer(data.grams, 'Weight in grams', 1, 9_000_000_000_000),
      cartons: integer(data.cartons ?? 0, 'Cartons'), cones: integer(data.cones ?? 0, 'Cones'),
      note: text(data.note ?? '', 'Note', 0, 1000), reverses: null };
  }
  const digest = await hash(JSON.stringify(record));
  const previous = await first(db, 'SELECT * FROM movements WHERE id=? AND workspace_id=?', record.id, member.workspace_id);
  if (previous) {
    if (previous.request_hash !== digest) fail(409, 'This request ID was already used for different values.');
    return json(previous);
  }
  const lot = await first(db, 'SELECT * FROM lots WHERE id=? AND workspace_id=?', record.lotId, member.workspace_id);
  if (!lot) fail(404, 'This lot was not found in your workspace.');
  const now = Date.now();
  const queries = [statement(db, `INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    record.id, member.workspace_id, record.lotId, record.action, record.fromStage, record.toStage,
    record.grams, record.cartons, record.cones, record.note, member.user_id, member.name, record.reverses, digest, now)];
  for (const [stage, sign] of [[record.fromStage, -1], [record.toStage, 1]]) {
    if (stage) queries.push(statement(db, 'INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?,?,?)',
      uuid(), record.id, record.lotId, stage, sign * record.grams, sign * record.cartons, sign * record.cones));
  }
  try { await db.batch(queries); } catch (error) {
    // Another device can commit between our initial read and this atomic batch.
    const raced = await first(db, 'SELECT * FROM movements WHERE id=? AND workspace_id=?', record.id, member.workspace_id);
    if (raced?.request_hash === digest) return json(raced);
    if (/QC approval|held lot/i.test(String(error))) fail(409, 'QC approval is required before issuing raw stock or dispatching. Held lots cannot move.');
    fail(409, 'Stock changed, the quantities exceed available stock, or this entry was already reversed. Refresh and try again.');
  }
  return json(await first(db, 'SELECT * FROM movements WHERE id=?', record.id), 201);
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  const db = env.DB;
  if (!db) fail(503, 'The shared database is not connected. No stock was saved.');
  if (!['GET', 'POST'].includes(request.method)) fail(405, 'Method not allowed.');
  if (request.method === 'POST') {
    const origin = request.headers.get('Origin');
    if (origin !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') fail(403, 'Open Yarnflow directly before saving.');
  }
  if (path.startsWith('/api/auth/')) return authRoute(request, db, path);
  if (path.startsWith('/api/portal/')) return supplierPortal(request, env, path);
  if (path.startsWith('/api/buyer/')) return buyerPortalApi(request, env, path);
  const member = await currentMember(db, request);
  if (!member) fail(401, 'Sign in with your name and PIN.');
  const userId = member.user_id;
  if (request.method === 'GET' && path === '/api/workspace') return json(await snapshot(db, member));
  if (path.startsWith('/api/photos/')) {
    if (request.method !== 'GET') fail(405, 'Method not allowed.');
    const photo = await first(db, 'SELECT * FROM inspection_photos WHERE id=? AND workspace_id=?', id(path.slice('/api/photos/'.length)), member.workspace_id);
    if (!photo) fail(404, 'This photo was not found in your workspace.');
    if (!env.BUCKET) fail(503, 'Photo storage is unavailable.');
    const object = await env.BUCKET.get(photo.object_key);
    if (!object) fail(404, 'The photo object could not be found.');
    return new Response(object.body, { headers: { 'Content-Type': photo.content_type, 'Cache-Control': 'private,no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (path === '/api/photos' && request.method === 'POST') {
    allow(member, 'inspect', 'record inspections');
    if (!env.BUCKET) fail(503, 'Photo storage is unavailable. The inspection note is saved; retry the photo after reconnecting.');
    // Bound the whole multipart payload before parsing it, including chunked uploads.
    const reader = request.body?.getReader(); const chunks = []; let size = 0;
    if (!reader) fail(422, 'Choose a photo first.');
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 11 * 1024 * 1024) { await reader.cancel(); fail(413, 'Choose a photo smaller than 10 MB.'); }
      chunks.push(value);
    }
    const payload = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { payload.set(chunk, offset); offset += chunk.length; }
    const form = await new Request(request.url, { method: 'POST', headers: { 'Content-Type': request.headers.get('Content-Type') || '' }, body: payload }).formData().catch(() => fail(422, 'The upload is not a valid photo form.'));
    const inspectionId = id(form.get('inspectionId'));
    const inspection = await first(db, 'SELECT * FROM inspections WHERE id=? AND workspace_id=?', inspectionId, member.workspace_id);
    if (!inspection) fail(404, 'Save an inspection in your workspace before attaching a photo.');
    const file = form.get('photo');
    if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024) fail(422, 'Choose a JPEG, PNG or WebP photo up to 10 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
    const webp = new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP';
    const type = jpeg ? 'image/jpeg' : png ? 'image/png' : webp ? 'image/webp' : null;
    if (!type) fail(422, 'Unsupported photo. Use JPEG, PNG or WebP; HEIC is not supported.');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    const previous = await first(db, 'SELECT * FROM inspection_photos WHERE id=?', inspectionId);
    if (previous) { if (previous.content_hash !== digest) fail(409, 'This inspection already has a different photo. Create another inspection to preserve the evidence.'); return json({ id: inspectionId }); }
    const key = `${member.workspace_id}/${inspectionId}/${digest}`;
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type } });
    try { await statement(db, 'INSERT INTO inspection_photos(id,workspace_id,lot_id,object_key,content_type,content_hash,size,actor_name,created_at) VALUES(?,?,?,?,?,?,?,?,?)', inspectionId, member.workspace_id, inspection.lot_id, key, type, digest, file.size, member.name, Date.now()).run(); }
    catch (error) {
      const raced = await first(db, 'SELECT * FROM inspection_photos WHERE id=?', inspectionId);
      if (raced?.content_hash === digest) return json({ id: inspectionId });
      await env.BUCKET.delete(key);
      fail(409, 'Another photo was attached first. Create another inspection to preserve both photos.');
    }
    return json({ id: inspectionId }, 201);
  }
  const data = request.method === 'POST' ? await body(request) : null;
  const w = member.workspace_id;
  if (path === '/api/erp/inbound' || path.startsWith('/api/erp/receipts')) return receiving(request, env, member, path, data);
  if (path.startsWith('/api/erp/')) return (Object.hasOwn(erp, path.split('/')[3]) ? erp[path.split('/')[3]] : staffProcurement)(request, env, member, path, data);
  if (/^\/api\/lots\/[^/]+\/evidence$/.test(path) && request.method === 'GET') {
    const lotId = id(path.split('/')[3]);
    if (!await first(db, 'SELECT id FROM lots WHERE id=? AND workspace_id=?', lotId, w)) fail(404, 'This batch was not found in your workspace.');
    const offset = Math.max(0, Math.min(1000000, Math.floor(Number(url.searchParams.get('offset')) || 0)));
    const [inspections, qualityEvents, photos] = await Promise.all([
      rows(db, 'SELECT * FROM inspections WHERE workspace_id=? AND lot_id=? ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET ?', w, lotId, offset),
      rows(db, 'SELECT * FROM quality_events WHERE workspace_id=? AND lot_id=? ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET ?', w, lotId, offset),
      rows(db, 'SELECT id,lot_id,content_type,size,actor_name,created_at FROM inspection_photos WHERE workspace_id=? AND lot_id=? ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET ?', w, lotId, offset),
    ]);
    return json({ inspections, qualityEvents, photos, nextOffset: [inspections, qualityEvents, photos].some(items => items.length === 100) ? offset + 100 : null });
  }
  if (path === '/api/products' && data) {
    allow(member, 'catalog', 'add materials'); keys(data, ['sku', 'name', 'barcode']);
    const item = { id: uuid(), sku: text(data.sku, 'SKU', 1, 80), name: text(data.name, 'Material name', 2, 160), barcode: data.barcode ? text(data.barcode, 'Barcode', 1, 120) : null };
    try { await statement(db, 'INSERT INTO products(id,workspace_id,sku,name,barcode,created_at) VALUES(?,?,?,?,?,?)', item.id, w, item.sku, item.name, item.barcode, Date.now()).run(); }
    catch { fail(409, 'That SKU or barcode already exists in this workspace.'); }
    return json(item, 201);
  }
  if (path === '/api/lots' && data) {
    allow(member, 'catalog', 'add batches'); keys(data, ['productId', 'batch', 'supplier']);
    const productId = id(data.productId);
    if (!await first(db, 'SELECT id FROM products WHERE id=? AND workspace_id=?', productId, w)) fail(404, 'Material not found.');
    const lot = { id: uuid(), batch: text(data.batch, 'Batch / dye lot', 1, 100), supplier: text(data.supplier ?? '', 'Supplier', 0, 160) };
    try { await statement(db, 'INSERT INTO lots(id,workspace_id,product_id,batch,supplier,created_at) VALUES(?,?,?,?,?,?)', lot.id, w, productId, lot.batch, lot.supplier, Date.now()).run(); }
    catch { fail(409, 'This material already has that batch number. Use the existing lot.'); }
    return json(lot, 201);
  }
  if (path === '/api/movements' && data) return saveMovement(db, member, data);
  if (path === '/api/reversals' && data) return saveMovement(db, member, data, true);
  if (path === '/api/quality' && data) {
    allow(member, 'qc', 'record QC decisions'); keys(data, ['lotId', 'status', 'note']);
    const lotId = id(data.lotId); const note = text(data.note, 'Inspection reason', 3, 1000);
    if (!['approved', 'hold', 'uninspected'].includes(data.status)) fail(422, 'Choose a valid QC status.');
    if (!await first(db, 'SELECT id FROM lots WHERE id=? AND workspace_id=?', lotId, w)) fail(404, 'Lot not found.');
    await db.batch([
      statement(db, 'UPDATE lots SET quality=? WHERE id=? AND workspace_id=?', data.status, lotId, w),
      statement(db, 'INSERT INTO quality_events(id,workspace_id,lot_id,status,note,actor,actor_name,created_at) VALUES(?,?,?,?,?,?,?,?)', uuid(), w, lotId, data.status, note, userId, member.name, Date.now()),
    ]);
    return json({ saved: true });
  }
  if (path === '/api/inspections' && data) {
    allow(member, 'inspect', 'record inspections'); keys(data, ['id', 'lotId', 'labelText', 'note', 'result']);
    const inspectionId = id(data.id); const lotId = id(data.lotId);
    if (!await first(db, 'SELECT id FROM lots WHERE id=? AND workspace_id=?', lotId, w)) fail(404, 'Lot not found.');
    const labelText = text(data.labelText ?? '', 'Care label', 0, 4000);
    const note = text(data.note, 'Inspection note', 3, 2000);
    const result = data.result ?? null;
    if (result && (typeof result !== 'object' || !['PASS', 'FLAG', 'INSUFFICIENT_EVIDENCE'].includes(result.verdict) || typeof result.scan_id !== 'string' || typeof result.model_version !== 'string' || /stub/i.test(result.model_version))) fail(422, 'A real TexPilot result is required. Manual inspection is also available.');
    const existing = await first(db, 'SELECT id FROM inspections WHERE id=? AND workspace_id=?', inspectionId, w);
    if (existing) return json({ id: existing.id });
    await statement(db, 'INSERT INTO inspections(id,workspace_id,lot_id,label_text,note,source,result_json,actor,actor_name,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      inspectionId, w, lotId, labelText, note, result ? 'client-texpilot' : 'manual', result ? JSON.stringify(result) : null, userId, member.name, Date.now()).run();
    return json({ id: inspectionId, qualityChanged: false }, 201);
  }
  if (path === '/api/lookup' && request.method === 'GET') {
    const code = text(url.searchParams.get('code'), 'Barcode', 1, 200);
    const lotCode = code.startsWith('YF:') ? code.slice(3) : code;
    const exact = await first(db, 'SELECT id FROM lots WHERE workspace_id=? AND (id=? OR batch=?)', w, lotCode, code);
    if (code.startsWith('YF:') && !exact) fail(404, 'This lot is not in your workspace.');
    if (exact && code.startsWith('YF:')) return json({ lotId: exact.id });
    const matches = await rows(db, `SELECT l.id,l.batch,p.name,p.sku,l.quality FROM lots l JOIN products p ON p.id=l.product_id WHERE l.workspace_id=? AND (p.barcode=? OR p.sku=? OR l.batch=?) ORDER BY l.created_at DESC LIMIT 100`, w, code, code, code);
    if (!matches.length) fail(404, 'No matching lot. Add the material and batch first, or check the code.');
    return json(matches.length === 1 ? { lotId: matches[0].id } : { lots: matches });
  }
  if (path === '/api/movements' && request.method === 'GET') {
    const offset = Math.max(0, Math.min(1000000, Number(url.searchParams.get('offset')) || 0));
    return json({ movements: await rows(db, 'SELECT * FROM movements WHERE workspace_id=? ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET ?', w, offset) });
  }
  if (path === '/api/export' && request.method === 'GET') {
    adminOnly(member);
    const state = await snapshot(db, member);
    const offset = Math.max(0, Math.min(1000000, Number(url.searchParams.get('offset')) || 0));
    const [history, inspections, qualityEvents, photos] = await Promise.all([
      rows(db, 'SELECT * FROM movements WHERE workspace_id=? ORDER BY created_at ASC,id ASC LIMIT 1000 OFFSET ?', w, offset),
      rows(db, 'SELECT * FROM inspections WHERE workspace_id=? ORDER BY created_at ASC,id ASC LIMIT 1000 OFFSET ?', w, offset),
      rows(db, 'SELECT * FROM quality_events WHERE workspace_id=? ORDER BY created_at ASC,id ASC LIMIT 1000 OFFSET ?', w, offset),
      rows(db, 'SELECT * FROM inspection_photos WHERE workspace_id=? ORDER BY created_at ASC,id ASC LIMIT 1000 OFFSET ?', w, offset),
    ]);
    return json({ ...state, movements: history, inspections, qualityEvents, photos, exportedAt: new Date().toISOString(), nextOffset: [history, inspections, qualityEvents, photos].some(items => items.length === 1000) ? offset + 1000 : null });
  }
  if (path === '/api/model' && request.method === 'GET') {
    if (!env.TEXPILOT_API_URL) return json({ ready: false, reason: 'The trained TexPilot model is not deployed. Barcode scanning and manual inspection work independently.' });
    try {
      const response = await fetch(new URL('/api/v1/model', env.TEXPILOT_API_URL), { signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (!response.ok) fail(503, 'The model server is unavailable.');
      return json(await response.json());
    } catch { return json({ ready: false, reason: 'The configured model server could not be reached.' }); }
  }
  if (path === '/api/integrations/inventree' && request.method === 'GET') {
    adminOnly(member);
    if (!env.INVENTREE_URL || !env.INVENTREE_TOKEN) return json({ connected: false, reason: 'InvenTree is not deployed or connected. This workspace currently uses the Yarnflow shared ledger.' });
    try {
      const endpoint = new URL('/api/part/?limit=1', env.INVENTREE_URL);
      if (endpoint.protocol !== 'https:') fail(503, 'InvenTree needs an HTTPS origin.');
      const response = await fetch(endpoint, { headers: { Authorization: `Token ${env.INVENTREE_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(8000) });
      return json({ connected: response.ok, status: response.status, mode: 'connection-check-only', stockAuthority: 'Yarnflow shared ledger' });
    } catch { return json({ connected: false, reason: 'The configured InvenTree API could not be reached.' }); }
  }
  fail(404, 'API route not found.');
}


async function currentMember(db, request) {
  const token = sessionToken(request);
  if (!token) return null;
  const user = await first(db, "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active' AND u.deactivated_at IS NULL AND u.portal_role IS NOT NULL", await sha256(token), Date.now());
  if (!user) return null;
  return { user_id: user.id, workspace_id: user.workspace_id, name: user.name, role: user.portal_role, admin: user.portal_role === 'admin', permissions: ROLE_PERMISSIONS[user.portal_role] };
}
const pinOf = value => { if (!validPin(value)) fail(422, 'The PIN must be exactly 4 digits.'); return value; };
/** Sign in, sign out, and the names shown on the sign-in screen. */
async function authRoute(request, db, path) {
  if (path === '/api/auth/people' && request.method === 'GET') {
    const [workspace, people] = await Promise.all([first(db, 'SELECT name FROM workspaces ORDER BY created_at LIMIT 1'), rows(db, "SELECT name FROM users WHERE status='active' AND deactivated_at IS NULL AND portal_role IS NOT NULL ORDER BY name COLLATE NOCASE")]);
    return json({ workspace: workspace?.name ?? 'Yarnflow', people: people.map(row => row.name) });
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    const token = sessionToken(request);
    if (token) await statement(db, 'DELETE FROM sessions WHERE token_hash=?', await sha256(token)).run();
    return json({ signedOut: true }, 200, { 'Set-Cookie': sessionCookie(request, null) });
  }
  const data = request.method === 'POST' ? await body(request) : null;
  if (path === '/api/auth/login' && data) {
    keys(data, ['name', 'pin']);
    const pin = pinOf(data.pin);
    const user = await first(db, 'SELECT * FROM users WHERE name_key=?', nameKey(text(data.name, 'Name', 1, 60)));
    if (!user) fail(401, 'That name and PIN do not match.');
    const now = Date.now();
    if (user.locked_until > now) fail(429, `Too many wrong PINs. Try again in ${Math.ceil((user.locked_until - now) / 60000)} min.`);
    if (await pinHash(pin, user.pin_salt) !== user.pin_hash) {
      const attempts = user.failed_attempts + 1;
      const locked = attempts >= LOCK_AFTER;
      await statement(db, 'UPDATE users SET failed_attempts=?,locked_until=? WHERE id=?', locked ? 0 : attempts, locked ? now + LOCK_MS : 0, user.id).run();
      fail(locked ? 429 : 401, locked ? 'Too many wrong PINs. Try again in 5 min.' : 'That name and PIN do not match.');
    }
    if (user.deactivated_at !== null) fail(403, 'This account is deactivated. Ask an admin.');
    if (user.portal_role === null) fail(403, 'An admin must assign your role first.');
    if (user.status !== 'active') fail(403, 'An admin still needs to approve your account.');
    const token = randomHex(32);
    await db.batch([
      statement(db, 'UPDATE users SET failed_attempts=0,locked_until=0 WHERE id=?', user.id),
      statement(db, 'DELETE FROM sessions WHERE expires_at<?', now),
      statement(db, 'INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)', await sha256(token), user.id, now + SESSION_MS, now),
    ]);
    return json({ name: user.name }, 200, { 'Set-Cookie': sessionCookie(request, token) });
  }
  fail(404, 'API route not found.');
}

/** Whether this request comes from a signed-in person (the scanner pass-through asks before forwarding). */
export async function signedIn(request, env) {
  return !!env.DB && !!await currentMember(env.DB, request);
}

export async function inventoryApi(request, env) {
  try { return await route(request, env); } catch (error) {
    if (error instanceof Problem || error instanceof ErpProblem) return json({ error: error.message }, error.status);
    console.error('Inventory request failed:', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'The server could not complete this request. No success was confirmed. Refresh and try again.' }, 500);
  }
}
