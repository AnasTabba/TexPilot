/** Team chat: one shared "Factory" thread per workspace, 1:1 direct threads, text, photos and batch cards. Access is by membership, so a direct thread stays between its two people. */
import { all, one, query, json, fail, keys, recordId, text, multiline, integer, viewer } from './erp-utils.mjs';
import { ROLES } from './auth.mjs';
import { readPhoto } from './photos.mjs';

const base = '/api/erp/chat', PHOTO = base + '/photo/';
const MESSAGE = 'id,thread_id,user_id,sender_name,body,photo_key,photo_type,ref_type,ref_id,ref_label,created_at';
const now = () => Date.now();
const uuid = () => crypto.randomUUID();
const shape = m => ({ id: m.id, thread_id: m.thread_id, user_id: m.user_id, sender_name: m.sender_name, body: m.body, photo: m.photo_key != null, ref: m.ref_type ? { type: m.ref_type, id: m.ref_id, label: m.ref_label } : null, created_at: m.created_at });
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
    const last = await one(db, `SELECT ${MESSAGE} FROM chat_messages WHERE thread_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1`, t.id);
    list.push({ id: t.id, kind: t.kind, title: t.kind === 'team' ? 'Factory' : other?.name ?? 'Chat', other, last: last ? shape(last) : null, unread: t.unread });
  }
  const people = await all(db, "SELECT id,name,portal_role AS role FROM users WHERE workspace_id=? AND status='active' AND deactivated_at IS NULL AND portal_role IS NOT NULL AND id<>? ORDER BY name", w, me);
  return { threads: list, people, unread: list.reduce((n, t) => n + t.unread, 0) };
}

async function messages(db, member, url) {
  const thread = await threadFor(db, member, recordId(url.searchParams.get('thread')));
  const after = url.searchParams.has('after') ? integer(Number(url.searchParams.get('after')), 'After', 0, 8_640_000_000_000_000) : null;
  // Without "after": the newest 200, oldest first. With it: up to 200 from that time on (the client drops ids it has), oldest first.
  const rows = after === null
    ? await all(db, `SELECT * FROM (SELECT rowid AS seq,${MESSAGE} FROM chat_messages WHERE thread_id=? ORDER BY created_at DESC,rowid DESC LIMIT 200) ORDER BY created_at,seq`, thread.id)
    : await all(db, `SELECT rowid AS seq,${MESSAGE} FROM chat_messages WHERE thread_id=? AND created_at>=? ORDER BY created_at,rowid LIMIT 200`, thread.id, after);
  await markRead(db, thread.id, member.user_id);
  return rows.map(shape);
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

// Batch cards point at a lot in this workspace; the label is product name and batch, resolved here so a viewer can never see a stale or foreign label.
async function reference(db, member, value) {
  keys(value, ['type', 'id']);
  if (value.type !== 'lot') fail(422, 'Choose a batch to share.');
  const lot = await one(db, 'SELECT l.id,p.name,l.batch FROM lots l JOIN products p ON p.id=l.product_id WHERE l.id=? AND l.workspace_id=?', text(value.id, 'Batch', 1, 100), member.workspace_id);
  if (!lot) fail(404, 'This batch was not found in your workspace.');
  return { type: 'lot', id: lot.id, label: `${lot.name} · ${lot.batch}` };
}

async function post(db, member, threadId, { id = uuid(), body = '', ref = null, photo = null }) {
  const m = { id, thread_id: threadId, user_id: member.user_id, sender_name: member.name, body, photo_key: photo?.key ?? null, photo_type: photo?.type ?? null, ref_type: ref?.type ?? null, ref_id: ref?.id ?? null, ref_label: ref?.label ?? null, created_at: now() };
  await db.batch([
    query(db, 'INSERT INTO chat_messages(id,workspace_id,thread_id,user_id,sender_name,body,photo_key,photo_type,ref_type,ref_id,ref_label,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', m.id, member.workspace_id, threadId, m.user_id, m.sender_name, body, m.photo_key, m.photo_type, m.ref_type, m.ref_id, m.ref_label, m.created_at),
    query(db, 'UPDATE chat_threads SET last_message_at=? WHERE id=?', m.created_at, threadId),
  ]);
  return shape(m);
}

async function send(db, member, data) {
  keys(data, ['threadId', 'body', 'ref']);
  const thread = await threadFor(db, member, recordId(data.threadId));
  const body = data.body == null ? '' : multiline(data.body, 'Message', 0, 2000);
  const ref = data.ref == null ? null : await reference(db, member, data.ref);
  if (!body && !ref) fail(422, 'Write a message or share a batch.');
  return post(db, member, thread.id, { body, ref });
}

async function upload(request, env, member) {
  const { form, bytes, type } = await readPhoto(request);
  const thread = await threadFor(env.DB, member, recordId(form.get('threadId')));
  const caption = multiline(form.get('caption') ?? '', 'Caption', 0, 2000);
  const id = uuid(), key = `${member.workspace_id}/chat/${id}`;
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type } });
  return json(await post(env.DB, member, thread.id, { id, body: caption, photo: { key, type } }), 201);
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
    if (path === base + '/messages') return json({ messages: await messages(dbh, member, url) });
    if (path.startsWith(PHOTO)) return photo(env, member, path.slice(PHOTO.length));
  } else if (request.method === 'POST') {
    if (path === base + '/photos') return upload(request, env, member);
    if (path === base + '/direct') return json({ id: await direct(dbh, member, data) });
    if (path === base + '/send') return json(await send(dbh, member, data), 201);
    if (path === base + '/read') { keys(data, ['threadId']); const thread = await threadFor(dbh, member, recordId(data.threadId)); await markRead(dbh, thread.id, member.user_id); return json({ read: true }); }
  }
  fail(404, 'Chat route not found.');
}
