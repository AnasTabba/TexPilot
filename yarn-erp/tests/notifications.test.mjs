import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';
import { notifyRole, notifyUser, PENDING_SOURCES, remindersScheduled } from '../server/notify.mjs';
import { approvalQueries, approvalsApi } from '../server/governance.mjs';
const hour=3600000, now=1800000000000;
const notices=f=>f.sql.prepare('SELECT * FROM notifications ORDER BY rowid').all();
async function raise(f, age=25, type='escalation') {
 const id=crypto.randomUUID(),m=await f.member('Supervisor');
 await f.env.DB.batch(approvalQueries(f.env.DB,m,{id,type,objectType:'lot',objectId:crypto.randomUUID(),amount:0,threshold:null,unit:'none'},now-age*hour));return id;
}
async function fixture(){const f=await portalFixture();await f.person('Supervisor','supervisor');return f;}
test('each user sees only their own notifications',async()=>{
 const f=await fixture(),inactive=await f.person('Inactive','supervisor');await f.person('Inspector','quality_inspector');
 f.sql.prepare('UPDATE users SET deactivated_at=1 WHERE id=?').run(inactive);
 await f.env.DB.batch([notifyRole(f.env.DB,f.workspaceId,'supervisor','stock_issue.raised','stock_issue',crypto.randomUUID(),'Lot 1024')]);
 const r=(await f.call('/erp/notifications',undefined,'Supervisor')).data;
 assert.equal(r.unread,1);assert.equal(r.notifications[0].event,'stock_issue.raised');assert.equal(notices(f).length,1);
 assert.equal((await f.call('/erp/notifications',undefined,'Inspector')).data.unread,0);
 assert.deepEqual((await f.call('/erp/notifications/read',{ids:[r.notifications[0].id]},'Inspector')).data,{read:0});
 assert.deepEqual((await f.call('/erp/notifications/read',{all:true},'Supervisor')).data,{read:1});
 assert.equal((await f.call('/erp/notifications',undefined,'Supervisor')).data.unread,0);
 assert.deepEqual((await f.call('/erp/notifications/read',{all:true},'Supervisor')).data,{read:0});
 for(const body of [{},{all:false},{ids:['bad']},{all:true,ids:[]},{ids:'bad'},{all:true,extra:1}])assert.equal((await f.call('/erp/notifications/read',body)).status,422);
 assert.equal((await f.call('/erp/notifications',undefined,null)).status,401);
});
test('a pending approval notifies every admin; the decision notifies the requesting role',async()=>{
 const f=await fixture(),id=await raise(f);assert.equal(notices(f).length,3);assert.ok(notices(f).every(n=>n.event==='approval.pending'));
 const path='/api/erp/approvals/decide';await approvalsApi(new Request('https://test'+path,{method:'POST'}),f.env,await f.member('Anas'),path,{id,decision:'approve'},{escalation:{approve:async()=>[]}});
 assert.equal(notices(f).filter(n=>n.event==='approval.decided'&&n.role==='supervisor').length,1);
 await raise(f,25,'purchase_award');assert.equal(notices(f).filter(n=>n.event==='award.pending_approval').length,3);
});
test('pending items older than 24 hours remind the responsible role once',async()=>{
 const f=await fixture();await raise(f);await raise(f,23);
 assert.deepEqual(await remindersScheduled(f.env,now),{checked:1,created:3});assert.equal((await remindersScheduled(f.env,now)).created,0);
 const g=await fixture();await raise(g);g.sql.prepare("INSERT INTO settings(workspace_id,key,value_json,created_by,created_at,updated_by,updated_at) VALUES(?,'reminder_hours','48',?,1,?,1)").run(g.workspaceId,g.adminId,g.adminId);
 assert.deepEqual(await remindersScheduled(g.env,now),{checked:0,created:0});
});
test('decided items never remind',async()=>{
 const f=await fixture();await raise(f,30);f.sql.exec("UPDATE approval_requests SET status='approved'");assert.equal((await remindersScheduled(f.env,now)).created,0);
});
test('concurrent reminder runs deduplicate per recipient and pending episode',async()=>{
 const f=await fixture();await raise(f);
 const results=await Promise.all([remindersScheduled(f.env,now),remindersScheduled(f.env,now)]);assert.equal(results.reduce((n,r)=>n+r.created,0),3);assert.equal((await remindersScheduled(f.env,now)).created,0);
 await f.person('Inspector','quality_inspector');f.sql.exec('CREATE TABLE test_qc(id TEXT,workspace_id TEXT,label TEXT,since INTEGER,status TEXT)');
 const id=crypto.randomUUID();f.sql.prepare("INSERT INTO test_qc VALUES(?,?, 'Lot 1024',?,'pending')").run(id,f.workspaceId,now-25*hour);
 PENDING_SOURCES.push({objectType:'test_qc',role:'quality_inspector',sql:"SELECT id,workspace_id,label,since FROM test_qc WHERE status='pending' AND since<=?"});
 try {
 assert.equal((await remindersScheduled(f.env,now)).created,1);
 f.sql.exec("UPDATE test_qc SET status='returned'");assert.equal((await remindersScheduled(f.env,now)).created,0);
 f.sql.prepare("UPDATE test_qc SET status='pending',since=?").run(now);assert.equal((await remindersScheduled(f.env,now+25*hour)).created,1);
 const reminders=notices(f).filter(n=>n.object_type==='test_qc');assert.equal(reminders.length,2);assert.notEqual(reminders[0].since,reminders[1].since);
 const n=reminders[0],cols=Object.keys(n);assert.throws(()=>f.sql.prepare(`INSERT INTO notifications(${cols}) VALUES(${cols.map(()=>'?')})`).run(...cols.map(k=>k==='id'?crypto.randomUUID():n[k])),/UNIQUE/);
 assert.throws(()=>f.sql.prepare("UPDATE notifications SET since=NULL WHERE id=?").run(n.id),/CHECK/);
 } finally {PENDING_SOURCES.pop();}
});
test('user notices respect workspace and active membership; inbox caps rows but counts all unread',async()=>{
 const f=await fixture(),id=(await f.member('Supervisor')).user_id;
 await f.env.DB.batch([notifyUser(f.env.DB,'other',id,'lot.ready','lot','x')]);assert.equal(notices(f).length,0);
 await f.env.DB.batch(Array.from({length:101},(_,i)=>notifyUser(f.env.DB,f.workspaceId,id,'lot.ready','lot',String(i))));
 const r=(await f.call('/erp/notifications',undefined,'Supervisor')).data;assert.equal(r.notifications.length,100);assert.equal(r.unread,101);
 assert.ok(notices(f).every(n=>n.since===null&&n.created_by==='system:notifications'&&n.created_at===n.updated_at));
});
