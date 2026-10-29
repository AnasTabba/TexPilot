import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { inventoryApi } from '../server/inventory.mjs';
import { collaborationApi, portalCollaborationApi } from '../server/collaboration.mjs';
import { sqliteBinding } from '../server/sqlite.mjs';
import { seedRows, userRow, sessionToken, sha256 } from '../server/auth.mjs';

const origin='https://collab.test', PW='A strong test password 2026';
test('debug', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  const dir=new URL('../drizzle/', import.meta.url);
  for (const f of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(f,dir),'utf8'));
  for (const row of await seedRows('2468')) sql.prepare(row.sql).run(...row.args);
  const env={DB:sqliteBinding(sql)};
  const call=async(path,data,cookie,headers={})=>{
    const r=await inventoryApi(new Request(origin+'/api'+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
    return {status:r.status,data:await r.json().catch(()=>({})),cookie:r.headers.get('Set-Cookie')?.split(';')[0]};
  };
  const wsId=sql.prepare('SELECT id FROM workspaces').get().id;
  async function user(name,permissions=[],role='member',status='active'){
    const existing=sql.prepare('SELECT id FROM users WHERE name=?').get(name);
    if(!existing){const row=await userRow({workspaceId:wsId,name,pin:'2468',permissions,role,status});sql.prepare(row.sql).run(...row.args);}
    return (await call('/auth/login',{name,pin:'2468'})).cookie;
  }
  async function supplier(name){
    const email=`${name.toLowerCase()}@mill.test`;
    const registered=await call('/portal/register',{company:`${name} Mills`,contactName:`${name} Contact`,email,phone:'+923001234567',city:'Karachi',password:PW,categories:['cotton']});
    const id=sql.prepare('SELECT supplier_id FROM supplier_users WHERE email=?').get(email).supplier_id;
    await (async()=>{const admin=(await call('/auth/login',{name:'Anas',pin:'2468'})).cookie; await call('/erp/suppliers/review',{id,status:'approved',version:1,reason:'Company and contact checked by admin'},admin);})();
    return {id,email,cookie:(await call('/portal/login',{email,password:PW})).cookie};
  }
  const s=await supplier('Threadmill');
  const rival=await supplier('Rivallmill');
  await user('Threadmgr',['suppliers']);
  const threadmgr=(await call('/auth/login',{name:'Threadmgr',pin:'2468'})).cookie;
  const collab=async(path,data,cookie)=>{const url=`${origin}/api/erp${path}`;const req=new Request(url,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}: {})},...(data===undefined?{}:{body:JSON.stringify(data)})});const token=sessionToken(req);const row=token?sql.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'").get(await sha256(token),Date.now()):null;const member={user_id:row.id,workspace_id:row.workspace_id,name:row.name,admin:row.role==='admin',permissions:row.role==='admin'?JSON.parse('["receive","produce","dispatch","catalog","inspect","qc","waste","reverse","suppliers","procure","sales","production","payments"]'):JSON.parse(row.permissions)};const r=await collaborationApi(req,env,member,new URL(url).pathname,data);return {status:r.status,data:await r.json().catch(()=>({}))};};
  const thread=await collab('/collaboration/conversations',{id:crypto.randomUUID(),kind:'external',supplierId:s.id},threadmgr);
  console.log('thread create', thread.status, JSON.stringify(thread.data));
  const threadId=thread.data.conversation?.id;
  const portalCall=async(path,data,cookie,which=s.email)=>{const u=sql.prepare(`SELECT u.id AS user_id, u.name AS user_name, u.email AS user_email, u.supplier_id, s.workspace_id, s.status FROM supplier_users u JOIN suppliers s ON s.id=u.supplier_id WHERE u.email=?`).get(which);const req=new Request(origin+'/api'+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}: {})},...(data===undefined?{}:{body:JSON.stringify(data)})});const r=await portalCollaborationApi(req,env,u,path,data);return {status:r.status,data:await r.json().catch(()=>({}))};};
  const r=await portalCall(`/portal/collab/threads/${threadId}/messages`,undefined,s.cookie,rival.email);
  console.log('rival read status',r.status,JSON.stringify(r.data).slice(0,200));
  console.log('s supplier_id',s.id,'rival supplier_id',rival.id);
  // done
});
