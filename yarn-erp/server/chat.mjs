/** Team chat: one shared "Factory" thread per workspace, 1:1 direct threads, text, photos and batch cards. Access is by membership, so a direct thread stays between its two people. */
import { all, one, query, json, fail, keys, recordId, text, multiline, integer, viewer } from './erp-utils.mjs';
import { ROLES } from './auth.mjs';
import { readPhoto } from './photos.mjs';

const base = '/api/erp/chat', PHOTO = base + '/photo/';
const MESSAGE = 'id,thread_id,user_id,sender_name,body,photo_key,photo_type,ref_type,ref_id,ref_label,ref_json,created_at';
const now = () => Date.now();
const uuid = () => crypto.randomUUID();
const shape = m => ({ id: m.id, thread_id: m.thread_id, user_id: m.user_id, sender_name: m.sender_name, body: m.body, photo: m.photo_key != null,
  ref: m.ref_json ? JSON.parse(m.ref_json) : m.ref_type ? { type: m.ref_type, id: m.ref_id, label: m.ref_label } : null, created_at: m.created_at, seq: m.seq });
// Unread counts messages from other people newer than my read marker; a missing marker means nothing read yet.
const UNREAD = '(SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id=t.id AND m.user_id<>? AND m.created_at>COALESCE((SELECT c.last_read_at FROM chat_members c WHERE c.thread_id=t.id AND c.user_id=?),0))';
// Everyone in the workspace can see the team thread; a direct thread only shows to its members.
const VISIBLE = "t.workspace_id=? AND (t.kind='team' OR EXISTS(SELECT 1 FROM chat_members m WHERE m.thread_id=t.id AND m.user_id=?))";

async function ensureTeam(db, workspaceId) {
  await query(db, "INSERT INTO chat_threads(id,workspace_id,kind,key,created_at) VALUES(?,?,'team','team',?) ON CONFLICT(workspace_id,key) DO NOTHING", uuid(), workspaceId, now()).run();
}
// Any thread I cannot see is a 404, the same as one that does not exist.
async function threadFor(db, member, threadId) {
  const thread = await one(db, `SELECT t.* FROM chat_threads t WHERE t.id=? AND ${VISIBLE}`, threadId, member.workspace_id, member.user_id);
  if (!thread) fail(404, 'This chat was not found.');
  return thread;
}
const markRead = (db, threadId, userId) => query(db, 'INSERT INTO chat_members(thread_id,user_id,last_read_at) VALUES(?,?,?) ON CONFLICT(thread_id,user_id) DO UPDATE SET last_read_at=MAX(last_read_at,excluded.last_read_at)', threadId, userId, now()).run();

async function inbox(db, member) {
  const me = member.user_id, w = member.workspace_id;
  const threads = await all(db, `SELECT t.id,t.kind,t.last_message_at,t.created_at,${UNREAD} AS unread FROM chat_threads t WHERE ${VISIBLE} ORDER BY t.kind='team' DESC, COALESCE(t.last_message_at,t.created_at) DESC`, me, me, w, me);
  const list = [];
  for (const t of threads) {
    const other = t.kind === 'direct' ? await one(db, 'SELECT u.id,u.name,u.portal_role AS role FROM chat_members c JOIN users u ON u.id=c.user_id WHERE c.thread_id=? AND c.user_id<>?', t.id, me) : null;
    const last = await one(db, `SELECT rowid AS seq,${MESSAGE} FROM chat_messages WHERE thread_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1`, t.id);
    list.push({ id: t.id, kind: t.kind, title: t.kind === 'team' ? 'Factory' : other?.name ?? 'Chat', other, last: last ? shape(last) : null, unread: t.unread });
  }
  const people = await all(db, "SELECT id,name,portal_role AS role FROM users WHERE workspace_id=? AND status='active' AND deactivated_at IS NULL AND portal_role IS NOT NULL AND id<>? ORDER BY name", w, me);
  return { threads: list, people, unread: list.reduce((n, t) => n + t.unread, 0) };
}

async function messages(db, member, url) {
  const thread = await threadFor(db, member, recordId(url.searchParams.get('thread')));
  const pageSize = 200;
  let rows, hasMore = false;
  if (url.searchParams.has('beforeCursor')) {
    const cursor = integer(Number(url.searchParams.get('beforeCursor')), 'Before cursor', 1, Number.MAX_SAFE_INTEGER);
    const page = await all(db, `SELECT rowid AS seq,${MESSAGE} FROM chat_messages WHERE thread_id=? AND rowid<? ORDER BY rowid DESC LIMIT ?`, thread.id, cursor, pageSize + 1);
    hasMore = page.length > pageSize;
    rows = page.slice(0, pageSize).reverse();
  } else if (url.searchParams.has('afterCursor')) {
    const cursor = integer(Number(url.searchParams.get('afterCursor')), 'After cursor', 0, Number.MAX_SAFE_INTEGER);
    const page = await all(db, `SELECT rowid AS seq,${MESSAGE} FROM chat_messages WHERE thread_id=? AND rowid>? ORDER BY rowid LIMIT ?`, thread.id, cursor, pageSize + 1);
    hasMore = page.length > pageSize;
    rows = page.slice(0, pageSize);
  } else if (url.searchParams.has('after')) {
    // Keep timestamp polling for older clients; cursor polling avoids collisions when timestamps tie.
    const after = integer(Number(url.searchParams.get('after')), 'After', 0, 8_640_000_000_000_000);
    rows = await all(db, `SELECT rowid AS seq,${MESSAGE} FROM chat_messages WHERE thread_id=? AND created_at>=? ORDER BY created_at,rowid LIMIT ?`, thread.id, after, pageSize);
  } else {
    const page = await all(db, `SELECT rowid AS seq,${MESSAGE} FROM chat_messages WHERE thread_id=? ORDER BY rowid DESC LIMIT ?`, thread.id, pageSize + 1);
    hasMore = page.length > pageSize;
    rows = page.slice(0, pageSize).reverse();
  }
  await markRead(db, thread.id, member.user_id);
  return { messages: rows.map(shape), hasMore };
}

async function unreadCount(db, member) {
  const unread = await one(db, `SELECT COALESCE(SUM(${UNREAD}),0) AS unread FROM chat_threads t WHERE ${VISIBLE}`,
    member.user_id, member.user_id, member.workspace_id, member.user_id);
  return { unread: unread.unread };
}

async function direct(db, member, data) {
  keys(data, ['userId']);
  const w = member.workspace_id, me = member.user_id, userId = recordId(data.userId);
  if (userId === me) fail(422, 'Choose someone else to chat with.');
  const other = await one(db, "SELECT id FROM users WHERE id=? AND workspace_id=? AND status='active' AND deactivated_at IS NULL AND portal_role IS NOT NULL", userId, w);
  if (!other) fail(404, 'This person was not found in your workspace.');
  const key = [me, userId].sort().join(':');
  // Both inserts are no-ops when the thread already exists, so repeated or concurrent taps get the same thread.
  await db.batch([
    query(db, "INSERT INTO chat_threads(id,workspace_id,kind,key,created_at) VALUES(?,?,'direct',?,?) ON CONFLICT(workspace_id,key) DO NOTHING", uuid(), w, key, now()),
    ...[me, userId].map(person => query(db, 'INSERT INTO chat_members(thread_id,user_id) SELECT id,? FROM chat_threads WHERE workspace_id=? AND key=? ON CONFLICT(thread_id,user_id) DO NOTHING', person, w, key)),
  ]);
  return (await one(db, 'SELECT id FROM chat_threads WHERE workspace_id=? AND key=?', w, key)).id;
}

const SHARE_ROLES = {
  invoice: ['sales_manager'], sale: ['sales_manager'], buyer: ['sales_manager'],
  shipment: ['purchase_manager'], inspection: ['quality_inspector', 'supervisor'],
};
const SHARE_TYPES = ['invoice', 'shipment', 'sale', 'buyer', 'inspection', 'lot'];
function authorizeShare(member, type) {
  if (!SHARE_TYPES.includes(type)) fail(422, 'Choose an invoice, shipment, sale, buyer, inspection, or lot to share.');
  if (SHARE_ROLES[type]) viewer(member, ...SHARE_ROLES[type]);
}

// The reference list and the send resolver use the same workspace and role boundary.
async function shareOptions(db, member, type) {
  authorizeShare(member, type);
  const w = member.workspace_id;
  if (type === 'lot') return (await all(db, `SELECT l.id, p.name, l.batch, l.quality, l.inventory_type
    FROM lots l JOIN products p ON p.id=l.product_id AND p.workspace_id=l.workspace_id
    WHERE l.workspace_id=? ORDER BY l.created_at DESC,l.id DESC LIMIT 100`, w)).map(x => ({ id: x.id, type,
      label: `${x.name} · ${x.batch}`, detail: { quality: x.quality, inventoryType: x.inventory_type } }));
  if (type === 'invoice') return (await all(db, `SELECT i.id,i.number,b.name AS buyer,i.total_minor,i.currency,i.voided_at
    FROM invoice_ledger i JOIN buyers b ON b.id=i.buyer_id AND b.workspace_id=i.workspace_id
    WHERE i.workspace_id=? AND i.voided_at IS NULL ORDER BY i.issued_at DESC,i.id DESC LIMIT 100`, w)).map(x => ({ id: x.id, type,
      label: `${x.number} · ${x.buyer}`, detail: { buyer: x.buyer, totalMinor: x.total_minor, currency: x.currency, status: x.voided_at == null ? 'issued' : 'void' } }));
  if (type === 'shipment') return (await all(db, `SELECT s.id,s.bill_of_lading,s.status,s.stage,s.last_checked_at,s.eta,s.origin,s.destination,
      p.reference AS purchase_order,sup.name AS supplier
    FROM shipments s JOIN supplier_purchase_orders p ON p.id=s.purchase_order_id AND p.workspace_id=s.workspace_id
    JOIN suppliers sup ON sup.id=p.supplier_id AND sup.workspace_id=p.workspace_id
    WHERE s.workspace_id=? ORDER BY s.created_at DESC,s.id DESC LIMIT 100`, w)).map(x => ({ id: x.id, type,
      label: `${x.bill_of_lading} · ${x.purchase_order}`, detail: { supplier: x.supplier, stage: x.stage ?? x.status,
        lastCheckedAt: x.last_checked_at, eta: x.eta, origin: x.origin, destination: x.destination } }));
  if (type === 'sale') return (await all(db, `SELECT o.id,o.reference,o.status,b.name AS buyer,l.quantity_milli,l.unit,p.name AS product
    FROM sales_orders o JOIN buyers b ON b.id=o.buyer_id AND b.workspace_id=o.workspace_id
    JOIN sales_order_lines l ON l.sales_order_id=o.id AND l.workspace_id=o.workspace_id
    LEFT JOIN products p ON p.id=l.product_id AND p.workspace_id=l.workspace_id
    WHERE o.workspace_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT 100`, w)).map(x => ({ id: x.id, type,
      label: `${x.reference} · ${x.buyer}`, detail: { buyer: x.buyer, status: x.status, product: x.product, quantityMilli: x.quantity_milli, unit: x.unit } }));
  if (type === 'buyer') return (await all(db, `SELECT id,name,status FROM buyers WHERE workspace_id=? AND status!='archived'
    ORDER BY updated_at DESC,id DESC LIMIT 100`, w)).map(x => ({ id: x.id, type, label: x.name, detail: { status: x.status } }));
  return (await all(db, `SELECT i.id,i.status,i.report_status,i.rejection_status,i.accepted_milli,i.rejected_milli,l.reference AS lot,
      l.unit,p.name AS product FROM qc_inspections i JOIN qc_lots l ON l.id=i.lot_id AND l.workspace_id=i.workspace_id
      JOIN products p ON p.id=l.product_id AND p.workspace_id=l.workspace_id
      WHERE i.workspace_id=? ORDER BY i.created_at DESC,i.id DESC LIMIT 100`, w)).map(x => ({ id: x.id, type,
        label: `${x.product} · ${x.lot}`, detail: { status: x.status, reportStatus: x.report_status, rejectionStatus: x.rejection_status,
          acceptedMilli: x.accepted_milli, rejectedMilli: x.rejected_milli, unit: x.unit } }));
}

// Invoice shares carry the exact immutable source fields consumed by invoiceDocData so every chat
// recipient can download the same PDF, even if buyer or product records later change.
async function invoiceDocument(db, workspaceId, invoiceId) {
  const [invoice, lines, buyer, factory] = await Promise.all([
    one(db, `SELECT i.id,i.number,i.sales_order_id,o.reference AS order_reference,i.issued_at,i.due_at,i.currency,
        i.payment_terms,i.credit_days,i.subtotal_minor,i.tax_rate_bp,i.tax_minor,i.total_minor,i.lines_json,
        i.voided_at,i.void_reason,i.credited_minor,i.paid_minor,
        CASE WHEN i.voided_at IS NOT NULL THEN 0 ELSE MAX(0,i.total_minor-i.credited_minor-i.paid_minor) END AS outstanding_minor
      FROM invoice_ledger i JOIN sales_orders o ON o.id=i.sales_order_id AND o.workspace_id=i.workspace_id
      WHERE i.id=? AND i.workspace_id=?`, invoiceId, workspaceId),
    all(db, `SELECT l.sales_order_id,p.name AS product_name FROM sales_order_lines l
      LEFT JOIN products p ON p.id=l.product_id AND p.workspace_id=l.workspace_id
      WHERE l.sales_order_id=(SELECT sales_order_id FROM invoices WHERE id=? AND workspace_id=?) AND l.workspace_id=?`, invoiceId, workspaceId, workspaceId),
    one(db, `SELECT b.name,b.contact_name,b.city,b.email,b.phone FROM invoices i JOIN buyers b ON b.id=i.buyer_id AND b.workspace_id=i.workspace_id
      WHERE i.id=? AND i.workspace_id=?`, invoiceId, workspaceId),
    one(db, 'SELECT name FROM workspaces WHERE id=?', workspaceId),
  ]);
  if (!invoice || !buyer || !factory) return null;
  return { invoice, lines, buyer, factoryName: factory.name };
}

// Resolve current rows when sending and persist the safe display fields as a snapshot.
async function reference(db, member, value) {
  keys(value, ['type', 'id']);
  authorizeShare(member, value.type);
  const id = recordId(value.id), items = await shareOptions(db, member, value.type), saved = items.find(item => item.id === id);
  if (!saved) fail(404, 'This shared record was not found in your workspace.');
  if (value.type === 'invoice') saved.detail.document = await invoiceDocument(db, member.workspace_id, id);
  return { ...saved, capturedAt: now() };
}

async function post(db, member, threadId, { id = uuid(), body = '', ref = null, photo = null, requestHash = null }) {
  const legacyLot = ref?.type === 'lot';
  const m = { id, thread_id: threadId, user_id: member.user_id, sender_name: member.name, body, photo_key: photo?.key ?? null,
    photo_type: photo?.type ?? null, ref_type: legacyLot ? 'lot' : null, ref_id: legacyLot ? ref.id : null,
    ref_label: legacyLot ? ref.label : null, ref_json: ref ? JSON.stringify(ref) : null, request_hash: requestHash, created_at: now() };
  const existing = async () => one(db, `SELECT rowid AS seq,${MESSAGE},workspace_id,request_hash FROM chat_messages WHERE id=?`, id);
  const sameRequest = prior => {
    return !!prior && prior.workspace_id === member.workspace_id && prior.thread_id === threadId && prior.user_id === member.user_id
      && prior.request_hash === requestHash;
  };
  const prior = await existing();
  if (prior) { if (!sameRequest(prior)) fail(409, 'This message ID was already used for different content.'); return { message: shape(prior), created: false }; }
  try {
    await db.batch([
      query(db, 'INSERT INTO chat_messages(id,workspace_id,thread_id,user_id,sender_name,body,photo_key,photo_type,ref_type,ref_id,ref_label,ref_json,request_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        m.id, member.workspace_id, threadId, m.user_id, m.sender_name, body, m.photo_key, m.photo_type, m.ref_type, m.ref_id, m.ref_label, m.ref_json, m.request_hash, m.created_at),
      query(db, 'UPDATE chat_threads SET last_message_at=? WHERE id=?', m.created_at, threadId),
    ]);
  } catch (error) {
    const raced = await existing();
    if (raced) { if (!sameRequest(raced)) fail(409, 'This message ID was already used for different content.'); return { message: shape(raced), created: false }; }
    throw error;
  }
  const saved = await existing();
  return { message: shape(saved), created: true };
}

async function send(db, member, data) {
  keys(data, ['id', 'threadId', 'body', 'ref']);
  const id = recordId(data.id);
  const thread = await threadFor(db, member, recordId(data.threadId));
  let body = data.body == null ? '' : multiline(data.body, 'Message', 0, 2000);
  const bodyInput = body, refInput = data.ref == null ? null : (() => { keys(data.ref, ['type', 'id']); return { type: data.ref.type, id: recordId(data.ref.id) }; })();
  const requestHash = JSON.stringify([thread.id, bodyInput, refInput?.type ?? null, refInput?.id ?? null]);
  const existing = await one(db, `SELECT rowid AS seq,${MESSAGE},workspace_id,request_hash FROM chat_messages WHERE id=?`, id);
  if (existing) {
    if (existing.workspace_id !== member.workspace_id || existing.thread_id !== thread.id || existing.user_id !== member.user_id || existing.request_hash !== requestHash)
      fail(409, 'This message ID was already used for different content.');
    return json(shape(existing));
  }
  const ref = refInput == null ? null : await reference(db, member, refInput);
  if (!body && !ref) fail(422, 'Write a message or share a batch.');
  // The deployed chat table requires a body or legacy lot ref. Give a non-lot-only share a truthful caption.
  if (!body && ref?.type !== 'lot') body = `Shared ${ref.type}`;
  const result = await post(db, member, thread.id, { id, body, ref, requestHash });
  return json(result.message, result.created ? 201 : 200);
}

async function upload(request, env, member) {
  const { form, bytes, type } = await readPhoto(request);
  const thread = await threadFor(env.DB, member, recordId(form.get('threadId')));
  const caption = multiline(form.get('caption') ?? '', 'Caption', 0, 2000);
  const id = form.get('id') == null || form.get('id') === '' ? uuid() : recordId(form.get('id'));
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  const requestHash = JSON.stringify([thread.id, caption, 'photo', type, digest]);
  const prior = await one(env.DB, `SELECT rowid AS seq,${MESSAGE},workspace_id,request_hash FROM chat_messages WHERE id=?`, id);
  if (prior) {
    if (prior.workspace_id !== member.workspace_id || prior.thread_id !== thread.id || prior.user_id !== member.user_id || prior.request_hash !== requestHash)
      fail(409, 'This message ID was already used for different content.');
    return json(shape(prior));
  }
  // A unique object key per attempt prevents a racing retry from overwriting the winning photo.
  const key = `${member.workspace_id}/chat/${id}/${uuid()}`;
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type } });
  try {
    const result = await post(env.DB, member, thread.id, { id, body: caption, photo: { key, type }, requestHash });
    const saved = await one(env.DB, 'SELECT photo_key FROM chat_messages WHERE id=? AND workspace_id=?', id, member.workspace_id);
    if (saved?.photo_key !== key) await env.BUCKET.delete(key);
    return json(result.message, result.created ? 201 : 200);
  } catch (error) {
    await env.BUCKET.delete(key);
    throw error;
  }
}

async function photo(env, member, messageId) {
  const message = await one(env.DB, 'SELECT thread_id,photo_key,photo_type FROM chat_messages WHERE id=? AND workspace_id=? AND photo_key IS NOT NULL', recordId(messageId), member.workspace_id);
  if (!message) fail(404, 'This photo was not found in your chat.');
  await threadFor(env.DB, member, message.thread_id);
  const object = await env.BUCKET.get(message.photo_key);
  if (!object) fail(404, 'The photo object could not be found.');
  return new Response(object.body, { headers: { 'Content-Type': message.photo_type, 'Cache-Control': 'private,no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function chatApi(request, env, member, path, data) {
  const dbh = env.DB, url = new URL(request.url);
  viewer(member, ...ROLES);
  await ensureTeam(dbh, member.workspace_id);
  if (request.method === 'GET') {
    if (path === base) return json(await inbox(dbh, member));
    if (path === base + '/unread') return json(await unreadCount(dbh, member));
    if (path === base + '/messages') return json(await messages(dbh, member, url));
    if (path === base + '/share-options') {
      const type = text(url.searchParams.get('type'), 'Reference type', 1, 40);
      return json({ items: await shareOptions(dbh, member, type) });
    }
    if (path.startsWith(PHOTO)) return photo(env, member, path.slice(PHOTO.length));
  } else if (request.method === 'POST') {
    if (path === base + '/photos') return upload(request, env, member);
    if (path === base + '/direct') return json({ id: await direct(dbh, member, data) });
    if (path === base + '/send') return send(dbh, member, data);
    if (path === base + '/read') { keys(data, ['threadId']); const thread = await threadFor(dbh, member, recordId(data.threadId)); await markRead(dbh, thread.id, member.user_id); return json({ read: true }); }
  }
  fail(404, 'Chat route not found.');
}
