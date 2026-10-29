import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { inventoryApi } from '../server/inventory.mjs';
import { sqliteBinding } from '../server/sqlite.mjs';
import { seedRows, userRow } from '../server/auth.mjs';

const origin='https://yarnflow.test',pw='A strong test password 2026';
async function fixture() {
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 const dir=new URL('../drizzle/',import.meta.url);
 for(const f of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL(f,dir),'utf8'));
 for(const row of await seedRows('2468'))sql.prepare(row.sql).run(...row.args);
 const env={DB:sqliteBinding(sql)};
 async function request(path,data,cookie,headers={}) {
  const response=await inventoryApi(new Request(origin+'/api'+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
  return {status:response.status,data:await response.json(),cookie:response.headers.get('Set-Cookie')?.split(';')[0]};
 }
 const admin=(await request('/auth/login',{name:'Anas',pin:'2468'})).cookie;
 const staff=(path,data)=>request(path,data,admin);
 async function register(name='Alpha',cats=['cotton']) {
  const address=name.toLowerCase()+'@supplier.test';
  const r=await request('/portal/register',{company:name+' Mills',contactName:name+' Contact',email:address,phone:'+923001234567',city:'Karachi',password:pw,categories:cats});
  assert.equal(r.status,201,JSON.stringify(r.data));
  const id=sql.prepare('SELECT supplier_id FROM supplier_users WHERE email=?').get(address).supplier_id;
  return {id,email:address,login:()=>request('/portal/login',{email:address,password:pw})};
 }
 async function approve(supplier,status='approved') {
  const version=sql.prepare('SELECT version FROM suppliers WHERE id=?').get(supplier.id).version;
  const r=await staff('/erp/suppliers/review',{id:supplier.id,status,version,reason:'Company and contact checked by admin'});
  assert.equal(r.status,200,JSON.stringify(r.data));
 }
 async function active(name='Alpha',cats=['cotton']) {const s=await register(name,cats);await approve(s);s.cookie=(await s.login()).cookie;return s;}
 async function rfq(category='cotton') {
  const id=crypto.randomUUID(),now=Date.now();
  const r=await staff('/erp/rfqs',{id,title:'Cotton combed 30/1',categoryId:category,specifications:'Ring-spun 30/1, weaving grade',quantityMilli:100000,unit:'kg',deliveryLocation:'FAZ textile factory',deadlineAt:now+86400000,requestedDeliveryAt:now+7*86400000});
  assert.equal(r.status,201,JSON.stringify(r.data));return r.data.rfq;
 }
 const bid=(rfq,version=0,id=crypto.randomUUID())=>({id,rfqId:rfq.id,version,quantityMilli:rfq.quantity_milli,priceMinor:125000,currency:'PKR',paymentTerms:'30 days after confirmed delivery',deliveryAt:Date.now()+7*86400000,validUntil:Date.now()+3*86400000,note:'Freight included'});
 async function award(s,r) {assert.equal((await staff('/erp/rfqs/publish',{id:r.id})).status,200);const b=await request('/portal/bids',bid(r),s.cookie);assert.equal(b.status,201,JSON.stringify(b.data));const a=await staff('/erp/bids/award',{id:b.data.bid.id,version:1});assert.equal(a.status,201,JSON.stringify(a.data));return {order:a.data.order,bid:b.data.bid};}
 return {sql,request,staff,register,approve,active,rfq,bid,award,admin};
}

test('supplier registration hashes passwords, requires admin approval, and cannot use staff API',async()=>{
 const f=await fixture();const s=await f.register();const login=await s.login();assert.equal(login.status,200);
 assert.equal((await f.request('/portal/me',undefined,login.cookie)).data.supplier.status,'pending');
 assert.equal((await f.request('/portal/workspace',undefined,login.cookie)).status,403);
 assert.equal((await f.request('/workspace',undefined,login.cookie)).status,401);
 assert.equal((await f.request('/portal/me',undefined,f.admin)).status,401);
 const stored=f.sql.prepare('SELECT password_hash,password_salt FROM supplier_users').get();assert.notEqual(stored.password_hash,pw);assert.equal(stored.password_hash.length,64);
 await f.approve(s);assert.equal((await f.request('/portal/me',undefined,login.cookie)).status,401,'approval rotates/revokes pending sessions');
 const approved=await s.login();assert.equal((await f.request('/portal/workspace',undefined,approved.cookie)).status,200);
 await f.approve(s,'suspended');assert.equal((await f.request('/portal/workspace',undefined,approved.cookie)).status,401);
 const suspended=await s.login();assert.equal((await f.request('/portal/workspace',undefined,suspended.cookie)).status,403);
});
test('six categories, callable phone normalization, staff permissions and origin checks',async()=>{
 const f=await fixture();assert.equal((await f.staff('/erp/categories')).data.categories.length,6);
 const row=await userRow({workspaceId:f.sql.prepare('SELECT id FROM workspaces').get().id,name:'Purchase',pin:'2468',role:'purchase_manager'});f.sql.prepare(row.sql).run(...row.args);
 const c=(await f.request('/auth/login',{name:'Purchase',pin:'2468'})).cookie;
 const id=crypto.randomUUID();const d={id,name:'Directory Mill',contactName:'Sales desk',email:'sales@mill.test',phone:'+92 (300) 1234567',categories:['cotton'],sourceUrl:'https://mill.test/contact'};
 const r=await f.request('/erp/suppliers',d,c);assert.equal(r.status,201);assert.equal(r.data.supplier.phone,'+923001234567');assert.equal(r.data.supplier.status,'directory');
 const pending=await f.register();assert.equal((await f.request('/erp/suppliers/review',{id:pending.id,status:'approved',version:1,reason:'Reviewed company'},c)).status,403);
 assert.equal((await f.request('/erp/rfqs',{},c,{Origin:'https://attacker.test'})).status,403);
 assert.equal((await f.request('/erp/suppliers')).status,401);
});
test('admin review is versioned and atomic with category changes and session revocation',async()=>{
 const f=await fixture();const s=await f.register();await f.approve(s);
 const r=await f.staff('/erp/suppliers/review',{id:s.id,status:'rejected',version:1,reason:'Stale review request',categories:['synthetic']});
 assert.equal(r.status,409);assert.equal(f.sql.prepare('SELECT status FROM suppliers WHERE id=?').get(s.id).status,'approved');
 assert.equal(f.sql.prepare('SELECT category_id FROM supplier_category_links WHERE supplier_id=?').get(s.id).category_id,'cotton');
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM supplier_registration_reviews').get().n,1);
});
test('RFQ publication addresses only approved registered suppliers in the category and freezes recipients',async()=>{
 const f=await fixture();const a=await f.active();await f.active('Synthetic',['synthetic']);await f.register('Pending');
 const r=await f.rfq();assert.equal((await f.staff('/erp/rfqs/publish',{id:r.id})).data.recipients,1);
 assert.equal((await f.request('/portal/workspace',undefined,a.cookie)).data.rfqs.length,1);
 const later=await f.active('Later');assert.equal((await f.staff('/erp/rfqs/publish',{id:r.id})).data.recipients,1);
 assert.equal((await f.request('/portal/workspace',undefined,later.cookie)).data.rfqs.length,0);
 const unrelated=await f.rfq('processed');assert.equal((await f.staff('/erp/rfqs/publish',{id:unrelated.id})).status,409);
 assert.equal(f.sql.prepare('SELECT status FROM procurement_rfqs WHERE id=?').get(unrelated.id).status,'draft');
});
test('supplier bids are private, versioned, and awards freeze the accepted terms',async()=>{
 const f=await fixture(),a=await f.active(),b=await f.active('Beta');const r=await f.rfq();await f.staff('/erp/rfqs/publish',{id:r.id});
 const d=f.bid(r);const first=await f.request('/portal/bids',d,a.cookie);assert.equal(first.status,201);
 const second=await f.request('/portal/bids',{...d,version:1,priceMinor:120000},a.cookie);assert.equal(second.status,200);assert.equal(second.data.bid.version,2);
 assert.equal((await f.request('/portal/bids',{...d,version:1,priceMinor:110000},a.cookie)).status,409);
 assert.equal((await f.request('/portal/workspace',undefined,b.cookie)).data.bids.length,0);
 assert.equal((await f.request('/portal/bids',{...d,version:2},b.cookie)).status,409,'cannot overwrite another supplier bid ID');
 assert.equal((await f.staff('/erp/bids/award',{id:d.id,version:1})).status,409);
 const win=await f.staff('/erp/bids/award',{id:d.id,version:2});assert.equal(win.status,201,JSON.stringify(win.data));
 assert.equal(JSON.parse(win.data.order.terms_snapshot).price_minor,120000);
 assert.equal((await f.staff('/erp/bids/award',{id:d.id,version:2})).data.order.id,win.data.order.id);
 assert.equal((await f.request('/portal/bids',{...d,version:2},a.cookie)).status,409,'cannot edit awarded terms');
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM supplier_bid_history').get().n,2);
});
test('competing awards yield one PO and rejected bids cannot be silently resubmitted',async()=>{
 const f=await fixture(),a=await f.active(),b=await f.active('Beta');const r=await f.rfq();await f.staff('/erp/rfqs/publish',{id:r.id});
 const ba=(await f.request('/portal/bids',f.bid(r),a.cookie)).data.bid;
 const bb=(await f.request('/portal/bids',f.bid(r),b.cookie)).data.bid;
 const results=await Promise.all([f.staff('/erp/bids/award',{id:ba.id,version:1}),f.staff('/erp/bids/award',{id:bb.id,version:1})]);
 assert.deepEqual(results.map(x=>x.status).sort(),[201,409]);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM supplier_purchase_orders').get().n,1);
 const r2=await f.rfq();await f.staff('/erp/rfqs/publish',{id:r2.id});const d=f.bid(r2);await f.request('/portal/bids',d,a.cookie);
 assert.equal((await f.staff('/erp/bids/reject',{id:d.id,version:1,reason:'Delivery too late'})).status,200);
 assert.equal((await f.request('/portal/bids',{...d,version:1},a.cookie)).status,409);
});
test('supplier dispatch notices are scoped, quantity bounded, idempotent and never pretend tracking is live',async()=>{
 const f=await fixture(),a=await f.active(),b=await f.active('Beta');const r=await f.rfq();const {order}=await f.award(a,r);
 const d={id:crypto.randomUUID(),orderId:order.id,billOfLading:'TESTBL100',carrier:'Test carrier',containers:['ABCD1234567'],quantityMilli:60000,dispatchedAt:Date.now()-1000,note:'Supplier dispatch test'};
 assert.equal((await f.request('/portal/dispatches',d,b.cookie)).status,404);
 const sent=await f.request('/portal/dispatches',d,a.cookie);assert.equal(sent.status,201,JSON.stringify(sent.data));assert.equal(sent.data.shipment.tracking_status,'not_connected');
 assert.equal((await f.request('/portal/dispatches',d,a.cookie)).status,200);
 assert.equal((await f.request('/portal/dispatches',{...d,quantityMilli:50000},a.cookie)).status,409);
 assert.equal((await f.request('/portal/dispatches',{...d,id:crypto.randomUUID(),quantityMilli:50000},a.cookie)).status,409);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM procurement_shipments').get().n,1);
 const overview=await f.staff('/erp/procurement');assert.equal(overview.data.tracking.configured,false);assert.equal(overview.data.shipments.length,1);
});
test('expired deadlines and unsupported input cannot create operational records',async()=>{
 const f=await fixture(),a=await f.active();const r=await f.rfq();await f.staff('/erp/rfqs/publish',{id:r.id});
 f.sql.prepare('UPDATE procurement_rfqs SET deadline_at=? WHERE id=?').run(Date.now()-10000,r.id);
 assert.equal((await f.request('/portal/bids',f.bid(r),a.cookie)).status,409);
 assert.equal((await f.request('/portal/register',{company:'Injected',role:'admin'})).status,422);
 const c=await f.request('/portal/register',{company:'Weak company',contactName:'Contact',email:'weak@test.test',phone:'+923001234567',categories:['cotton'],password:'1234'});assert.equal(c.status,422);
});
test('password attempts lock the supplier identity and duplicate registration cannot claim its company',async()=>{
 const f=await fixture(),a=await f.register();
 assert.equal((await f.request('/portal/register',{company:'Hijack',contactName:'Contact',email:a.email,phone:'+923001234567',categories:['cotton'],password:pw})).status,409);
 for(let i=0;i<5;i++)assert.equal((await f.request('/portal/login',{email:a.email,password:'wrong password 1234'})).status,401);
 assert.equal((await a.login()).status,429);
});

test('purchase receipts create quarantined QR lots and exact ledger stock; QC gates raw issue',async()=>{
 const f=await fixture(),supplier=await f.active(),r=await f.rfq(),{order}=await f.award(supplier,r);
 const product=(await f.staff('/products',{sku:'COT-30',name:'Cotton combed 30/1'})).data;
 const d={id:crypto.randomUUID(),orderId:order.id,productId:product.id,batch:'RECEIPT-001',quantityMilli:40000,cartons:2,cones:40,supplierLot:'SUP-LOT-A'};
 const first=await f.staff('/erp/receipts',d);assert.equal(first.status,201,JSON.stringify(first.data));
 assert.equal((await f.staff('/erp/receipts',d)).status,200);
 assert.equal((await f.staff('/erp/receipts',{...d,quantityMilli:45000})).status,409);
 const state=(await f.staff('/workspace')).data;assert.equal(state.lots[0].quality,'uninspected');assert.equal(state.balances[0].grams,40000);
 const transfer={id:crypto.randomUUID(),lotId:d.id,action:'transfer',stage:'raw',toStage:'wip',grams:10000,cartons:0,cones:0,note:'Issue approved material'};
 assert.equal((await f.staff('/movements',transfer)).status,409);
 await f.staff('/quality',{lotId:d.id,status:'approved',note:'Physically inspected receipt'});
 assert.equal((await f.staff('/movements',transfer)).status,201);
 assert.equal((await f.staff('/erp/receipts',{...d,id:crypto.randomUUID(),batch:'EXCESS',quantityMilli:70000})).status,409);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM goods_receipts').get().n,1);
 assert.equal((await f.staff('/lookup?code='+encodeURIComponent('YF:'+d.id))).data.lotId,d.id);
});
test('receipt corrections reconcile the PO and cannot remove already used stock',async()=>{
 const f=await fixture(),supplier=await f.active(),r=await f.rfq(),{order}=await f.award(supplier,r);
 const product=(await f.staff('/products',{sku:'COT-30',name:'Cotton combed 30/1'})).data;
 const receipt={id:crypto.randomUUID(),orderId:order.id,productId:product.id,batch:'REV-001',quantityMilli:100000,cartons:2,cones:40,supplierLot:'SUP-A'};
 assert.equal((await f.staff('/erp/receipts',receipt)).status,201);
 assert.equal((await f.staff('/erp/inbound')).data.orders[0].status,'received');
 assert.equal((await f.staff('/reversals',{id:crypto.randomUUID(),movementId:receipt.id,note:'Correct delivery'})).status,409,'generic reversal cannot bypass PO reconciliation');
 const reverse={id:crypto.randomUUID(),receiptId:receipt.id,reason:'Wrong supplier delivery was booked'};
 assert.equal((await f.staff('/erp/receipts/reverse',reverse)).status,200);
 assert.equal((await f.staff('/erp/receipts/reverse',reverse)).status,200);
 assert.equal((await f.staff('/erp/inbound')).data.orders[0].status,'accepted');
 const next={...receipt,id:crypto.randomUUID(),batch:'REV-002'};assert.equal((await f.staff('/erp/receipts',next)).status,201);
 await f.staff('/quality',{lotId:next.id,status:'approved',note:'Physical receipt quality checked'});
 await f.staff('/movements',{id:crypto.randomUUID(),lotId:next.id,action:'transfer',stage:'raw',toStage:'wip',grams:1000,cartons:0,cones:0,note:'Production issue'});
 assert.equal((await f.staff('/erp/receipts/reverse',{id:crypto.randomUUID(),receiptId:next.id,reason:'Cannot reverse consumed stock'})).status,409);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM receipt_reversals').get().n,1);
});
test('tonne receipt quantities convert to grams exactly and inventory role does not receive supplier rates',async()=>{
 const f=await fixture(),supplier=await f.active();const r=await f.rfq();
 f.sql.prepare("UPDATE procurement_rfqs SET quantity_milli=1000,unit='tonne' WHERE id=?").run(r.id);
 const modified=f.sql.prepare('SELECT * FROM procurement_rfqs WHERE id=?').get(r.id),{order}=await f.award(supplier,modified);
 const product=(await f.staff('/products',{sku:'BULK-COT',name:'Bulk Cotton'})).data;
 const workspace=f.sql.prepare('SELECT id FROM workspaces').get().id,row=await userRow({workspaceId:workspace,name:'Inventory manager',pin:'2468',role:'supervisor'});f.sql.prepare(row.sql).run(...row.args);
 const c=(await f.request('/auth/login',{name:'Inventory manager',pin:'2468'})).cookie;
 assert.equal((await f.request('/erp/procurement',undefined,c)).status,403);
 const overview=await f.request('/erp/inbound',undefined,c);assert.equal(overview.status,200);assert.equal(JSON.stringify(overview.data).includes('price_minor'),false);
 const receipt=await f.request('/erp/receipts',{id:crypto.randomUUID(),orderId:order.id,productId:product.id,batch:'TONNE-001',quantityMilli:500,cartons:0,cones:0,supplierLot:''},c);
 assert.equal(receipt.status,201,JSON.stringify(receipt.data));assert.equal(receipt.data.receipt.grams,500000);
});
