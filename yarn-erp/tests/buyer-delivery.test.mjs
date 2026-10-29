import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { portalFixture } from './portal-fixture.mjs';
import { inventoryApi } from '../server/inventory.mjs';
const uuid = () => crypto.randomUUID();
async function setup() {
 const f = await portalFixture();
 for (const [name,role] of [['Sana','sales_manager'],['Danish','dispatch']]) await f.person(name,role);
 const q = await f.acceptedQuote();
 const sale = await f.call('/erp/sales/sales',{id:uuid(),revisionId:q.revisionId},'Sana');
 assert.equal(sale.status,201,sale.text);
 const lotId = await f.addFinished({grams:10000});
 const requested = await f.call('/erp/dispatch',{id:uuid(),orderId:sale.data.order.id,lotId,quantityMilli:5000,grams:5000,cartons:0,cones:0},'Danish');
 assert.equal(requested.status,201,requested.text);
 await f.call('/erp/dispatch/requests/decide',{requestId:requested.data.requestId,decision:'approve'},'Sana');
 const sent=await f.call('/erp/dispatch/dispatched',{dispatchId:requested.data.dispatch.id},'Danish');
 assert.equal(sent.status,201,sent.text);
 const salesDispatchId=sent.data.dispatch.sales_dispatch_id;
 async function buyer(buyerId=q.buyerId) {
  const userId=uuid(), token=createHash('sha256').update(uuid()).digest('hex'), now=Date.now();
  f.sql.prepare("INSERT INTO buyer_users(id,buyer_id,email,name,password_hash,password_salt,created_at) VALUES(?,?,?,'Buyer Contact','unused','unused',?)").run(userId,buyerId,userId+'@buyer.test',now);
  f.sql.prepare('INSERT INTO buyer_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),userId,now,now+3600000);
  return async (path,body) => {
   const r=await inventoryApi(new Request('https://yarnflow.test/api/buyer/'+path,{method:body?'POST':'GET',headers:{Cookie:'yf_buyer_session='+token,Origin:'https://yarnflow.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),f.env);
   return {status:r.status,data:await r.json()};
  };
 }
 return {f,q,sale,dispatch:sent.data.dispatch,salesDispatchId,buyer};
}
test('buyer confirms their actual dispatch once, persists across sessions, and preserves invoice and stock',async()=>{
 const {f,sale,dispatch,salesDispatchId,buyer}=await setup(), call=await buyer();
 const before=f.sql.prepare('SELECT * FROM invoices WHERE id=?').get(sale.data.invoice.id);
 const body={id:uuid(),dispatchId:salesDispatchId,deliveryDate:Date.now(),note:'Received all five kg'};
 const confirmed=await call('deliveries/confirm',body);
 assert.equal(confirmed.status,201,JSON.stringify(confirmed.data));
 assert.equal(confirmed.data.delivery.dispatch_id,salesDispatchId);
 assert.equal(f.sql.prepare('SELECT status FROM dispatches WHERE id=?').get(dispatch.id).status,'delivered');
 assert.equal((await call('deliveries/confirm',body)).status,200);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sales_deliveries').get().n,1);
 assert.deepEqual(f.sql.prepare('SELECT * FROM invoices WHERE id=?').get(before.id),before,'issued money and due terms stay immutable');
 const fresh=await buyer(); const state=await fresh('workspace');
 assert.equal(state.data.deliveries.length,1);
 assert.equal(state.data.invoices[0].outstanding_minor,before.total_minor);
 assert.equal(state.data.invoices[0].due_at,before.due_at);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM receivables').get().n,0,'confirmation does not create a second invoice obligation');
 assert.equal(state.data.dispatches[0].delivery_status,'delivered');
 assert.equal(f.sql.prepare("SELECT grams FROM balances WHERE lot_id=? AND stage='finished'").get(dispatch.lot_id).grams,5000,'receipt confirmation never moves stock again');
});
test('another buyer, suspended buyer and reversed dispatch cannot confirm delivery',async()=>{
 const {f,q,dispatch,salesDispatchId,buyer}=await setup();
 const other=await buyer(await f.insertBuyer({status:'active'}));
 const body={id:uuid(),dispatchId:salesDispatchId,deliveryDate:Date.now(),note:''};
 assert.equal((await other('deliveries/confirm',body)).status,404);
 const own=await buyer();
 f.sql.prepare("UPDATE buyers SET status='suspended' WHERE id=?").run(q.buyerId);
 assert.equal((await own('deliveries/confirm',body)).status,403);
 f.sql.prepare("UPDATE buyers SET status='active' WHERE id=?").run(q.buyerId);
 assert.equal((await f.call('/erp/dispatch/dispatched/reverse',{id:uuid(),dispatchId:dispatch.id,reason:'Loaded the wrong batch'},'Danish')).status,201);
 assert.equal((await own('deliveries/confirm',body)).status,409);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sales_deliveries').get().n,0);
 assert.equal((await own('workspace')).data.dispatches.length,0,'reversed dispatches disappear from buyer pending receipts');
});
