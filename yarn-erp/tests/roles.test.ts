import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventTitle, objectRoute, parseHash } from '../src/routes.ts';
import { EVENTS } from '../server/notify.mjs';

test('every notification event has a title in both languages', () => {
  for (const event of EVENTS) assert.ok(eventTitle[event]?.[0] && eventTitle[event][1], event);
});
test('objectRoute falls back to notifications when the section is not built or not accessible', () => {
  const sales = { role: 'sales_manager', installedModules: [] } as const;
  const nav = { admin: [], purchase_manager: [], sales_manager: [{ id: 'dashboard' }], dispatch: [], quality_inspector: [], supervisor: [] };
  assert.equal(objectRoute('supplier', 'x1', sales, nav), '#/notifications');
  assert.equal(objectRoute('nothing', 'x1', sales, nav), '#/notifications');
  assert.equal(objectRoute('approval', 'a1', { role: 'admin', installedModules: [] }, nav), '#/notifications');
});
test('objectRoute resolves a section the role has, and admin module links', () => {
  const section = (id: string) => ({ id });
  const nav = { sales_manager: [], dispatch: [], quality_inspector: [], purchase_manager: [section('dashboard'), section('suppliers'), section('claims')], supervisor: [section('dashboard'), section('inventory')], admin: [section('dashboard'), section('approvals')] };
  assert.equal(objectRoute('supplier', 'x 1', { role: 'purchase_manager', installedModules: [] }, nav), '#/suppliers/x%201');
  assert.equal(objectRoute('claim', 'c1', { role: 'purchase_manager', installedModules: [] }, nav), '#/claims/c1');
  assert.equal(objectRoute('approval', 'a1', { role: 'admin', installedModules: [] }, nav), '#/approvals/a1');
  assert.equal(objectRoute('supplier', 'x1', { role: 'admin', installedModules: ['purchase_manager'] }, nav), '#/modules/purchase/suppliers/x1');
  assert.equal(objectRoute('supplier', 'x1', { role: 'admin', installedModules: ['supervisor'] }, nav), '#/notifications');
  assert.equal(objectRoute('qc_lot', 'l1', { role: 'admin', module: 'supervisor', installedModules: ['purchase_manager', 'supervisor'] }, nav), '#/modules/supervisor/inventory/l1');
  assert.equal(objectRoute('qc_lot', 'l1', { role: 'admin', module: 'quality_inspector', installedModules: ['supervisor'] }, nav), '#/notifications');
});
test('parseHash reads section, optional tab and id explicitly', () => {
  const tabs = { dispatches: ['pending_approval', 'approved'] };
  assert.deepEqual(parseHash('#/dispatches/approved/d1', tabs), { section: 'dispatches', tab: 'approved', id: 'd1' });
  assert.deepEqual(parseHash('#/dispatches/d1', tabs), { section: 'dispatches', tab: '', id: 'd1' });
  assert.deepEqual(parseHash('#/dispatches', tabs), { section: 'dispatches', tab: '', id: '' });
  assert.deepEqual(parseHash('', tabs), { section: 'dashboard', tab: '', id: '' });
});
