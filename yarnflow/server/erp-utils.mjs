export class ErpProblem extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new ErpProblem(status, message); };
export const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers,
} });
export const query = (db, sql, ...args) => db.prepare(sql).bind(...args);
export const one = (db, sql, ...args) => query(db, sql, ...args).first();
export const all = async (db, sql, ...args) => (await query(db, sql, ...args).all()).results;
export function text(value, label, min = 1, max = 200) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\u0000-\u001f]/.test(value)) fail(422, `${label} must contain ${min}–${max} characters.`);
  return value.trim();
}
export function multiline(value, label, min = 1, max = 4000) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(422, `${label} must contain ${min}–${max} characters.`);
  return value.trim();
}
export function integer(value, label, min = 1, max = 1_000_000_000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(422, `${label} must be a whole number from ${min} to ${max}.`);
  return value;
}
export const recordId = value => {
  if (typeof value !== 'string' || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) fail(422, 'Use a valid record ID.');
  return value;
};
export const email = value => {
  const result = text(value, 'Email', 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail(422, 'Enter a valid email address.');
  return result;
};
export const phone = value => {
  const result = text(value, 'Phone', 8, 30).replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{6,14}$/.test(result)) fail(422, 'Enter a phone number with its country code, for example +923001234567.');
  return result;
};
export function website(value) {
  if (!value) return '';
  try { const u = new URL(value); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || value.length > 500) throw Error(); return u.href; }
  catch { fail(422, 'Enter a public HTTP or HTTPS website address.'); }
}
export function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) fail(422, 'Unexpected request fields.');
}
export async function readJson(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) fail(415, 'Send JSON.');
  const reader = request.body?.getReader(); let length = 0; const parts = [];
  if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 65536) { await reader.cancel(); fail(413, 'The request is too large.'); } parts.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const p of parts) { bytes.set(p, offset); offset += p.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, 'Send valid JSON.'); }
}
export const reason = (value, label = 'Reason') => multiline(value, label, 5, 1000);
export function role(member, data, ...roles) {
  if (roles.includes(member.role)) return null;
  if (member.role !== 'admin') fail(403, 'Your role cannot do this. Ask an admin.');
  return reason(data?.interventionReason, 'Intervention reason');
}
export function viewer(member, ...roles) {
  if (member.role !== 'admin' && !roles.includes(member.role)) fail(403, 'Your role cannot do this. Ask an admin.');
}
export function audit(db, member, action, id, detail = {}, type = 'staff', { objectType = action.split('.')[0], before = null, after = null, reason = null, intervention = null } = {}) {
  const now = Date.now();
  return query(db, 'INSERT INTO erp_audit_events(id,workspace_id,actor_id,actor_type,action,record_id,detail_json,created_at,actor_role,object_type,old_json,new_json,reason,intervention_reason,created_by,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    crypto.randomUUID(), member.workspace_id, member.user_id, type, action, id, JSON.stringify(detail), now, member.role ?? type, objectType,
    before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), reason, intervention, member.user_id, 'recorded', now);
}
export function date(value, label, future = false) {
  integer(value, label, 1, 8_640_000_000_000_000);
  if (future && value <= Date.now()) fail(422, `${label} must be in the future.`);
  return value;
}
