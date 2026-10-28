import { all, one, query, json, fail, text, email, recordId, keys, readJson, audit } from './erp-utils.mjs';
import { randomHex, sha256 } from './auth.mjs';
import { categories, categoryIds, categoryQueries, supplierData, supplierView, supplierOperations } from './procurement.mjs';

const COOKIE = 'yf_supplier_session';
const SESSION_MS = 12 * 3600_000;
const cookie = (request, value) => `${COOKIE}=${value ?? ''}; Path=/api/portal; HttpOnly; SameSite=Strict${new URL(request.url).protocol==='https:'?'; Secure':''}${value?'':'; Max-Age=0'}`;
const tokenOf = request => request.headers.get('Cookie')?.match(/(?:^|;\s*)yf_supplier_session=([a-f\d]{64})(?:;|$)/)?.[1];
const password = value => {
  if (typeof value!=='string'||value.length<12||value.length>128||value.trim().length<12) fail(422,'Use a password with 12–128 characters.');
  return value;
};
export async function passwordHash(value, salt) {
  const material = await crypto.subtle.importKey('raw',new TextEncoder().encode(value),'PBKDF2',false,['deriveBits']);
  const derived = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:100000},material,256);
  return [...new Uint8Array(derived)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function equal(a,b) { if(a.length!==b.length)return false; let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0; }
async function throttle(db,request,kind,limit,windowMs) {
  const now=Date.now(); const key=await sha256(`${kind}:${request.headers.get('CF-Connecting-IP')??'local'}`);
  await query(db,'INSERT INTO portal_rate_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END',key,now+windowMs,now,now,now+windowMs).run();
  if((await one(db,'SELECT attempts FROM portal_rate_limits WHERE key=?',key)).attempts>limit) fail(429,'Too many attempts. Please wait before trying again.');
}
async function supplierSession(db,request) {
  const token=tokenOf(request); if(!token)return null;
  return one(db,`SELECT u.id AS user_id,u.name AS user_name,u.email AS user_email,u.supplier_id,s.workspace_id,s.status FROM supplier_sessions x JOIN supplier_users u ON u.id=x.user_id JOIN suppliers s ON s.id=u.supplier_id WHERE x.token_hash=? AND x.expires_at>?`,await sha256(token),Date.now());
}
export async function supplierPortal(request,env,path) {
  const db=env.DB;const now=Date.now();const data=request.method==='POST'?await readJson(request):null;
  if(path==='/api/portal/config'&&!data) {
    const factories=await all(db,'SELECT name FROM workspaces ORDER BY created_at LIMIT 2');
    return json({factory:factories.length===1?factories[0].name:null,registrationAvailable:factories.length===1,categories:await categories(db)});
  }
  if(path==='/api/portal/register'&&data) {
    keys(data,['company','contactName','email','phone','city','categories','password']);
    await throttle(db,request,'register',10,3600_000);
    const factories=await all(db,'SELECT id FROM workspaces ORDER BY created_at LIMIT 2');
    if(factories.length!==1)fail(503,'Supplier registration needs a factory-specific setup. Contact the factory admin.');
    const s=supplierData({name:data.company,...data});const pw=password(data.password);const ids=await categoryIds(db,data.categories);
    const existing=await one(db,'SELECT id FROM supplier_users WHERE email=?',s.email);
    if(existing)fail(409,'This email is already registered. Sign in or contact the factory admin.');
    if((await one(db,"SELECT COUNT(*) AS n FROM suppliers WHERE workspace_id=? AND status='pending'",factories[0].id)).n>=500)fail(429,'The factory must review waiting registrations before accepting more.');
    const id=crypto.randomUUID(),userId=crypto.randomUUID(),salt=randomHex(16),hash=await passwordHash(pw,salt);
    try {await db.batch([query(db,"INSERT INTO suppliers(id,workspace_id,name,contact_name,email,phone,city,website,source_url,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'','','pending',?,?)",id,factories[0].id,s.name,s.contact,s.email,s.phone,s.city,now,now),
      ...categoryQueries(db,id,ids),query(db,'INSERT INTO supplier_users(id,supplier_id,email,name,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?)',userId,id,s.email,s.contact,hash,salt,now),
      audit(db,{workspace_id:factories[0].id,user_id:userId},'supplier.registered',id,{categories:ids},'supplier')]);}
    catch {fail(409,'The registration could not be saved. This email may already be registered.');}
    return json({pending:true,message:'Registration saved. Sign in to check its status. An admin must approve your company before you can bid.'},201);
  }
  if(path==='/api/portal/login'&&data) {
    keys(data,['email','password']);await throttle(db,request,'login',30,15*60_000);
    const address=email(data.email);const pw=password(data.password);
    const u=await one(db,'SELECT * FROM supplier_users WHERE email=?',address);
    if(u?.locked_until>now)fail(429,'Too many incorrect passwords. Try again in 15 minutes.');
    // Derive even for unknown emails to avoid a cheap timing-based user lookup.
    const derived=await passwordHash(pw,u?.password_salt??'unregistered-supplier');
    if(!u||!equal(derived,u.password_hash)) {
      if(u)await query(db,'UPDATE supplier_users SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts>=4 THEN ? ELSE locked_until END WHERE id=?',now+15*60_000,u.id).run();
      fail(401,'Email and password do not match.');
    }
    const token=randomHex(32);
    const old=tokenOf(request);
    await db.batch([query(db,'UPDATE supplier_users SET failed_attempts=0,locked_until=0 WHERE id=?',u.id),
      query(db,'DELETE FROM supplier_sessions WHERE expires_at<=? OR token_hash=?',now,old?await sha256(old):''),
      query(db,'INSERT INTO supplier_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)',await sha256(token),u.id,now,now+SESSION_MS)]);
    return json({signedIn:true},200,{'Set-Cookie':cookie(request,token)});
  }
  if(path==='/api/portal/logout'&&data) {
    keys(data,[]);const token=tokenOf(request);if(token)await query(db,'DELETE FROM supplier_sessions WHERE token_hash=?',await sha256(token)).run();
    return json({signedOut:true},200,{'Set-Cookie':cookie(request,null)});
  }
  const user=await supplierSession(db,request);
  if(!user)fail(401,'Sign in to the supplier portal.');
  if(path==='/api/portal/me'&&!data) {
    const supplier=await supplierView(db,await one(db,'SELECT id,name,contact_name,email,phone,city,status FROM suppliers WHERE id=?',user.supplier_id));
    return json({user:{id:user.user_id,name:user.user_name,email:user.user_email},supplier});
  }
  return supplierOperations(request,env,user,path,data);
}
