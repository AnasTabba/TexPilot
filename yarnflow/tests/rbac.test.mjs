import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { portalFixture, migrate, liveShapedRows, legacyMigrations } from './portal-fixture.mjs';
import { role, viewer, reason } from '../server/erp-utils.mjs';
import { ROLES, userRow } from '../server/auth.mjs';
const users = '/erp/admin/users', update = users + '/update';
test('existing users map to the closest of the six roles and keep signing in', async () => {
  const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON'); migrate(sql,legacyMigrations); liveShapedRows(sql);
  const sessions = sql.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  migrate(sql,['0004_sales.sql','0005_roles.sql']);
  for (const [name,expected] of Object.entries({Anas:'admin',Stores:'supervisor',Quality:'quality_inspector',Dispatch:'dispatch',Purchase:'purchase_manager',Everything:'supervisor',ViewOnly:'quality_inspector'})) assert.equal(sql.prepare('SELECT portal_role FROM users WHERE name=?').get(name).portal_role,expected);
  assert.equal(sql.prepare("SELECT status FROM users WHERE name='Pending'").get().status,'pending');
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,sessions);
  assert.deepEqual(sql.prepare('SELECT id FROM roles ORDER BY sort_order').all().map(r => r.id),ROLES);
  const f = await portalFixture(sql); assert.equal((await f.login('Stores')).status,200);
  const me = await f.member('Stores'); assert.equal(me.role,'supervisor'); assert.equal(Object.hasOwn(me,'permissions'),false);
});
test('admin creates users with exactly one of the six roles', async () => {
  const f = await portalFixture();
  assert.equal((await f.call(users,{name:'Pervaiz',pin:'1357',role:'purchase_manager'})).status,201);
  for (const role of ['owner','member',undefined]) assert.equal((await f.call(users,{name:'Invalid',pin:'1357',role})).status,422);
  await f.person('Saima','supervisor'); assert.equal((await f.call(users,{name:'Forbidden',pin:'1357',role:'dispatch'},'Saima')).status,403);
  const person = (await f.call(users)).data.users.find(p => p.name==='Pervaiz'); assert.equal(person.role,'purchase_manager'); assert.equal(person.status,'active');
  await assert.rejects(userRow({workspaceId:f.workspaceId,name:'Invalid',pin:'1357',role:'owner'}), /Unknown role/);
});
test('a deactivated user or one without a role cannot sign in; deactivation ends live sessions', async () => {
  const f = await portalFixture(), id = await f.person('Saima','supervisor');
  const {cookie,status} = await f.login('Saima'); assert.equal(status,200);
  assert.equal((await f.call(update,{id,active:false})).status,200);
  assert.equal((await f.call('/workspace',undefined,null,{Cookie:cookie})).status,401);
  const denied = await f.login('Saima'); assert.equal(denied.status,403); assert.equal(denied.data.error,'This account is deactivated. Ask an admin.');
  await f.person('No Role',null);
  const noRole = await f.login('No Role'); assert.equal(noRole.status,403); assert.equal(noRole.data.error,'An admin must assign your role first.');
  const names = (await f.call('/auth/people',undefined,null)).data.people; assert.ok(!names.includes('Saima')); assert.ok(!names.includes('No Role'));
  assert.equal((await f.call(update,{id,active:true})).status,200); assert.equal((await f.login('Saima')).status,200);
});
test('a role change applies on the very next request', async () => {
  const f = await portalFixture(), id = await f.person('Saima','supervisor');
  assert.equal((await f.call(users,undefined,'Saima')).status,403);
  assert.equal((await f.call(update,{id,role:'admin'})).status,200);
  assert.equal((await f.call(users,undefined,'Saima')).status,200);
});
test('self sign-up is gone', async () => {
  const f = await portalFixture(); assert.equal((await f.call('/auth/signup',{name:'New',pin:'1234'},null)).status,404);
  assert.equal((await f.call('/users')).status,404);
});
test('admins cannot deactivate themselves or demote the last active admin', async () => {
  const f = await portalFixture(); assert.equal((await f.call(update,{id:f.adminId,active:false})).status,409);
  for (const name of ['Fahad','Zuhair']) assert.equal((await f.call(update,{id:(await f.member(name)).user_id,role:'supervisor'})).status,200);
  const last = await f.call(update,{id:f.adminId,role:'supervisor'}); assert.equal(last.status,409); assert.equal(last.data.error,'Keep at least one admin.');
});
test('role(): owners pass, other roles get 403, admins need an intervention reason', () => {
  assert.equal(role({role:'supervisor'}, {}, 'supervisor'),null);
  assert.throws(() => role({role:'dispatch'}, {}, 'supervisor'), e => e.status===403);
  assert.throws(() => role({role:'admin',admin:true}, {}, 'supervisor'), e => e.status===422);
  assert.equal(role({role:'admin',admin:true}, {interventionReason:'Supervisor is on leave today'}, 'supervisor'),'Supervisor is on leave today');
  assert.equal(role({role:'admin',admin:true}, {}, 'admin'),null);
  assert.doesNotThrow(() => viewer({role:'admin',admin:true}, 'supervisor'));
  assert.throws(() => viewer({role:'dispatch'}, 'supervisor'), e => e.status===403);
  for (const value of [null,'four','x'.repeat(1001)]) assert.throws(() => reason(value),e => e.status===422);
});
test('PIN resets revoke sessions; pending activation and every account change are audited atomically', async () => {
  const f = await portalFixture();
  const created = await f.call(users,{name:'Saima',pin:'2468',role:'supervisor'}), id = created.data.id;
  assert.equal(created.status,201);
  const old = await f.login('Saima');
  assert.equal((await f.call(update,{id,pin:'1357'})).status,200);
  assert.equal((await f.call('/workspace',undefined,null,{Cookie:old.cookie})).status,401);
  assert.equal((await f.login('Saima','1357')).status,200);
  assert.equal((await f.call(update,{id,role:'quality_inspector'})).status,200);
  assert.equal((await f.call(update,{id,active:false})).status,200);
  assert.equal((await f.call(update,{id,active:true})).status,200);
  const logs = f.sql.prepare('SELECT action,actor_id,detail_json FROM erp_audit_events WHERE record_id=? ORDER BY rowid').all(id);
  assert.deepEqual(logs.map(r => r.action),['user.created','user.pin_reset','user.role_changed','user.deactivated','user.reactivated']);
  assert.ok(logs.every(r => r.actor_id===f.adminId)); assert.ok(!JSON.stringify(logs).includes('1357'));
  const pending = await userRow({workspaceId:f.workspaceId,name:'Waiting',pin:'2468',status:'pending'}); f.sql.prepare(pending.sql).run(...pending.args);
  assert.equal((await f.call(update,{id:pending.args[0],role:'dispatch',active:true})).status,200);
  assert.equal((await f.login('Waiting')).status,200);
  // If the audit write fails, neither account mutation nor session deletion may commit.
  const session = await f.login('Saima','1357');
  f.sql.exec("CREATE TRIGGER reject_test_audit BEFORE INSERT ON erp_audit_events BEGIN SELECT RAISE(ABORT,'test audit unavailable'); END");
  const { adminApi } = await import('../server/admin.mjs');
  await assert.rejects(adminApi(new Request('https://yarnflow.test/api/erp/admin/users/update',{method:'POST'}),f.env,await f.member('Anas'),'/api/erp/admin/users/update',{id,active:false}), /test audit unavailable/);
  assert.equal((await f.call('/workspace',undefined,null,{Cookie:session.cookie})).status,200);
  assert.equal(f.sql.prepare('SELECT deactivated_at FROM users WHERE id=?').get(id).deactivated_at,null);
});
test('competing demotions preserve one active admin and only audit committed edits', async () => {
  const f = await portalFixture();
  const fahad = (await f.member('Fahad')).user_id, zuhair = (await f.member('Zuhair')).user_id;
  assert.equal((await f.call(update,{id:zuhair,role:'supervisor'})).status,200);
  const { adminApi } = await import('../server/admin.mjs'), admin = await f.member('Anas');
  const results = await Promise.allSettled([f.adminId,fahad].map(id => adminApi(new Request('https://yarnflow.test/api/erp/admin/users/update',{method:'POST'}),f.env,admin,'/api/erp/admin/users/update',{id,role:'supervisor'})));
  assert.deepEqual(results.map(r => r.status === 'fulfilled' ? r.value.status : r.reason.status).sort(),[200,409]);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM users WHERE portal_role='admin' AND status='active' AND deactivated_at IS NULL").get().n,1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM erp_audit_events WHERE action='user.role_changed'").get().n,2);
});
test('concurrent edits cannot audit a stale transition; invalid and foreign targets stay untouched', async () => {
  const f = await portalFixture(), id = await f.person('Saima','supervisor');
  await f.login('Anas');
  const { adminApi } = await import('../server/admin.mjs'), admin = await f.member('Anas');
  const edits = await Promise.allSettled(['dispatch','quality_inspector'].map(role => adminApi(new Request('https://yarnflow.test/api/erp/admin/users/update',{method:'POST'}),f.env,admin,'/api/erp/admin/users/update',{id,role})));
  assert.deepEqual(edits.map(r => r.status === 'fulfilled' ? r.value.status : r.reason.status).sort(),[200,409]);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM erp_audit_events WHERE record_id=?').get(id).n,1);
  for (const body of [{id,active:'false'},{id,role:null},{id,pin:'abc'},{id,permissions:[]}]) assert.equal((await f.call(update,body)).status,422);
  f.sql.prepare('INSERT INTO workspaces VALUES(?,?,?)').run('other','Other factory',Date.now());
  const outsider = await userRow({workspaceId:'other',name:'Outsider',pin:'2468',role:'admin'}); f.sql.prepare(outsider.sql).run(...outsider.args);
  assert.equal((await f.call(update,{id:outsider.args[0],role:'dispatch'})).status,404);
  assert.equal((await f.call(users,{name:'Saima',pin:'2468',role:'dispatch'})).status,409);
});
test('effective access follows the six roles and the member has no permissions property', async () => {
  const f = await portalFixture(), finished = name => f.call('/erp/stock/finished', {}, name);
  for (const [name, r] of [['Saima','supervisor'],['Pervaiz','purchase_manager'],['Qasim','quality_inspector'],['Danish','dispatch'],['Sana','sales_manager']]) await f.person(name, r);
  assert.notEqual((await finished('Saima')).status, 403);
  for (const name of ['Pervaiz','Qasim','Danish','Sana']) assert.equal((await finished(name)).status, 403, name);
  assert.equal((await f.call(users, undefined, 'Saima')).status, 403);
  for (const name of ['Saima','Pervaiz','Qasim','Danish','Sana']) assert.equal(Object.hasOwn(await f.member(name), 'permissions'), false);
  assert.equal(Object.hasOwn(await f.member('Anas'), 'permissions'), false);
});
