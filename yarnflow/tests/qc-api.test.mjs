import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../server/cloudflare.mjs';
import { sqliteBinding } from '../server/sqlite.mjs';
import { seedRows, userRow } from '../server/auth.mjs';
import { handleQC } from '../server/qc.mjs';
import { issueQCAssertion } from '../server/qc-service-auth.mjs';

const ORIGIN = 'https://yarnflow.test', id = () => crypto.randomUUID();
async function fixture() {
  const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
  const dir = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(file, dir), 'utf8'));
  for (const row of await seedRows('2468')) sql.prepare(row.sql).run(...row.args);
  const w = sql.prepare('SELECT id FROM workspaces').get().id, env = { DB: sqliteBinding(sql) }, cookies = {};
  for (const role of ['admin', 'purchase_manager', 'quality_inspector', 'supervisor', 'sales_manager', 'dispatch']) {
    const row = await userRow({ workspaceId: w, name: role, pin: '2468', role }); sql.prepare(row.sql).run(...row.args);
    const r = await worker.fetch(new Request(ORIGIN + '/api/auth/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: role, pin: '2468' }) }), env);
    cookies[role] = r.headers.get('Set-Cookie').split(';')[0];
  }
  async function call(path, body, role = 'admin', options = {}) {
    const headers = { Origin: ORIGIN, ...(role ? { Cookie: cookies[role] } : {}), 'Idempotency-Key': options.key ?? id(), ...options.headers };
    if (!(body instanceof FormData)) headers['Content-Type'] ??= 'application/json';
    const r = await worker.fetch(new Request(ORIGIN + '/api/qc/v2' + path, { method: options.method ?? (body === undefined ? 'GET' : 'POST'), headers, ...(body === undefined ? {} : { body: body instanceof FormData ? body : typeof body === 'string' ? body : JSON.stringify(body) }) }), env);
    return { status: r.status, data: await r.json(), headers: r.headers };
  }
  return { sql, env, w, cookies, call };
}
const endpoints = [
  ['GET','/status'], ['GET','/purchase-orders'], ['POST','/specs','purchase_manager'], ['GET',`/specs/${id()}`],
  ['GET','/consent-authorities'], ['POST','/consent-authorities','admin'], ['POST','/selections','quality_inspector'], ['POST','/samples','quality_inspector'], ['GET','/samples'], ['GET',`/samples/${id()}`],
  ['POST',`/samples/${id()}/capture-sets`,'quality_inspector'], ['POST',`/capture-sets/${id()}/captures`,'quality_inspector'], ['POST',`/capture-sets/${id()}/close`,'quality_inspector'], ['POST',`/samples/${id()}/analyze`,'quality_inspector'],
  ['GET',`/requests/${id()}`], ['GET',`/captures/${id()}/original`], ['POST',`/samples/${id()}/adjudications`,'supervisor'], ['POST','/reauth','admin'], ['GET','/releases'], ['POST','/releases','admin'], ['POST',`/releases/${id()}/activate`,'admin'], ['POST',`/releases/${id()}/suspend`,'admin'],
];
function envelope(r, status, code) { assert.equal(r.status, status, JSON.stringify(r.data)); assert.equal(r.data.schema_version, '2'); assert.equal(r.data.error.code, code); assert.match(r.data.error.request_id, /^[a-f\d-]{36}$/); assert.equal(typeof r.data.error.retryable, 'boolean'); assert.equal(r.headers.get('Cache-Control'), 'no-store'); }

test('QC namespace allocates its error envelope before DB, session, method and parsing', async () => {
  const r = await worker.fetch(new Request(ORIGIN + '/api/qc/v2/status'), {}); assert.equal(r.status, 503); assert.equal((await r.json()).error.code, 'SERVICE_UNAVAILABLE');
  const f = await fixture();
  for (const [method,path] of endpoints) envelope(await f.call(path, method === 'POST' ? '{bad' : undefined, null, { method }), 401, 'UNAUTHENTICATED');
  envelope(await f.call('/specs', {}, 'purchase_manager', { headers: { Origin: 'https://foreign.test' } }), 403, 'FORBIDDEN');
  envelope(await f.call('/status', undefined, 'admin', { method: 'DELETE' }), 405, 'METHOD_NOT_ALLOWED');
  envelope(await f.call('/specs', '{bad', 'purchase_manager'), 400, 'MALFORMED_REQUEST');
  envelope(await f.call('/specs', 'x'.repeat(65537), 'purchase_manager'), 413, 'PAYLOAD_TOO_LARGE');
  assert.equal(await handleQC(new Request(ORIGIN + '/api/workspace'), {}, null), null);
});

test('QC role matrix rejects every unauthorized mutation before parsing', async () => {
  const f = await fixture();
  for (const [method,path,allowed] of endpoints.filter(e => e[0] === 'POST')) for (const role of Object.keys(f.cookies)) {
    if (role === allowed || role === 'admin') continue;
    envelope(await f.call(path, '{bad', role, { method }), 403, 'FORBIDDEN');
  }
  for (const path of [`/samples/${id()}`, `/specs/${id()}`, `/requests/${id()}`, `/captures/${id()}/original`]) for (const role of Object.keys(f.cookies)) envelope(await f.call(path, undefined, role), 404, 'NOT_FOUND');
});

test('QC rejects forged authority fields and requires UUID idempotency keys', async () => {
  const f = await fixture();
  for (const field of ['workspace_id','automatic','release','status']) envelope(await f.call('/specs', { [field]: field === 'automatic' ? true : id() }, 'purchase_manager'), 422, 'VALIDATION_FAILED');
  envelope(await f.call('/specs', {}, 'purchase_manager', { key: 'bad' }), 422, 'VALIDATION_FAILED');
  envelope(await f.call('/selections', {}, 'admin'), 403, 'FORBIDDEN');
  const s = await f.call('/status', undefined, 'quality_inspector'); assert.equal(s.status, 200); assert.equal(s.data.mode, 'REVIEW_ONLY'); assert.equal(s.data.automation.enabled, false); assert.equal(s.data.can.capture, true);
});

test('assertions are 30-second WebCrypto HMACs bound to actor, payload, generation and deadline', async () => {
  const now = Date.now(), ctx = { user_id: id(), workspace_id: id(), session_hash: 'a'.repeat(64), session_expires_at: now + 60000 }, request = id(), hash = 'b'.repeat(64), key = 'assertion-test-double-key';
  const token = await issueQCAssertion(ctx, hash, request, now, { key, deadline_at: new Date(now + 60000).toISOString(), request_generation: 3 });
  const [version,part,sig] = token.split('.'), claims = JSON.parse(Buffer.from(part,'base64url'));
  assert.equal(version,'v1'); assert.equal(claims.exp-claims.iat,30); assert.equal(claims.payload_sha256,hash); assert.equal(claims.workspace_id,ctx.workspace_id); assert.equal(claims.request_generation,3); assert.ok(!token.includes(ctx.session_hash));
  const hmac = await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  assert.equal(await crypto.subtle.verify('HMAC',hmac,Buffer.from(sig,'base64url'),new TextEncoder().encode('v1.'+part)),true);
  assert.equal(await crypto.subtle.verify('HMAC',hmac,Buffer.from(sig,'base64url'),new TextEncoder().encode('v1.'+part+'tampered')),false);
  await assert.rejects(issueQCAssertion({...ctx,session_expires_at:now},hash,request,now,{key}));
  await assert.rejects(issueQCAssertion(ctx,hash,request,now,{key,deadline_at:new Date(now).toISOString()}));
});

test('actual Worker wraps DB/session exceptions and malformed multipart without leaking internals',async()=>{
  const broken = { DB:{prepare(){throw Error('private database credential');}} };
  const response=await worker.fetch(new Request(ORIGIN+'/api/qc/v2/status',{headers:{Cookie:'yf_session='+'a'.repeat(64)}}),broken),data=await response.json();assert.equal(response.status,500);assert.equal(data.error.code,'INTERNAL_ERROR');assert.ok(!JSON.stringify(data).includes('credential'));
  const f=await fixture();envelope(await f.call('/capture-sets/'+id()+'/captures','bad multipart','quality_inspector',{headers:{'Content-Type':'multipart/form-data; boundary=example'}}),400,'MALFORMED_REQUEST');
  const legacy=await worker.fetch(new Request(ORIGIN+'/api/workspace'),{});assert.deepEqual(await legacy.json(),{error:'The shared database is not connected. No stock was saved.'});
});

test('authentication and origin failures reject an upload before reading the byte stream',async()=>{
  const f=await fixture();let reads=0;
  const stream=()=>new ReadableStream({pull(){reads++;throw Error('body must not be decoded');}},{highWaterMark:0});
  for(const [cookie,origin,status] of [[null,ORIGIN,401],[f.cookies.quality_inspector,'https://foreign.test',403]]){
    const response=await worker.fetch(new Request(ORIGIN+'/api/qc/v2/capture-sets/'+id()+'/captures',{method:'POST',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),'Content-Type':'multipart/form-data; boundary=x','Idempotency-Key':id()},body:stream(),duplex:'half'}),f.env);assert.equal(response.status,status);assert.equal(reads,0);
  }
});

test('local dev-server dispatch streams QC multipart through the same early boundary without sockets',async()=>{
  const {default:http}=await import('node:http'),{syncBuiltinESMExports}=await import('node:module'),{Readable}=await import('node:stream');
  const previous={...process.env},original=http.createServer,signals=Object.fromEntries(['SIGINT','SIGTERM'].map(s=>[s,new Set(process.listeners(s))]));let handler;
  http.createServer=callback=>{handler=callback;return{listen(){},close(callback){callback?.();}};};syncBuiltinESMExports();
  Object.assign(process.env,{YARNFLOW_LOCAL_DEV:'1',YARNFLOW_SQLITE_PATH:':memory:',YARNFLOW_SEED_PIN:'2468',YARNFLOW_TEST_MODE:'0'});
  try{
    await import('../scripts/dev-server.mjs?qc-routing-test-double');assert.equal(typeof handler,'function');
    const send=async(path,method,body,headers={})=>{let resolve;const done=new Promise(r=>{resolve=r;}),incoming=Readable.from(body?[body]:[]);Object.assign(incoming,{url:path,method,headers:{host:'127.0.0.1:8788',...headers}});const outgoing={writeHead(status,headers){this.status=status;this.headers=headers;},end(bytes){resolve({status:this.status,headers:this.headers,data:bytes?.length?JSON.parse(Buffer.from(bytes).toString()):null});}};await handler(incoming,outgoing);return done;};
    const base={origin:'http://127.0.0.1:8788','content-type':'application/json'},login=await send('/api/auth/login','POST',Buffer.from(JSON.stringify({name:'Anas',pin:'2468'})),base);assert.equal(login.status,200);const cookie=login.headers['set-cookie'].split(';')[0];
    const form=new FormData();form.set('meta','{}');form.set('original',new Blob([new Uint8Array(700000)],{type:'image/png'}),'original.png');const encoded=new Request('http://local',{method:'POST',body:form}),bytes=Buffer.from(await encoded.arrayBuffer()),multipart={...base,cookie,'content-type':encoded.headers.get('Content-Type'),'idempotency-key':id()};
    const anonymous=await send('/api/qc/v2/capture-sets/'+id()+'/captures','POST',bytes,{...multipart,cookie:''});assert.equal(anonymous.status,401);assert.equal(anonymous.data.schema_version,'2');
    const auth=await send('/api/qc/v2/capture-sets/'+id()+'/captures','POST',bytes,multipart);assert.equal(auth.status,403);assert.equal(auth.data.error.code,'FORBIDDEN');
    // An admin supplies the required intervention in meta; a large multipart reaches QC's field validation.
    form.set('meta',JSON.stringify({interventionReason:'Inspector is unavailable for this test double'}));const encoded2=new Request('http://local',{method:'POST',body:form});const parsed=await send('/api/qc/v2/capture-sets/'+id()+'/captures','POST',Buffer.from(await encoded2.arrayBuffer()),{...multipart,'content-type':encoded2.headers.get('Content-Type'),'idempotency-key':id()});assert.equal(parsed.status,422);assert.equal(parsed.data.error.code,'VALIDATION_FAILED');
  }finally{http.createServer=original;syncBuiltinESMExports();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);for(const signal of ['SIGINT','SIGTERM'])for(const listener of process.listeners(signal))if(!signals[signal].has(listener))process.removeListener(signal,listener);}
});
