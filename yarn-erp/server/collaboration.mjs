/** Operational collaboration for Yarnflow staff.
 *
 * Identity: every staff request is scoped by the router-resolved member object (session →
 * active user's workspace). Nothing here derives identity from request input. Supplier
 * threads use the server-resolved portal session row, exactly like supplierOperations.
 *
 * Store: references to records (cards) are stored as {type, id} pairs only. Card contents
 * are regenerated at read time from the live tables with the reader's current permissions,
 * so an access change applies to past messages and price data is never copied into chat.
 *
 * Honesty rules enforced here: no presence or read receipts (a member only has their own
 * unread position), sends are client-request-id idempotent, chat cannot mutate procurement,
 * stock, sales or production state, and operational events only enter this module through
 * documented hooks that re-read committed domain rows.
 */
import { all, one, query, json, fail, text, multiline, keys, integer, recordId, allow, audit, ErpProblem } from './erp-utils.mjs';
import { sha256 } from './auth.mjs';

const PREFIX = '/api/erp/collaboration';
const PORTAL_PREFIX = '/api/portal/collab';
const MESSAGE_MAX = 2000;
const SEND_PER_MINUTE = 30;
const SEARCH_PER_MINUTE = 30;
const ATTACHMENT_MAX = 10 * 1024 * 1024;
const ATTACHMENTS_PER_MESSAGE = 3;

const STAGES = ['raw', 'wip', 'finished', 'cops'];
// Link/read permissions always come from the shared permission vocabulary in server/auth.mjs.
const ENTITY_TYPES = {
  lot: { label: 'Batch', link: null, read: null },
  rfq: { label: 'RFQ', link: ['procure', 'suppliers'], read: ['procure', 'suppliers'] },
  purchase_order: { label: 'Purchase order', link: ['procure'], read: ['receive', 'procure', 'payments'], full: ['procure', 'payments'] },
  shipment: { label: 'Shipment', link: ['receive', 'procure'], read: ['receive', 'procure'] },
  production_batch: { label: 'Production batch', deferred: true, link: [], read: [] },
  sales_order: { label: 'Sales order', deferred: true, link: [], read: [] },
};
const NOTIFICATION_KINDS = ['low_stock', 'material_inspected', 'shipment_status', 'task_mention', 'chat_mention'];
// Recipients of each operational event kind, resolved with the shared permissions; task and
// chat mentions resolve to their exact people instead of a permission group.
const EVENT_RECIPIENTS = {
  low_stock: ['receive', 'produce'],
  material_inspected: ['receive', 'qc'],
  shipment_status: ['receive', 'procure'],
  task_mention: null,
  chat_mention: null,
};
const EMPH = title => `“${title}”`;
const uuid = () => crypto.randomUUID();
const canAny = (member, permissions) => !permissions || permissions.some(p => member.admin || member.permissions.includes(p));

/** Bound an SQL `... IN (?,?,?)` tail to a list of ids (returns '' for an empty list). */
const inIds = ids => ids.length ? ` AND id IN (${ids.map(() => '?').join(',')})` : '';

async function throttle(db, kind, subject, limit, windowMs) {
  const now = Date.now();
  const key = await sha256(`collab:${kind}:${subject}`);
  await query(db, `INSERT INTO portal_rate_limits(key,attempts,expires_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,
    expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END`, key, now + windowMs, now, now, now + windowMs).run();
  const row = await one(db, 'SELECT attempts, expires_at FROM portal_rate_limits WHERE key=?', key);
  if (row && row.attempts > limit) fail(429, 'Too many requests in a short time. Wait a moment and try again.');
}

const sameOrigin = (request, url) => {
  if (request.method !== 'POST') return;
  if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site')
    fail(403, 'Open Yarnflow directly before sending. Cross-site requests are not accepted.');
};

const cursor = (value, label) => value === null ? null : Math.max(0, integer(Number.isFinite(Number(value)) ? Math.floor(Number(value)) : -1, label, 0, 10_000_000));

/** Membership lookup answers 404 (not 403): non-members cannot even see a conversation exists. */
async function membership(db, member, conversationId) {
  const row = await one(db, `SELECT cm.role AS room_role, cm.muted, cm.last_read_gseq,
      c.id, c.workspace_id, c.kind, c.title, c.entity_type, c.entity_id, c.supplier_id, c.created_by, c.created_at
    FROM collab_members cm JOIN collab_conversations c ON c.id=cm.conversation_id
    WHERE cm.conversation_id=? AND cm.user_id=? AND cm.workspace_id=?`, conversationId, member.user_id, member.workspace_id);
  if (row) return row;
  // App admins retain oversight/management access to any conversation in their workspace,
  // even when they are not an explicit member; they are treated as a room admin there.
  if (member.admin) {
    const conv = await one(db, `SELECT 'admin' AS room_role, 0 AS muted, 0 AS last_read_gseq,
        id, workspace_id, kind, title, entity_type, entity_id, supplier_id, created_by, created_at
      FROM collab_conversations WHERE id=? AND workspace_id=?`, conversationId, member.workspace_id);
    if (conv) return conv;
  }
  fail(404, 'That conversation was not found in your workspace.');
}

const membersOfConversation = (db, workspaceId, conversationId) => all(db,
  `SELECT u.id, u.name, u.role, cm.role AS room_role, cm.created_at
   FROM collab_members cm JOIN users u ON u.id=cm.user_id
   WHERE cm.conversation_id=? AND cm.workspace_id=? AND u.status='active'
   ORDER BY u.name COLLATE NOCASE`, conversationId, workspaceId);

const keepsRoomAdmin = kind => kind === 'team' || kind === 'entity';

function parseMentions(body, people) {
  const escapeRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const found = [];
  const seen = new Set();
  for (const person of people) {
    if (seen.has(person.id)) continue;
    if (new RegExp(`@\\s*${escapeRe(person.name)}`, 'i').test(body)) { found.push(person); seen.add(person.id); }
  }
  return found.slice(0, 20);
}

const nextSeq = (db, conversationId) =>
  one(db, 'SELECT COALESCE(MAX(gseq),0)+1 AS seq FROM collab_messages WHERE conversation_id=?', conversationId).then(row => row.seq);

/* ------------------------------------------------------------------ record cards */

const restrictedCard = ref => ({ type: ref.type, id: ref.id, restricted: true, note: 'Record details are restricted for your access level.' });
const kg = grams => `${new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(grams / 1000)} kg`;
const stamp = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

async function resolveCards(db, member, refs) {
  const out = [];
  const wanted = new Map();
  for (const ref of refs.slice(0, 3)) {
    if (ref && ENTITY_TYPES[ref.type] && typeof ref.id === 'string' && /^[0-9a-fA-F-]{36}$/.test(ref.id) && !wanted.has(`${ref.type}:${ref.id}`))
      wanted.set(`${ref.type}:${ref.id}`, ref);
  }
  const groups = {};
  for (const ref of wanted.values()) (groups[ref.type] ??= []).push(ref);
  const w = member.workspace_id;
  for (const [type, list] of Object.entries(groups)) {
    const spec = ENTITY_TYPES[type];
    if (spec.deferred || !canAny(member, spec.read)) { for (const ref of list) out.push(spec.deferred ? { type, id: ref.id, deferred: true, reason: 'This module is not integrated yet.' } : restrictedCard(ref)); continue; }
    const ids = list.map(ref => ref.id);
    if (type === 'lot') {
      const rows = await all(db, `SELECT l.id,l.batch,l.quality,l.supplier,p.name AS product_name,p.sku,
          (SELECT COALESCE(SUM(b.grams),0) FROM balances b WHERE b.lot_id=l.id) AS grams
        FROM lots l JOIN products p ON p.id=l.product_id WHERE l.workspace_id=? AND l.id IN (${ids.map(() => '?').join(',')})`, w, ...ids);
      const byId = new Map(rows.map(row => [row.id, row]));
      for (const ref of list) {
        const row = byId.get(ref.id);
        out.push(row ? { type, id: row.id, title: `Batch ${row.batch}`, subtitle: `${row.product_name} · ${row.sku}`, badge: row.quality,
          facts: [['Supplier', row.supplier || 'Not recorded'], ['Weight', kg(row.grams)]], link: `#/inventory/${row.id}` }
          : { type, id: ref.id, missing: true });
      }
    } else if (type === 'rfq') {
      const rows = await all(db, `SELECT id,reference,title,status,quantity_milli,unit,deadline_at FROM procurement_rfqs WHERE workspace_id=?${inIds(ids)}`, w, ...ids);
      const byId = new Map(rows.map(row => [row.id, row]));
      for (const ref of list) {
        const row = byId.get(ref.id);
        out.push(row ? { type, id: row.id, title: row.reference, subtitle: row.title, badge: row.status,
          facts: [['Required', `${new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(row.quantity_milli / 1000)} ${row.unit}`], ['Bid deadline', stamp(row.deadline_at)]],
          link: '#/procurement' } : { type, id: ref.id, missing: true });
      }
    } else if (type === 'purchase_order') {
      const full = canAny(member, spec.full);
      const rows = await all(db, `SELECT p.id,p.reference,p.status,p.terms_snapshot,s.name AS supplier_name
        FROM supplier_purchase_orders p JOIN suppliers s ON s.id=p.supplier_id WHERE p.workspace_id=? AND p.id IN (${ids.map(() => '?').join(',')})`, w, ...ids);
      const byId = new Map(rows.map(row => [row.id, row]));
      for (const ref of list) {
        const row = byId.get(ref.id);
        if (!row) { out.push({ type, id: ref.id, missing: true }); continue; }
        const terms = JSON.parse(row.terms_snapshot);
        out.push({ type, id: row.id, title: row.reference, subtitle: row.supplier_name, badge: row.status, restricted: !full,
          facts: [['Status', row.status], ['Ordered', `${new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(terms.quantity_milli / 1000)} ${terms.unit}`],
            ...(full ? [['Rate', new Intl.NumberFormat('en', { style: 'currency', currency: terms.currency }).format(terms.price_minor / 100)],
              ['Payment terms', terms.payment_terms]] : [])],
          link: '#/procurement' });
      }
    } else if (type === 'shipment') {
      const rows = await all(db, `SELECT s.id,s.bill_of_lading,s.carrier,s.containers_json,s.dispatched_at,p.reference AS po_reference
        FROM procurement_shipments s JOIN supplier_purchase_orders p ON p.id=s.purchase_order_id WHERE s.workspace_id=? AND s.id IN (${ids.map(() => '?').join(',')})`, w, ...ids);
      const byId = new Map(rows.map(row => [row.id, row]));
      for (const ref of list) {
        const row = byId.get(ref.id);
        out.push(row ? { type, id: row.id, title: row.bill_of_lading, subtitle: row.carrier, badge: 'dispatched',
          facts: [['Purchase order', row.po_reference], ['Dispatched', stamp(row.dispatched_at)], ['Containers', String(JSON.parse(row.containers_json).length)]],
          link: '#/procurement' } : { type, id: ref.id, missing: true });
      }
    }
  }
  return out;
}

/** Validate entity references a sender attaches. Deferred modules fail with an explicit
 * "not integrated" message; foreign or forged IDs fail with "not found in this workspace". */
async function validateRefs(db, member, refs) {
  if (refs === undefined) return [];
  if (!Array.isArray(refs) || refs.length > 3 || refs.some(r => typeof r !== 'object' || r === null || typeof r.id !== 'string'))
    fail(422, 'Record cards must be at most three {type, id} references.');
  for (const ref of refs) {
    const spec = ENTITY_TYPES[ref.type];
    if (!spec) fail(422, 'Unknown record type for a linked card.');
    if (spec.deferred) fail(422, `${spec.label} conversations are not integrated yet. Wire the module first; no invented records are shown.`);
    if (!canAny(member, spec.link)) fail(403, 'Your account does not have permission to link these records. Ask an admin.');
  }
  const w = member.workspace_id;
  const checks = {
    lot: (db, id) => one(db, `SELECT COUNT(*) AS n FROM lots WHERE workspace_id=? AND id=?`, w, id),
    rfq: (db, id) => one(db, `SELECT COUNT(*) AS n FROM procurement_rfqs WHERE workspace_id=? AND id=?`, w, id),
    purchase_order: (db, id) => one(db, `SELECT COUNT(*) AS n FROM supplier_purchase_orders WHERE workspace_id=? AND id=?`, w, id),
    shipment: (db, id) => one(db, `SELECT COUNT(*) AS n FROM procurement_shipments WHERE workspace_id=? AND id=?`, w, id),
  };
  for (const ref of refs) {
    const spec = ENTITY_TYPES[ref.type];
    const found = await checks[ref.type](db, recordId(ref.id));
    if (!found.n) fail(404, `A linked ${spec.label.toLowerCase()} was not found in your workspace.`);
  }
  return refs.map(ref => ({ type: ref.type, id: recordId(ref.id) }));
}

/* ------------------------------------------------------------------ shaping */

async function shapeMessages(db, member, rows) {
  if (!rows.length) return [];
  const replyIds = [...new Set(rows.map(r => r.reply_to).filter(Boolean))];
  const replies = new Map((await all(db, `SELECT id, sender_name, body, removed_by FROM collab_messages
    WHERE workspace_id=?${inIds(replyIds)}`, member.workspace_id, ...replyIds)).map(r => [r.id, r]));
  const messageIds = rows.map(r => r.id);
  const placeholders = messageIds.map(() => '?').join(',');
  const mentionsBy = {};
  for (const row of await all(db, `SELECT m.message_id, m.mentioned_user_id, u.name FROM collab_mentions m
    JOIN users u ON u.id=m.mentioned_user_id WHERE m.message_id IN (${placeholders})`, ...messageIds))
    (mentionsBy[row.message_id] ??= []).push({ user_id: row.mentioned_user_id, name: row.name });
  const attachmentsBy = {};
  for (const row of await all(db, `SELECT id, message_id, file_name, size, content_type FROM collab_attachments
    WHERE workspace_id=? AND message_id IN (${placeholders})`, member.workspace_id, ...messageIds))
    (attachmentsBy[row.message_id] ??= []).push(row);
  const refsBy = {};
  const pairs = new Map();
  for (const row of rows) {
    let parsed = [];
    try { parsed = JSON.parse(row.references_json || '[]'); } catch { parsed = []; }
    if (parsed.length) for (const ref of parsed) { pairs.set(`${ref.type}:${ref.id}`, ref); (refsBy[row.id] ??= []).push(ref); }
  }
  const cards = await resolveCards(db, member, [...pairs.values()]);
  const cardMap = new Map(cards.map(card => [`${card.type}:${card.id}`, card]));
  return rows.map(row => ({
    id: row.id, gseq: row.gseq, sender_id: row.sender_id, sender_name: row.sender_name, created_at: row.created_at,
    body: row.removed_by ? '' : row.body,
    removed: !!row.removed_by,
    mentions: (mentionsBy[row.id] || []).slice(0, 20),
    references: (refsBy[row.id] || []).map(ref => cardMap.get(`${ref.type}:${ref.id}`) || { type: ref.type, id: ref.id }).slice(0, 3),
    reply: row.reply_to ? (reply => reply && (reply.id ? { id: reply.id, sender_name: reply.sender_name,
      snippet: reply.removed_by ? '(message removed)' : reply.body.slice(0, 140) } : null))(replies.get(row.reply_to)) : null,
    attachments: attachmentsBy[row.id] || [],
  }));
}

const UNREAD_QUERY = `
  SELECT c.id, c.kind, c.title, c.entity_type, c.entity_id, c.supplier_id, c.created_by, c.created_at,
    cm.role AS room_role, cm.muted, cm.last_read_gseq,
    (SELECT COUNT(*) FROM collab_messages m WHERE m.conversation_id=c.id AND m.gseq>cm.last_read_gseq AND m.sender_id<>cm.user_id) AS unread_count,
    (SELECT COUNT(*) FROM collab_mentions n JOIN collab_messages m ON m.id=n.message_id
       WHERE n.mentioned_user_id=cm.user_id AND m.conversation_id=c.id AND m.gseq>cm.last_read_gseq) AS unread_mentions,
    (SELECT COALESCE(MAX(created_at),0) FROM collab_messages m WHERE m.conversation_id=c.id) AS last_activity,
    (SELECT COUNT(*) FROM collab_members x WHERE x.conversation_id=c.id) AS member_count,
    (SELECT u2.name FROM collab_members x2 JOIN users u2 ON u2.id=x2.user_id
       WHERE x2.conversation_id=c.id AND x2.user_id<>cm.user_id LIMIT 1) AS partner_name
  FROM collab_conversations c JOIN collab_members cm ON cm.conversation_id=c.id AND cm.user_id=?
  WHERE c.workspace_id=? ORDER BY last_activity DESC, c.created_at DESC, c.id DESC`;

const displayTitle = row => row.kind === 'direct' ? (row.partner_name || 'Direct conversation') : row.title;
const safeJson = value => { try { return JSON.parse(value); } catch { return {}; } };

const shapeNotification = row => ({
  id: row.id, created_at: row.created_at, acknowledged_at: row.acknowledged_at, kind: row.kind,
  subject: row.subject, detail: safeJson(row.detail_json), entity_type: row.entity_type, entity_id: row.entity_id, link: row.link,
});

/* ------------------------------------------------------------------ operational events */

async function activeStaff(db, workspaceId, permissions) {
  const staff = await all(db, `SELECT id, role, permissions FROM users WHERE workspace_id=? AND status='active'`, workspaceId);
  return permissions && permissions.length
    ? staff.filter(person => person.role === 'admin' || JSON.parse(person.permissions).some(p => permissions.includes(p)))
    : staff;
}

/** Publish one operational event into the deduplicated outbox and fan out notifications.
 * Recipients are active staff resolved server-side by permission; kind-level mutes apply.
 * This writes only its own tables: no order, stock, receipt or task table is touched. */
export async function publishEvent(env, event) {
  const db = env.DB;
  if (!db) fail(503, 'The shared database is not connected.');
  if (!NOTIFICATION_KINDS.includes(event.kind)) fail(422, 'Unknown operational event kind.');
  const subject = text(event.subject ?? '', 'Event subject', 1, 200);
  const dedupeKey = text(event.dedupeKey ?? '', 'Event dedupe key', 1, 200);
  const detail = event.detail && typeof event.detail === 'object' && !Array.isArray(event.detail) ? event.detail : {};
  const detailJson = JSON.stringify(detail, (_key, value) => typeof value === 'string' ? value.slice(0, 300) : value).slice(0, 2000);
  if (!['product', 'lot', 'shipment', 'purchase_order', 'task', 'message'].includes(event.entityType)) fail(422, 'Unknown operational event entity type.');
  const entityId = recordId(event.entityId);
  if (event.link && !/^#\/[\w/-]{0,80}$/.test(event.link)) fail(422, 'Event link must be an in-app route.');
  const link = event.link || '';
  let recipients = event.recipientIds
    ? [...new Set((Array.isArray(event.recipientIds) ? event.recipientIds : []).filter(id => typeof id === 'string'))]
    : (await activeStaff(db, event.workspaceId, EVENT_RECIPIENTS[event.kind])).map(person => person.id);
  const muted = new Set((await all(db, 'SELECT user_id FROM collab_mutes WHERE workspace_id=? AND kind=?', event.workspaceId, event.kind)).map(r => r.user_id));
  const notified = recipients.filter(id => !muted.has(id));
  const eventId = uuid();
  await db.batch([
    query(db, `INSERT OR IGNORE INTO collab_events(id,workspace_id,kind,entity_type,entity_id,dedupe_key,subject,detail_json,link,recipients_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, eventId, event.workspaceId, event.kind, event.entityType, entityId, dedupeKey, subject, detailJson,
      link, JSON.stringify(notified), Date.now()),
    ...notified.map(userId => query(db, 'INSERT OR IGNORE INTO collab_notifications(id,workspace_id,event_id,user_id,created_at) VALUES(?,?,?,?,?)',
      uuid(), event.workspaceId, eventId, userId, Date.now())),
  ]).catch(async error => {
    const existing = await one(db, 'SELECT id FROM collab_events WHERE workspace_id=? AND dedupe_key=?', event.workspaceId, dedupeKey);
    if (existing) return { deduped: true, eventId: existing.id };
    throw error;
  });
  const stored = await one(db, 'SELECT id FROM collab_events WHERE workspace_id=? AND dedupe_key=?', event.workspaceId, dedupeKey);
  if (!stored) throw new Error('The operational event could not be stored.');
  return { deduped: stored.id !== eventId, eventId: stored.id, notified: notified.length, recipients };
}

/* ------------------------------------------------------------------ event hooks (integration contract) */
/* Call AFTER the matching domain transaction has committed; each hook re-reads the committed
 * row from the real table, so only real transitions create events. They never mutate domain
 * state and are idempotent per committed row. */

/** After movements commit: evaluate low-stock thresholds per material and stock stage.
 * The integration owner wires this behind inventory.mjs movement saves. */
export async function onStockMovement(env, { workspaceId, movementId }) {
  const db = env.DB;
  if (!db) fail(503, 'The shared database is not connected.');
  const w = recordId(workspaceId);
  const movement = await one(db, 'SELECT * FROM movements WHERE id=? AND workspace_id=?', recordId(movementId), w);
  if (!movement) fail(404, 'Movement not found in this workspace.');
  const results = [];
  for (const delta of await all(db, 'SELECT * FROM stock_deltas WHERE movement_id=?', movementId)) {
    const lot = await one(db, 'SELECT product_id FROM lots WHERE id=? AND workspace_id=?', delta.lot_id, w);
    if (!lot) continue;
    const threshold = await one(db, 'SELECT threshold_grams FROM collab_stock_thresholds WHERE workspace_id=? AND product_id=? AND stage=?',
      w, lot.product_id, delta.stage);
    if (!threshold || threshold.threshold_grams === 0) continue; // nothing to alert about here
    const level = (await one(db, `SELECT COALESCE(SUM(b.grams),0) AS total FROM balances b JOIN lots l ON l.id=b.lot_id
      WHERE l.workspace_id=? AND l.product_id=? AND b.stage=?`, w, lot.product_id, delta.stage)).total;
    const state = await one(db, 'SELECT * FROM collab_stock_alert_state WHERE workspace_id=? AND product_id=? AND stage=?',
      w, lot.product_id, delta.stage);
    if (level <= threshold.threshold_grams) {
      if (state?.alerting) { results.push({ kind: 'held', deduped: true }); continue; } // already alerting: never fan out again
      const generations = (state?.generations ?? 0) + 1;
      await query(db, `INSERT INTO collab_stock_alert_state(workspace_id,product_id,stage,alerting,generations,threshold_grams,since,cleared_at)
        VALUES(?,?,?,1,?,?,?,NULL)
        ON CONFLICT(workspace_id,product_id,stage) DO UPDATE SET alerting=1, generations=excluded.generations,
          threshold_grams=excluded.threshold_grams, since=excluded.since, cleared_at=NULL`,
        w, lot.product_id, delta.stage, generations, threshold.threshold_grams, Date.now()).run();
      const product = await one(db, 'SELECT name FROM products WHERE id=?', lot.product_id);
      results.push({ kind: 'low_stock', event: await publishEvent(env, {
        workspaceId: w, kind: 'low_stock', entityType: 'product', entityId: lot.product_id,
        dedupeKey: `low_stock:${lot.product_id}:${delta.stage}:${generations}`,
        subject: `Low stock: ${product?.name || 'Material'} · ${delta.stage} stage`,
        detail: { product_id: lot.product_id, stage: delta.stage, level_grams: level, threshold_grams: threshold.threshold_grams, movement_id: movementId },
        link: '#/inventory',
      }) });
    } else if (state?.alerting) { // restocked above the threshold: reset so a later crossing alerts again
      await query(db, 'UPDATE collab_stock_alert_state SET alerting=0, cleared_at=? WHERE workspace_id=? AND product_id=? AND stage=?',
        Date.now(), w, lot.product_id, delta.stage).run();
      results.push({ kind: 'restock_reset' });
    }
  }
  return { results };
}

/** After inspections commit: alert once for the first inspection of a purchased lot. */
export async function onInspectionCreated(env, { workspaceId, inspectionId }) {
  const db = env.DB;
  if (!db) fail(503, 'The shared database is not connected.');
  const w = recordId(workspaceId);
  const inspection = await one(db, `SELECT i.*, l.batch AS lot_batch, l.product_id, p.name AS product_name
    FROM inspections i JOIN lots l ON l.id=i.lot_id JOIN products p ON p.id=l.product_id
    WHERE i.id=? AND i.workspace_id=?`, recordId(inspectionId), w);
  if (!inspection) fail(404, 'Inspection not found in this workspace.');
  const received = await one(db, `SELECT id FROM movements WHERE lot_id=? AND action='receive' AND workspace_id=?`, inspection.lot_id, w);
  if (!received) return { skipped: 'not_a_purchase_receipt' };
  const earlier = await one(db, 'SELECT COUNT(*) AS n FROM inspections WHERE lot_id=? AND workspace_id=? AND created_at<?',
    inspection.lot_id, w, inspection.created_at);
  if (earlier.n > 0) return { deduped: 'this_lot_already_alerted' };
  return { event: await publishEvent(env, {
    workspaceId: w, kind: 'material_inspected', entityType: 'lot', entityId: inspection.lot_id,
    dedupeKey: `inspected:${inspection.lot_id}`,
    subject: `Material inspected: ${inspection.product_name} · batch ${inspection.lot_batch}`,
    detail: { lot_id: inspection.lot_id, inspection_id: inspectionId, inspector: inspection.actor_name, source: inspection.source },
    link: `#/inventory/${inspection.lot_id}`,
  }) };
}

/** After a supplier dispatch notice commits: notify receiving and buying staff. */
export async function onShipmentDispatched(env, { workspaceId, shipmentId }) {
  const db = env.DB;
  if (!db) fail(503, 'The shared database is not connected.');
  const w = recordId(workspaceId);
  const shipment = await one(db, `SELECT s.*, p.reference AS po_reference, sup.name AS supplier_name
    FROM procurement_shipments s JOIN supplier_purchase_orders p ON p.id=s.purchase_order_id
    JOIN suppliers sup ON sup.id=s.supplier_id
    WHERE s.id=? AND s.workspace_id=?`, recordId(shipmentId), w);
  if (!shipment) fail(404, 'Shipment not found in this workspace.');
  return { event: await publishEvent(env, {
    workspaceId: w, kind: 'shipment_status', entityType: 'shipment', entityId: shipmentId,
    dedupeKey: `shipment:${shipmentId}:dispatched`,
    subject: `Shipment dispatched: ${shipment.bill_of_lading} · ${shipment.supplier_name}`,
    detail: { purchase_order: shipment.po_reference, carrier: shipment.carrier, quantity_milli: shipment.quantity_milli },
    link: '#/procurement',
  }) };
}

/** After a task assignment in the production or sales module commits, its owner calls this
 * with the committed task facts; the assignee must be an active staff user. */
export async function onTaskMention(env, event) {
  const db = env.DB;
  if (!db) fail(503, 'The shared database is not connected.');
  const w = recordId(event.workspaceId);
  const assignee = await one(db, `SELECT id FROM users WHERE id=? AND workspace_id=? AND status='active'`,
    recordId(event.assigneeUserId), w);
  if (!assignee) fail(404, 'The assigned person is not an active staff member of this workspace.');
  return { event: await publishEvent(env, {
    workspaceId: w, kind: 'task_mention', entityType: 'task', entityId: recordId(event.taskId),
    dedupeKey: text(event.dedupeKey ?? '', 'Task event dedupe key', 4, 200),
    subject: text(event.title ?? '', 'Task title', 1, 200),
    detail: { task_ref: String(event.taskRef ?? '').slice(0, 120), by: String(event.actorId ?? '').slice(0, 60) },
    link: typeof event.link === 'string' && /^#\/[\w/-]{0,80}$/.test(event.link) ? event.link : '',
    recipientIds: [assignee.id],
  }) };
}

/* ------------------------------------------------------------------ staff API */

async function collaborationRoute(request, env, member, path, data) {
  const db = env.DB;
  if (!db) fail(503, 'The shared database is not connected.');
  if (!['GET', 'POST'].includes(request.method)) fail(405, 'Method not allowed.');
  const url = new URL(request.url);
  sameOrigin(request, url);
  const route = path.replace(/\/$/, '');
  if (!route.startsWith(PREFIX)) fail(404, 'Collaboration route not found.');
  const sub = route.slice(PREFIX.length) || '/workspace';
  const w = member.workspace_id;

  if (sub === '/workspace' || sub === '/sync') return json(await workspaceState(db, env, member, sub === '/workspace'));

  if (sub === '/people') {
    return json({ people: (await all(db, `SELECT id, name, role FROM users WHERE workspace_id=? AND status='active' ORDER BY name COLLATE NOCASE`, w))
      .map(person => ({ id: person.id, name: person.name, admin: person.role === 'admin', role: person.role })) });
  }

  if (sub === '/notifications') {
    const unackedOnly = url.searchParams.get('unacked') === '1';
    const rows = await all(db, `SELECT n.id, n.created_at, n.acknowledged_at, e.kind, e.subject, e.detail_json, e.entity_type, e.entity_id, e.link
      FROM collab_notifications n JOIN collab_events e ON e.id=n.event_id
      WHERE n.user_id=? AND n.workspace_id=? ${unackedOnly ? 'AND n.acknowledged_at IS NULL' : ''}
      ORDER BY n.created_at DESC LIMIT 60`, member.user_id, w);
    return json({ notifications: rows.map(shapeNotification) });
  }
  if (sub === '/notifications/ack' && data) {
    keys(data, ['ids']);
    if (!Array.isArray(data.ids) || !data.ids.length || data.ids.length > 100) fail(422, 'List the notifications to acknowledge.');
    const ids = data.ids.map(value => recordId(value));
    await query(db, `UPDATE collab_notifications SET acknowledged_at=? WHERE workspace_id=? AND user_id=? AND id IN (${ids.map(() => '?').join(',')})`,
      Date.now(), w, member.user_id, ...ids).run();
    return json({ acknowledged: true });
  }
  if (sub === '/mutes' && data) {
    keys(data, ['kind', 'muted']);
    if (!NOTIFICATION_KINDS.includes(data.kind)) fail(422, 'Choose a valid notification kind.');
    if (data.muted) {
      await query(db, 'INSERT OR IGNORE INTO collab_mutes(workspace_id,user_id,kind,muted_at) VALUES(?,?,?,?)', w, member.user_id, data.kind, Date.now()).run();
    } else {
      await query(db, 'DELETE FROM collab_mutes WHERE workspace_id=? AND user_id=? AND kind=?', w, member.user_id, data.kind).run();
    }
    return json({ saved: true, muted_kinds: (await all(db, 'SELECT kind FROM collab_mutes WHERE workspace_id=? AND user_id=?', w, member.user_id)).map(r => r.kind) });
  }

  if (sub === '/thresholds' && !data) {
    if (!canAny(member, ['receive', 'produce']) && !member.admin) fail(403, 'Stock thresholds are visible to admins and stock staff.');
    return json(await thresholdsView(db, w));
  }
  if (sub === '/thresholds' && data) {
    if (!member.admin) fail(403, 'Only an admin sets stock thresholds.');
    keys(data, ['productId', 'stage', 'thresholdGrams']);
    const stage = data.stage;
    if (!STAGES.includes(stage)) fail(422, 'Choose a stock stage.');
    const productId = recordId(data.productId);
    if (!await one(db, 'SELECT id FROM products WHERE id=? AND workspace_id=?', productId, w)) fail(404, 'Material not found in this workspace.');
    const grams = integer(data.thresholdGrams, 'Threshold in grams', 0, 9_000_000_000_000);
    if (grams === 0) {
      await db.batch([
        query(db, 'DELETE FROM collab_stock_thresholds WHERE workspace_id=? AND product_id=? AND stage=?', w, productId, stage),
        query(db, 'UPDATE collab_stock_alert_state SET alerting=0, cleared_at=? WHERE workspace_id=? AND product_id=? AND stage=?', Date.now(), w, productId, stage),
      ]);
      await audit(db, member, 'collab.threshold.removed', productId, { stage }).run();
      return json({ saved: true, removed: true });
    }
    await query(db, `INSERT INTO collab_stock_thresholds(workspace_id,product_id,stage,threshold_grams,updated_by,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id,product_id,stage) DO UPDATE SET threshold_grams=excluded.threshold_grams,
      updated_by=excluded.updated_by, updated_at=excluded.updated_at`, w, productId, stage, grams, member.user_id, Date.now()).run();
    await audit(db, member, 'collab.threshold.saved', productId, { stage, threshold_grams: grams }).run();
    return json({ saved: true });
  }

  if (sub === '/search') {
    const q = (url.searchParams.get('q') ?? '').trim();
    if (q.length < 2 || q.length > 80) fail(422, 'Search needs 2 to 80 characters.');
    await throttle(db, 'search', member.user_id, SEARCH_PER_MINUTE, 60_000);
    const term = q.replace(/[\\%_]/g, ch => '\\' + ch);
    const rows = await all(db, `SELECT m.id, m.gseq, m.body, m.created_at, m.sender_name, m.conversation_id, c.kind, c.title,
        (SELECT u2.name FROM collab_members x2 JOIN users u2 ON u2.id=x2.user_id
           WHERE x2.conversation_id=c.id AND x2.user_id<>cm.user_id LIMIT 1) AS partner_name
      FROM collab_messages m
      JOIN collab_conversations c ON c.id=m.conversation_id
      JOIN collab_members cm ON cm.conversation_id=c.id AND cm.user_id=?
      WHERE c.workspace_id=? AND m.removed_by IS NULL AND m.body LIKE ? ESCAPE '\\'
      ORDER BY m.gseq DESC LIMIT 50`, member.user_id, w, `%${term}%`);
    return json({ results: rows.slice(0, 50).map(row => {
      const index = row.body.indexOf(q);
      return {
        conversation_id: row.conversation_id, conversation_title: row.kind === 'direct' ? (row.partner_name || 'Direct conversation') : row.title,
        message_id: row.id, gseq: row.gseq, sender_name: row.sender_name, created_at: row.created_at,
        snippet: index >= 0 ? row.body.slice(Math.max(0, index - 40), index + 80) : row.body.slice(0, 80),
      };
    }) });
  }

  if (sub === '/conversations' && data) return await createConversation(db, member, data);

  const match = sub.match(/^\/conversations\/([0-9a-fA-F-]{36})(\/.*)?$/);
  if (match) {
    const conversationId = recordId(match[1]);
    const conv = await membership(db, member, conversationId);
    const people = await membersOfConversation(db, w, conversationId);
    const action = match[2] ?? '';

    if (action === '' && request.method === 'GET') {
      const partner = people.find(person => person.id !== member.user_id);
      return json({
        conversation: { id: conv.id, kind: conv.kind,
          title: conv.kind === 'direct' ? (partner?.name || 'Direct conversation') : conv.title,
          entity_type: conv.entity_type, entity_id: conv.entity_id, supplier_id: conv.supplier_id,
          created_at: conv.created_at, member_count: people.length, muted: !!conv.muted, room_role: conv.room_role },
        members: people,
        last_read_gseq: conv.last_read_gseq,
      });
    }

    if (action === '/messages') {
      if (request.method === 'GET') return json(await messagePage(db, member, conv, url));
      const sent = await sendMessage(db, member, conv, data, people);
      return json(sent, sent.deduped ? 200 : 201);
    }

    if (action === '/read' && data) {
      keys(data, ['gseq']);
      const maxGseq = (await one(db, 'SELECT COALESCE(MAX(gseq),0) AS n FROM collab_messages WHERE conversation_id=?', conv.id)).n;
      const gseq = Math.min(integer(data.gseq, 'Read position', 0, 10_000_000), maxGseq);
      await query(db, 'UPDATE collab_members SET last_read_gseq=MAX(last_read_gseq,?) WHERE conversation_id=? AND user_id=?', gseq, conv.id, member.user_id).run();
      return json({ saved: true, last_read_gseq: gseq });
    }
    if (action === '/mute' && data) {
      keys(data, ['muted']);
      await query(db, 'UPDATE collab_members SET muted=? WHERE conversation_id=? AND user_id=?', data.muted ? 1 : 0, conv.id, member.user_id).run();
      return json({ saved: true, muted: !!data.muted });
    }

    if (action === '/members/add' && data) {
      keys(data, ['userId', 'role']);
      if (conv.kind === 'direct') fail(409, 'Direct conversations always have exactly two members.');
      if (conv.kind === 'external') { if (!canAny(member, ['suppliers'])) fail(403, 'Only staff with Supplier access manage external threads.'); }
      else if (conv.room_role !== 'admin' && !member.admin) fail(403, 'Only the room admin (or an admin) can add members.');
      const target = await one(db, 'SELECT id, workspace_id, status FROM users WHERE id=?', recordId(data.userId));
      if (!target || target.workspace_id !== w || target.status !== 'active') fail(404, 'That person is not an active team member of this workspace.');
      const role = data.role === 'admin' ? 'admin' : 'member';
      const added = await query(db, `INSERT OR IGNORE INTO collab_members(conversation_id,workspace_id,user_id,role,added_by,created_at) VALUES(?,?,?,?,?,?)`,
        conv.id, w, target.id, role, member.user_id, Date.now()).run();
      if (!added.meta.changes) fail(409, 'That person is already in this conversation.');
      await audit(db, member, 'collab.member.added', target.id, { conversation: conv.id, kind: conv.kind, role }).run();
      return json({ added: true });
    }

    if (action === '/members/remove' && data) {
      keys(data, ['userId']);
      const target = recordId(data.userId);
      if (conv.kind === 'direct') fail(409, 'Direct conversations always have exactly two members.');
      if (target !== member.user_id && conv.kind === 'external' && !canAny(member, ['suppliers']) && conv.room_role !== 'admin')
        fail(403, 'Only staff with Supplier access or the room admin remove external thread members.');
      if (target !== member.user_id && conv.kind !== 'external' && conv.room_role !== 'admin' && !member.admin)
        fail(403, 'Only the room admin (or an admin) can remove members.');
      if (target === member.user_id && conv.room_role === 'admin') {
        const admins = (await one(db, `SELECT COUNT(*) AS n FROM collab_members WHERE conversation_id=? AND role='admin'`, conv.id)).n;
        if (keepsRoomAdmin(conv.kind) && admins <= 1) fail(409, 'Promote another member to room admin before leaving.');
        if (conv.kind === 'external') {
          const staffLeft = (await one(db, 'SELECT COUNT(*) AS n FROM collab_members WHERE conversation_id=? AND user_id<>?', conv.id, member.user_id)).n;
          if (staffLeft < 1) fail(409, 'Add another staff member before leaving an external thread.');
        }
      }
      const removed = await query(db, 'DELETE FROM collab_members WHERE conversation_id=? AND user_id=?', conv.id, target).run();
      if (!removed.meta.changes) fail(404, 'That person is not a member.');
      await audit(db, member, 'collab.member.removed', target, { conversation: conv.id, kind: conv.kind, self: target === member.user_id }).run();
      return json({ removed: true });
    }

    if (action === '/members/role' && data) {
      keys(data, ['userId', 'role']);
      if (conv.kind === 'direct') fail(409, 'Direct conversations have no roles.');
      if (conv.room_role !== 'admin' && !member.admin) fail(403, 'Only the room admin (or an admin) can change member roles.');
      const role = data.role;
      if (!['admin', 'member'].includes(role)) fail(422, 'Choose admin or member.');
      if (role === 'member') {
        const admins = (await one(db, `SELECT COUNT(*) AS n FROM collab_members WHERE conversation_id=? AND role='admin'`, conv.id)).n;
        const targetRow = people.find(person => person.id === recordId(data.userId));
        if (keepsRoomAdmin(conv.kind) && admins <= 1 && targetRow?.room_role === 'admin') fail(409, 'Keep at least one room admin.');
      }
      const changed = await query(db, 'UPDATE collab_members SET role=? WHERE conversation_id=? AND user_id=?', role, conv.id, recordId(data.userId)).run();
      if (!changed.meta.changes) fail(404, 'That person is not a member.');
      await audit(db, member, 'collab.member.role', recordId(data.userId), { conversation: conv.id, role }).run();
      return json({ saved: true });
    }
    fail(404, 'Collaboration route not found.');
  }

  if (sub === '/messages' && url.searchParams.get('id')) {
    // One's own message lookup by durable request ID: a device that reopens mid-send can reconcile.
    const row = await one(db, `SELECT m.* FROM collab_messages m
      JOIN collab_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=?
      WHERE m.id=? AND m.workspace_id=?`, member.user_id, recordId(url.searchParams.get('id')), w);
    if (!row) fail(404, 'Message not found in your conversations.');
    return json({ message: (await shapeMessages(db, member, [row]))[0] });
  }

  const removeMatch = sub.match(/^\/messages\/([0-9a-fA-F-]{36})\/remove$/);
  if (removeMatch && data) {
    keys(data, ['reason']);
    const id = recordId(removeMatch[1]);
    const row = await one(db, `SELECT m.*, c.kind FROM collab_messages m
      JOIN collab_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=?
      JOIN collab_conversations c ON c.id=m.conversation_id
      WHERE m.id=? AND m.workspace_id=?`, member.user_id, id, w);
    if (!row) fail(404, 'Message not found in your conversations.');
    const conv = await membership(db, member, row.conversation_id);
    const self = row.sender_id === member.user_id;
    if (!self && conv.room_role !== 'admin' && !member.admin) fail(403, 'Only the sender or a room admin can remove a message.');
    if (row.removed_by) fail(409, 'This message was already removed.');
    const reason = self && (data.reason === undefined || data.reason === '')
      ? 'Retracted by the sender.'
      : multiline(data.reason ?? '', 'Removal reason', 3, 300);
    await query(db, 'UPDATE collab_messages SET body=\'\', removed_by=?, removed_at=?, removed_reason=? WHERE id=?',
      member.user_id, Date.now(), reason, id).run();
    await audit(db, member, 'collab.message.removed', id, { conversation: row.conversation_id, reason, moderator: !self }).run();
    return json({ removed: true });
  }

  if (sub === '/attachments' && request.method === 'POST') return await uploadAttachment(request, env, db, member, url);

  const attachGet = sub.match(/^\/attachments\/([0-9a-fA-F-]{36})$/);
  if (attachGet && request.method === 'GET') {
    const row = await one(db, 'SELECT * FROM collab_attachments WHERE id=? AND workspace_id=?', recordId(attachGet[1]), w);
    if (!row) fail(404, 'Attachment not found in your workspace.');
    await membership(db, member, row.conversation_id); // download authorization is a live membership check
    if (!env.BUCKET) fail(503, 'File storage is not configured for this site. Ask an admin to add a BUCKET (R2) binding.');
    const object = await env.BUCKET.get(row.object_key);
    if (!object) fail(404, 'The stored file could not be found.');
    return new Response(object.body, { headers: {
      'Content-Type': row.content_type, 'Cache-Control': 'private,no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': row.content_type === 'application/pdf'
        ? `attachment; filename="${row.file_name.replace(/["\\]/g, '')}"`
        : `inline; filename="${row.file_name.replace(/["\\]/g, '')}"`,
    } });
  }

  fail(404, 'Collaboration route not found.');
}

/* ------------------------------------------------------------------ attachments */

const sniffType = bytes => {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'; // JPEG magic
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png'; // PNG magic
  // Content type only ever comes from these magic bytes, never from the claimed file name.
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70) return 'application/pdf'; // %PDF
  return null;
};

async function uploadAttachment(request, env, db, member, url) {
  if (!env.BUCKET) fail(503, 'File storage (BUCKET) is not configured for this site. Ask an admin to set it up; attachments cannot be uploaded yet.');
  const messageIdQuery = url.searchParams.get('messageId') ?? '';
  if (messageIdQuery.length !== 36) fail(422, 'Use a valid message ID.');
  const conversationId = url.searchParams.get('conversationId') ?? '';
  if (conversationId.length !== 36) fail(422, 'Use a valid conversation ID.');
  const conv = await membership(db, member, conversationId);
  const message = await one(db, 'SELECT id, conversation_id, sender_id FROM collab_messages WHERE id=? AND workspace_id=?',
    messageIdQuery, member.workspace_id);
  if (!message || message.conversation_id !== conv.id) fail(404, 'Message not found in this conversation.');
  if (message.sender_id !== member.user_id) fail(403, 'Only the sender attaches files to their message.');
  if ((await one(db, 'SELECT COUNT(*) AS n FROM collab_attachments WHERE message_id=?', message.id)).n >= ATTACHMENTS_PER_MESSAGE)
    fail(409, `A message can carry up to ${ATTACHMENTS_PER_MESSAGE} attachments.`);
  const reader = request.body?.getReader();
  if (!reader) fail(422, 'Choose a file to attach.');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > ATTACHMENT_MAX + 1_048_576) { await reader.cancel(); fail(413, 'Attachments are limited to 10 MB.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const form = await new Request(url.href, { method: 'POST',
    headers: { 'Content-Type': request.headers.get('Content-Type') || '' }, body: bytes }).formData()
    .catch(() => fail(422, 'The attachment upload is not a valid file form.'));
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0 || file.size > ATTACHMENT_MAX) fail(422, 'Choose a file up to 10 MB.');
  // Content-type comes from magic bytes of the file itself, never from the claimed name or form header.
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(fileBytes);
  if (!type) fail(422, 'Only JPEG, PNG, WebP images or PDF documents are supported.');
  const name = sanitizeName(form.get('name'));
  const digest = hex(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', fileBytes))));
  const key = `${member.workspace_id}/collab/${conv.id}/${message.id}/${digest}`;
  const existing = await one(db, 'SELECT * FROM collab_attachments WHERE object_key=?', key);
  if (existing) return json({ attachment: { id: existing.id, message_id: message.id } });
  await env.BUCKET.put(key, fileBytes, { httpMetadata: { contentType: type } });
  const attachId = uuid();
  try {
    await query(db, `INSERT INTO collab_attachments(id,workspace_id,conversation_id,message_id,object_key,content_type,file_name,size,actor_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, attachId, member.workspace_id, conv.id, message.id, key, type, name, fileBytes.length, member.user_id, Date.now()).run();
  } catch (error) {
    await env.BUCKET.delete(key).catch(() => {});
    throw error;
  }
  return json({ attachment: { id: attachId, message_id: message.id, file_name: name, content_type: type, size: fileBytes.length } }, 201);
}

const hex = bytes => bytes.map(byte => byte.toString(16).padStart(2, '0')).join('');
const sanitizeName = value => {
  const safe = String(value ?? '').replace(/[\\/"\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return safe || 'attachment';
};

/* ------------------------------------------------------------------ conversation creation */

function staffIdList(memberIds) {
  if (memberIds === undefined) return [];
  if (!Array.isArray(memberIds) || memberIds.length > 100 || memberIds.some(v => typeof v !== 'string'))
    fail(422, 'Name up to 100 teammates by their user IDs.');
  return memberIds;
}

async function validateMemberIds(db, workspaceId, ids, exceptUserId) {
  const unique = [...new Set(ids.map(id => recordId(id)))].filter(id => id !== exceptUserId);
  if (unique.length !== ids.filter(id => id !== exceptUserId).length) fail(409, 'The same person was named twice.');
  if (!unique.length) return [];
  const found = await all(db, `SELECT id FROM users WHERE workspace_id=? AND status='active' AND id IN (${unique.map(() => '?').join(',')})`,
    workspaceId, ...unique);
  if (found.length !== unique.length) fail(404, 'A person you named is not an active team member of this workspace.');
  return unique;
}

async function insertConversation(db, conversation, creatorRole, memberIds) {
  const queries = [
    query(db, `INSERT INTO collab_conversations(id,workspace_id,kind,title,entity_type,entity_id,supplier_id,direct_key,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`,
      conversation.id, conversation.workspaceId, conversation.kind, conversation.title ?? '', conversation.entity_type ?? null,
      conversation.entity_id ?? null, conversation.supplier_id ?? null, conversation.direct_key ?? null,
      conversation.created_by, conversation.created_at),
    query(db, 'INSERT INTO collab_members(conversation_id,workspace_id,user_id,role,added_by,created_at) VALUES(?,?,?,?,?,?)',
      conversation.id, conversation.workspaceId, conversation.created_by, creatorRole, conversation.created_by, conversation.created_at),
    ...memberIds.map(userId => query(db, 'INSERT INTO collab_members(conversation_id,workspace_id,user_id,role,added_by,created_at) VALUES(?,?,?,?,?,?)',
      conversation.id, conversation.workspaceId, userId, 'member', conversation.created_by, conversation.created_at)),
  ];
  await db.batch(queries);
}

async function createConversation(db, member, data) {
  keys(data, ['id', 'kind', 'title', 'memberIds', 'entityType', 'entityId', 'supplierId']);
  const w = member.workspace_id;
  const id = recordId(data.id);
  const now = Date.now();
  const existing = await one(db, 'SELECT * FROM collab_conversations WHERE id=? ', id);
  if (existing) {
    if (existing.workspace_id !== w || existing.kind !== data.kind) fail(409, 'This request ID was already used for a different conversation.');
    const joined = await one(db, 'SELECT user_id FROM collab_members WHERE conversation_id=? AND user_id=?', id, member.user_id);
    if (!joined) fail(409, 'This conversation ID already exists. Choose a new one to open your own conversation.');
    return conversationShape(existing);
  }
  const rawIds = staffIdList(data.memberIds);
  const validIds = await validateMemberIds(db, w, rawIds, member.user_id);

  if (data.kind === 'direct') {
    if (validIds.length !== 1) fail(422, 'Choose exactly one teammate to start a direct conversation.');
    const directKey = [member.user_id, validIds[0]].sort().join(':');
    const clash = await one(db, 'SELECT c.id FROM collab_conversations c WHERE c.workspace_id=? AND c.direct_key=?', w, directKey);
    if (clash) return conversationShape(await one(db, 'SELECT * FROM collab_conversations WHERE id=?', clash.id));
    await insertConversation(db, { id, workspaceId: w, kind: 'direct', direct_key: directKey, created_by: member.user_id, created_at: now }, 'member', validIds);
    await audit(db, member, 'collab.room.created', id, { kind: 'direct', members: [member.user_id, validIds[0]] }).run();
    return conversationShape(await one(db, 'SELECT * FROM collab_conversations WHERE id=?', id), 201);
  }

  if (data.kind === 'team') {
    if (!member.admin) fail(403, 'Only an admin can create team rooms.');
    const title = text(data.title ?? '', 'Room name', 3, 120);
    await insertConversation(db, { id, workspaceId: w, kind: 'team', title, created_by: member.user_id, created_at: now }, 'admin', validIds);
    await audit(db, member, 'collab.room.created', id, { kind: 'team', title, members: validIds }).run();
    return conversationShape(await one(db, 'SELECT * FROM collab_conversations WHERE id=?', id), 201);
  }

  if (data.kind === 'entity') {
    const spec = ENTITY_TYPES[data.entityType];
    if (!spec) fail(422, 'Choose a record type to link the conversation to.');
    if (spec.deferred) fail(422, `${spec.label} conversations are not integrated yet. A module owner must wire this first; no invented records are shown.`);
    const entityId = recordId(data.entityId);
    const permission = data.entityType === 'rfq' ? ['procure', 'suppliers']
      : data.entityType === 'shipment' ? ['receive', 'procure']
      : data.entityType === 'purchase_order' ? ['procure'] : null;
    if (permission && !canAny(member, permission)) fail(403, 'Your account does not have permission to open a conversation about this record.');
    const label = await entityLabel(db, w, data.entityType, entityId);
    if (!label) fail(404, `A linked ${spec.label.toLowerCase()} was not found in your workspace.`);
    const title = `${spec.label} · ${label}`.slice(0, 120);
    await insertConversation(db, { id, workspaceId: w, kind: 'entity', entity_type: data.entityType, entity_id: entityId,
      title, created_by: member.user_id, created_at: now }, 'admin', validIds);
    await audit(db, member, 'collab.room.created', id, { kind: 'entity', entity_type: data.entityType, entity_id: entityId, members: validIds }).run();
    return conversationShape(await one(db, 'SELECT * FROM collab_conversations WHERE id=?', id), 201);
  }

  if (data.kind === 'external') {
    if (!canAny(member, ['suppliers'])) fail(403, 'Only staff with Supplier access open supplier chat threads.');
    const supplierId = recordId(data.supplierId);
    const supplier = await one(db, 'SELECT id, name, status FROM suppliers WHERE id=? AND workspace_id=?', supplierId, w);
    if (!supplier) fail(404, 'Supplier not found in this workspace.');
    if (supplier.status !== 'approved') fail(409, 'Only approved suppliers can join a chat thread.');
    const clash = await one(db, `SELECT c.id FROM collab_conversations c WHERE c.workspace_id=? AND c.supplier_id=? AND c.kind='external'`, w, supplierId);
    if (clash) return conversationShape(await one(db, 'SELECT * FROM collab_conversations WHERE id=?', clash.id));
    await insertConversation(db, { id, workspaceId: w, kind: 'external', supplier_id: supplierId,
      title: `Supplier chat · ${supplier.name}`.slice(0, 120), created_by: member.user_id, created_at: now }, 'admin', validIds);
    await audit(db, member, 'collab.room.created', id, { kind: 'external', supplier_id: supplierId, members: validIds }).run();
    return conversationShape(await one(db, 'SELECT * FROM collab_conversations WHERE id=?', id), 201);
  }
  fail(422, 'Choose a direct conversation, team room, record thread or supplier thread.');
}

const entityLabel = (db, w, entityType, entityId) =>
  one(db, entityType === 'lot' ? 'SELECT batch AS label FROM lots WHERE id=? AND workspace_id=?'
    : entityType === 'rfq' ? 'SELECT reference AS label FROM procurement_rfqs WHERE id=? AND workspace_id=?'
    : entityType === 'purchase_order' ? 'SELECT reference AS label FROM supplier_purchase_orders WHERE id=? AND workspace_id=?'
    : entityType === 'shipment' ? 'SELECT bill_of_lading AS label FROM procurement_shipments WHERE id=? AND workspace_id=?'
    : fail(422, 'Choose a record type to link.'), entityId, w).then(row => row?.label ?? null);

const conversationShape = (conversation, status = 200) => json({
  conversation: { id: conversation.id, kind: conversation.kind, title: conversation.kind === 'direct' ? '' : conversation.title,
    entity_type: conversation.entity_type, entity_id: conversation.entity_id, supplier_id: conversation.supplier_id,
    created_at: conversation.created_at },
}, status);

/* ------------------------------------------------------------------ messages */

async function messagePage(db, member, conv, url) {
  const after = cursor(url.searchParams.get('after'), 'Cursor');
  const beforeRaw = url.searchParams.get('before');
  const before = beforeRaw === null ? null : cursor(beforeRaw, 'Cursor');
  const limit = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || 50)));
  const rows = after !== null
    ? await all(db, 'SELECT * FROM collab_messages WHERE conversation_id=? AND gseq>? ORDER BY gseq ASC LIMIT ?', conv.id, after, limit)
    : await all(db, 'SELECT * FROM collab_messages WHERE conversation_id=? AND gseq<=? ORDER BY gseq DESC LIMIT ?',
        conv.id, before ?? Number.MAX_SAFE_INTEGER, limit);
  const ordered = after !== null ? rows : rows.slice().reverse();
  return {
    messages: await shapeMessages(db, member, ordered),
    next_before: ordered.length === limit ? ordered[0].gseq : null,
    next_after: after !== null && ordered.length === limit ? ordered[ordered.length - 1].gseq : null,
    last_read_gseq: conv.last_read_gseq,
  };
}

async function sendMessage(db, member, conv, data, people) {
  keys(data, ['id', 'body', 'replyTo', 'refs']);
  if (!data || typeof data.id !== 'string') fail(422, 'A message needs a durable request ID from the app.');
  const id = recordId(data.id);
  const body = multiline(data.body ?? '', 'Message', 1, MESSAGE_MAX);
  const refs = await validateRefs(db, member, data.refs);
  let replyTo = null;
  if (data.replyTo) {
    replyTo = recordId(data.replyTo);
    const reply = await one(db, 'SELECT id, conversation_id FROM collab_messages WHERE id=? AND workspace_id=?', replyTo, member.workspace_id);
    if (!reply || reply.conversation_id !== conv.id) fail(404, 'The message you replied to is not in this conversation.');
  }
  const requestHash = await sha256(JSON.stringify({ conversation: conv.id, body, replyTo, refs }));
  const existing = await one(db, 'SELECT * FROM collab_messages WHERE id=? AND conversation_id=?', id, conv.id);
  if (existing) {
    if (existing.request_hash !== requestHash) fail(409, 'This request ID was already used for different text. Use a new request ID to send new content.');
    return { message: (await shapeMessages(db, member, [existing]))[0], deduped: true };
  }
  await throttle(db, 'send', member.user_id, SEND_PER_MINUTE, 60_000);
  const mentions = parseMentions(body, people);
  const createdAt = Date.now();
  const eventId = uuid();
  const mutedUsers = new Set((await all(db, `SELECT user_id FROM collab_mutes WHERE workspace_id=? AND kind='chat_mention'`, member.workspace_id)).map(r => r.user_id));
  const recipients = [...new Set(mentions.map(m => m.id).filter(uid => uid !== member.user_id))];
  const notified = recipients.filter(uid => !mutedUsers.has(uid));
  for (let attempt = 0; attempt < 3; attempt++) {
    const gseq = await nextSeq(db, conv.id);
    try {
      await db.batch([
        query(db, `INSERT INTO collab_messages(id,workspace_id,conversation_id,gseq,sender_id,sender_name,body,references_json,request_hash,reply_to,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`, id, member.workspace_id, conv.id, gseq, member.user_id, member.name.slice(0, 80), body,
          JSON.stringify(refs), requestHash, replyTo, createdAt),
        ...mentions.map(person => query(db, 'INSERT OR IGNORE INTO collab_mentions(message_id,workspace_id,mentioned_user_id,created_at) VALUES(?,?,?,?)',
          id, member.workspace_id, person.id, createdAt)),
        query(db, `INSERT OR IGNORE INTO collab_events(id,workspace_id,kind,entity_type,entity_id,dedupe_key,subject,detail_json,link,recipients_json,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`, eventId, member.workspace_id, 'chat_mention', 'message', id, `mention:${id}`,
          `${member.name} mentioned you`,
          JSON.stringify({ conversation_id: conv.id, message_id: id, snippet: body.slice(0, 140) }),
          '', JSON.stringify(notified), createdAt),
        ...notified.map(userId => query(db, 'INSERT OR IGNORE INTO collab_notifications(id,workspace_id,event_id,user_id,created_at) VALUES(?,?,?,?,?)',
          uuid(), member.workspace_id, eventId, userId, createdAt)),
      ]);
      const row = await one(db, 'SELECT * FROM collab_messages WHERE id=?', id);
      return { message: (await shapeMessages(db, member, [row]))[0], mentions: mentions.map(person => person.name) };
    } catch (error) {
      const replay = await one(db, 'SELECT * FROM collab_messages WHERE id=? AND conversation_id=?', id, conv.id);
      if (replay && replay.request_hash === requestHash) return { message: (await shapeMessages(db, member, [replay]))[0], deduped: true };
      if (/UNIQUE constraint failed: collab_messages\.conversation_id, collab_messages\.gseq/.test(String(error))) continue;
      throw error;
    }
  }
  fail(409, 'The conversation is busy. Refresh and retry with the same request ID so nothing is duplicated.');
}

/* ------------------------------------------------------------------ shared state */

async function workspaceState(db, env, member, full) {
  const w = member.workspace_id;
  const conversations = await all(db, UNREAD_QUERY, member.user_id, w);
  const notifications = await all(db, `SELECT n.id, n.created_at, n.acknowledged_at, e.kind, e.subject, e.detail_json, e.entity_type, e.entity_id, e.link
    FROM collab_notifications n JOIN collab_events e ON e.id=n.event_id
    WHERE n.user_id=? AND n.workspace_id=? ${full ? '' : 'AND n.acknowledged_at IS NULL'}
    ORDER BY n.created_at DESC LIMIT ${full ? 30 : 8}`, member.user_id, w);
  const mutes = new Set((await all(db, 'SELECT kind FROM collab_mutes WHERE workspace_id=? AND user_id=?', w, member.user_id)).map(r => r.kind));
  const state = {
    me: { user_id: member.user_id, name: member.name, admin: member.admin },
    conversations: conversations.map(row => ({
      id: row.id, kind: row.kind, title: displayTitle(row), entity_type: row.entity_type, entity_id: row.entity_id,
      unread_count: row.unread_count, unread_mentions: row.unread_mentions, muted: !!row.muted,
      member_count: row.member_count, last_activity: row.last_activity, room_role: row.room_role,
    })),
    unread_total: conversations.reduce((sum, row) => sum + row.unread_count, 0),
    notifications: notifications.map(shapeNotification),
    muted_kinds: NOTIFICATION_KINDS.filter(kind => mutes.has(kind)),
    storage: env.BUCKET ? { ready: true } : { ready: false, reason: 'File storage (BUCKET) is not configured for this site, so chat attachments are unavailable.' },
    serverTime: Date.now(),
    transport: 'polling',
  };
  if (full) {
    state.people = (await all(db, `SELECT id, name, role FROM users WHERE workspace_id=? AND status='active' ORDER BY name COLLATE NOCASE`, w))
      .map(person => ({ id: person.id, name: person.name, admin: person.role === 'admin' }));
  }
  return state;
}

async function thresholdsView(db, w) {
  return {
    thresholds: await all(db, `SELECT t.product_id, t.stage, t.threshold_grams, t.updated_at, p.name, p.sku,
        COALESCE((SELECT SUM(b.grams) FROM balances b JOIN lots l ON l.id=b.lot_id
          WHERE l.workspace_id=t.workspace_id AND l.product_id=t.product_id AND b.stage=t.stage),0) AS level_grams
      FROM collab_stock_thresholds t JOIN products p ON p.id=t.product_id
      WHERE t.workspace_id=? ORDER BY p.name`, w),
    alerting: await all(db, `SELECT a.product_id, a.stage, a.threshold_grams,
        COALESCE((SELECT SUM(b.grams) FROM balances b JOIN lots l ON l.id=b.lot_id
          WHERE l.workspace_id=a.workspace_id AND l.product_id=a.product_id AND b.stage=a.stage),0) AS level_grams
      FROM collab_stock_alert_state a WHERE a.workspace_id=? AND a.alerting=1`, w),
  };
}

/* ------------------------------------------------------------------ supplier-side external threads */

/** The portal user row comes from the router's server-side supplier session resolution
 * (same source as supplierOperations): { user_id, user_name, user_email, supplier_id,
 * workspace_id, status }. Supplier users only ever see threads for their own company. */
async function portalCollaborationRoute(request, env, user, path, data) {
  const db = env.DB;
  if (!env.DB || !env.DB.prepare) fail(503, 'The shared database is not connected.');
  if (user.status !== 'approved') fail(403, 'An admin must approve your company before you can use the chat thread.');
  if (!['GET', 'POST'].includes(request.method)) fail(405, 'Method not allowed.');
  sameOrigin(request, new URL(request.url));
  const route = path.replace(/\/$/, '');
  if (!route.startsWith(PORTAL_PREFIX)) fail(404, 'Supplier collaboration route not found.');
  const sub = route.slice(PORTAL_PREFIX.length) || '/workspace';
  const w = user.workspace_id;

  if (sub === '' || sub === '/workspace') {
    const threads = await all(db, `SELECT c.id, c.title, c.created_at, sup.name AS supplier_name,
        (SELECT COUNT(*) FROM collab_members WHERE conversation_id=c.id) AS staff_count,
        (SELECT COUNT(*) FROM collab_messages WHERE conversation_id=c.id) AS message_count,
        (SELECT COALESCE(MAX(created_at),0) FROM collab_messages WHERE conversation_id=c.id) AS last_message_at
      FROM collab_conversations c JOIN suppliers sup ON sup.id=c.supplier_id
      WHERE c.workspace_id=? AND c.kind='external' AND c.supplier_id=?`, w, user.supplier_id);
    return json({ threads, me: { user_id: user.user_id, name: user.user_name, supplier_id: user.supplier_id } });
  }

  const match = sub.match(/^\/threads\/([0-9a-fA-F-]{36})\/messages$/);
  if (match) {
    const thread = await one(db, `SELECT * FROM collab_conversations
      WHERE id=? AND workspace_id=? AND kind='external' AND supplier_id=?`, recordId(match[1]), w, user.supplier_id);
    if (!thread) fail(404, 'That supplier thread was not found for your company.');
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const after = cursor(url.searchParams.get('after'), 'Cursor') ?? 0;
      const before = url.searchParams.get('before') === null ? null : cursor(url.searchParams.get('before'), 'Cursor');
      const limit = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || 50)));
      const rows = before !== null
        ? (await all(db, 'SELECT * FROM collab_messages WHERE conversation_id=? AND gseq<=? ORDER BY gseq DESC LIMIT ?', thread.id, before, limit)).reverse()
        : await all(db, 'SELECT * FROM collab_messages WHERE conversation_id=? AND gseq>? ORDER BY gseq ASC LIMIT ?', thread.id, after, limit);
      return json({
        messages: rows.map(row => ({ id: row.id, gseq: row.gseq, sender_name: row.sender_name,
          body: row.removed_by ? '' : row.body, created_at: row.created_at, removed: !!row.removed_by })),
        next_before: rows.length === limit ? rows[0].gseq : null,
        next_after: rows.length === limit ? rows[rows.length - 1].gseq : null,
        // Attachment and card content never leaves the staff network for supplier threads.
        capabilities: { attachments: false, cards: false, mentions: false },
      });
    }
    keys(data, ['id', 'body']);
    const body = multiline(data.body ?? '', 'Message', 1, MESSAGE_MAX);
    const requestHash = await sha256(JSON.stringify({ conversation: thread.id, body }));
    if (typeof data.id !== 'string') fail(422, 'A message needs a durable request ID from the app.');
    const existing = await one(db, 'SELECT * FROM collab_messages WHERE id=? AND conversation_id=?', recordId(data.id), thread.id);
    if (existing) {
      if (existing.sender_id !== `supplier:${user.user_id}` || existing.request_hash !== requestHash)
        fail(409, 'This request ID was already used for a different supplier message.');
      return json({ message: { id: existing.id, gseq: existing.gseq, body: existing.body, created_at: existing.created_at, sender_name: existing.sender_name } });
    }
    await throttle(db, 'portal_send', user.user_id, SEND_PER_MINUTE, 60_000);
    const gseq = await nextSeq(db, thread.id);
    try {
      await query(db, `INSERT INTO collab_messages(id,workspace_id,conversation_id,gseq,sender_id,sender_name,body,references_json,request_hash,reply_to,created_at)
        VALUES(?,?,?,?,?,?,?,'[]',?,NULL,?)`, recordId(data.id), w, thread.id, gseq, `supplier:${user.user_id}`,
        String(user.user_name).slice(0, 80), body, requestHash, Date.now()).run();
      return json({ message: { id: data.id, gseq, body, created_at: Date.now(), sender_name: user.user_name } }, 201);
    } catch (error) {
      const replay = await one(db, 'SELECT * FROM collab_messages WHERE id=? AND conversation_id=?', recordId(data.id), thread.id);
      if (replay && replay.request_hash === requestHash)
        return json({ message: { id: replay.id, gseq: replay.gseq, body: replay.body, created_at: replay.created_at, sender_name: replay.sender_name } });
      if (/UNIQUE constraint failed: collab_messages/.test(String(error))) fail(409, 'The thread is busy. Retry with the same request ID.');
      throw error;
    }
  }
  fail(404, 'Supplier collaboration route not found.');
}

export async function collaborationApi(request, env, member, path, data) {
  try { return await collaborationRoute(request, env, member, path, data); }
  catch (error) {
    if (error instanceof ErpProblem) return json({ error: error.message }, error.status);
    console.error('Collaboration request failed:', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'The server could not complete this request. No success was confirmed. Refresh and try again.' }, 500);
  }
}

export async function portalCollaborationApi(request, env, user, path, data) {
  try { return await portalCollaborationRoute(request, env, user, path, data); }
  catch (error) {
    if (error instanceof ErpProblem) return json({ error: error.message }, error.status);
    console.error('Portal collaboration request failed:', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'The server could not complete this request. No success was confirmed. Refresh and try again.' }, 500);
  }
}
