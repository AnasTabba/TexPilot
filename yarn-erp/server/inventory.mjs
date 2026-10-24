/** Shared inventory API. Sites supplies authenticated identity, D1 supplies durable SQL. */
const STAGES = ['raw', 'wip', 'finished', 'cops'];
const uuid = () => crypto.randomUUID();
class Problem extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new Problem(status, message); };
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
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
const owner = member => { if (member.role !== 'owner') fail(403, 'Only the workspace owner can do this.'); };

async function snapshot(db, member) {
  const w = member.workspace_id;
  const [workspace, products, lots, balances, movements, members, inspections, qualityEvents, photos] = await Promise.all([
    first(db, 'SELECT * FROM workspaces WHERE id=?', w),
    rows(db, 'SELECT * FROM products WHERE workspace_id=? ORDER BY name', w),
    rows(db, 'SELECT * FROM lots WHERE workspace_id=? ORDER BY created_at DESC,id DESC', w),
    rows(db, 'SELECT b.* FROM balances b JOIN lots l ON l.id=b.lot_id WHERE l.workspace_id=?', w),
    rows(db, 'SELECT * FROM movements WHERE workspace_id=? ORDER BY created_at DESC,id DESC LIMIT 100', w),
    rows(db, 'SELECT name,role,joined_at FROM memberships WHERE workspace_id=? ORDER BY joined_at', w),
    rows(db, 'SELECT * FROM inspections WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100', w),
    rows(db, 'SELECT * FROM quality_events WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100', w),
    rows(db, 'SELECT id,lot_id,content_type,size,actor_name,created_at FROM inspection_photos WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100', w),
  ]);
  return { workspace, member: { ...member, invite_hash: undefined }, products, lots, balances, movements, members, inspections, qualityEvents, photos, serverTime: Date.now(), backend: 'Yarnflow / Cloudflare D1' };
}

async function saveMovement(db, member, data, reversal = false) {
  let record;
  if (reversal) {
    keys(data, ['id', 'movementId', 'note']);
    owner(member);
    const original = await first(db, 'SELECT * FROM movements WHERE id=? AND workspace_id=?', id(data.movementId), member.workspace_id);
    if (!original) fail(404, 'This movement was not found.');
    if (original.action === 'reverse') fail(409, 'A reversal cannot be reversed.');
    record = { id: id(data.id), lotId: original.lot_id, action: 'reverse', fromStage: original.to_stage,
      toStage: original.from_stage, grams: original.grams, cartons: original.cartons,
      cones: original.cones, note: text(data.note, 'Reversal reason', 3, 1000), reverses: original.id };
  } else {
    keys(data, ['id', 'lotId', 'action', 'grams', 'cartons', 'cones', 'stage', 'toStage', 'note']);
    if (!['receive', 'dispatch', 'transfer', 'waste'].includes(data.action)) fail(422, 'Choose a valid stock movement.');
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
    if (/QC approval|held lot/i.test(String(error))) fail(409, 'This lot needs owner QC approval before dispatch or is on hold.');
    fail(409, 'Stock changed, the quantities exceed available stock, or this entry was already reversed. Refresh and try again.');
  }
  return json(await first(db, 'SELECT * FROM movements WHERE id=?', record.id), 201);
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  const db = env.DB;
  const userId = request.headers.get('oai-authenticated-user-id');
  if (!userId) fail(401, 'Sign in to access your inventory.');
  if (!db) fail(503, 'The shared database is not connected. No stock was saved.');
  if (!['GET', 'POST'].includes(request.method)) fail(405, 'Method not allowed.');
  if (request.method === 'POST') {
    const origin = request.headers.get('Origin');
    if (origin !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') fail(403, 'Open Yarnflow directly before saving.');
  }
  const displayName = (request.headers.get('oai-authenticated-user-email') || 'Signed-in operator').slice(0, 200);
  const member = await first(db, 'SELECT * FROM memberships WHERE user_id=?', userId);
  if (request.method === 'GET' && path === '/api/workspace') return json(member ? await snapshot(db, member) : { member: null, user: displayName });
  if (path.startsWith('/api/photos/')) {
    if (!member) fail(403, 'Create or join a workspace first.');
    if (request.method !== 'GET') fail(405, 'Method not allowed.');
    const photo = await first(db, 'SELECT * FROM inspection_photos WHERE id=? AND workspace_id=?', id(path.slice('/api/photos/'.length)), member.workspace_id);
    if (!photo) fail(404, 'This photo was not found in your workspace.');
    if (!env.BUCKET) fail(503, 'Photo storage is unavailable.');
    const object = await env.BUCKET.get(photo.object_key);
    if (!object) fail(404, 'The photo object could not be found.');
    return new Response(object.body, { headers: { 'Content-Type': photo.content_type, 'Cache-Control': 'private,no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (path === '/api/photos' && request.method === 'POST') {
    if (!member) fail(403, 'Create or join a workspace first.');
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
  if (path === '/api/workspaces' && data) {
    keys(data, ['name']);
    if (member) fail(409, 'You already belong to a workspace.');
    const name = text(data.name, 'Workspace name', 2, 100); const workspaceId = uuid(); const now = Date.now();
    await db.batch([
      statement(db, 'INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)', workspaceId, name, now),
      statement(db, 'INSERT INTO memberships(user_id,workspace_id,role,name,joined_at) VALUES(?,?,?,?,?)', userId, workspaceId, 'owner', displayName, now),
    ]);
    return json({ id: workspaceId, name }, 201);
  }
  if (path === '/api/join' && data) {
    keys(data, ['code']);
    if (member) fail(409, 'You already belong to a workspace.');
    const digest = await hash(text(data.code, 'Invite code', 8, 128));
    const invite = await first(db, 'SELECT * FROM invites WHERE token_hash=? AND expires_at>? AND remaining>0', digest, Date.now());
    if (!invite) fail(404, 'This invite is invalid, expired or already used. Ask the owner for a new one.');
    try {
      await statement(db, 'INSERT INTO memberships(user_id,workspace_id,role,name,invite_hash,joined_at) VALUES(?,?,?,?,?,?)',
        userId, invite.workspace_id, 'operator', displayName, digest, Date.now()).run();
    } catch { fail(409, 'The invite is no longer available or you already joined a workspace.'); }
    return json({ joined: true });
  }
  if (!member) fail(403, 'Create or join a workspace first.');
  const w = member.workspace_id;
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
  if (path === '/api/invites' && data) {
    keys(data, []); owner(member);
    const code = uuid().replaceAll('-', '') + uuid().slice(0, 8);
    const expiresAt = Date.now() + 72 * 3600_000;
    await statement(db, 'INSERT INTO invites(token_hash,workspace_id,expires_at,remaining,created_by) VALUES(?,?,?,?,?)', await hash(code), w, expiresAt, 1, userId).run();
    return json({ code, expiresAt }, 201);
  }
  if (path === '/api/products' && data) {
    owner(member); keys(data, ['sku', 'name', 'barcode']);
    const item = { id: uuid(), sku: text(data.sku, 'SKU', 1, 80), name: text(data.name, 'Material name', 2, 160), barcode: data.barcode ? text(data.barcode, 'Barcode', 1, 120) : null };
    try { await statement(db, 'INSERT INTO products(id,workspace_id,sku,name,barcode,created_at) VALUES(?,?,?,?,?,?)', item.id, w, item.sku, item.name, item.barcode, Date.now()).run(); }
    catch { fail(409, 'That SKU or barcode already exists in this workspace.'); }
    return json(item, 201);
  }
  if (path === '/api/lots' && data) {
    keys(data, ['productId', 'batch', 'supplier']);
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
    owner(member); keys(data, ['lotId', 'status', 'note']);
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
    keys(data, ['id', 'lotId', 'labelText', 'note', 'result']);
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
    owner(member);
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
    owner(member);
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

export async function inventoryApi(request, env) {
  try { return await route(request, env); } catch (error) {
    if (error instanceof Problem) return json({ error: error.message }, error.status);
    console.error('Inventory request failed:', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'The server could not complete this request. No success was confirmed. Refresh and try again.' }, 500);
  }
}
