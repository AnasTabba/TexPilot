import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';
import { THRESHOLDS, DEFAULT_SETTINGS, thresholdOf, settingsOf } from '../server/governance.mjs';
import { noteSale, recordAcceptance } from '../server/sales.mjs';
const thresholds='/erp/admin/thresholds', settings='/erp/admin/settings';
const rows=(f,table)=>f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
test('only admin sets each of the four thresholds; history records who, old, new and when',async()=>{
 const f=await portalFixture();
 assert.deepEqual(THRESHOLDS,['purchase','inventory_adjustment','claim','dispatch_stock_issue']);
 for(const type of THRESHOLDS){
  for(const value of [50000000,75000000]) assert.equal((await f.call(thresholds,{type,value})).status,200);
  assert.equal(await thresholdOf(f.env.DB,f.workspaceId,type),75000000);
  const h=rows(f,'threshold_history').filter(r=>r.type===type);
  assert.deepEqual(h.map(r=>[r.old_value,r.new_value,r.changed_by]),[[null,50000000,f.adminId],[50000000,75000000,f.adminId]]);
  for(const r of h){assert.equal(typeof r.changed_at,'number');assert.equal(r.created_by,f.adminId);assert.equal(r.created_at,r.changed_at);assert.equal(r.updated_at,r.changed_at);assert.equal(r.status,'recorded');}
 }
 const audit=rows(f,'erp_audit_events').at(-1);assert.equal(audit.action,'threshold.changed');assert.deepEqual(JSON.parse(audit.old_json),{value:50000000});assert.deepEqual(JSON.parse(audit.new_json),{value:75000000});
 for(const body of [{type:'payroll',value:1},{type:'claim',value:-1},{type:'claim',value:1.5},{type:'claim',value:Number.MAX_SAFE_INTEGER+1}])assert.equal((await f.call(thresholds,body)).status,422);
 for(const role of ['purchase_manager','quality_inspector','supervisor','sales_manager','dispatch']){
  await f.person(role,role);for(const path of [thresholds,settings]){assert.equal((await f.call(path,undefined,role)).status,403);assert.equal((await f.call(path,path===thresholds?{type:'claim',value:1}:{key:'reminder_hours',value:48},role)).status,403);}
 }
 const result=await f.call(thresholds);assert.equal(result.status,200);assert.equal(result.data.thresholds.length,4);assert.equal(result.data.history.length,8);assert.ok(result.data.thresholds.every(r=>r.updated_by_name==='Anas'));assert.ok(result.data.history.every(r=>r.changed_by_name==='Anas'));
});
test('threshold history cannot be edited or deleted',async()=>{
 const f=await portalFixture();await f.call(thresholds,{type:'purchase',value:100});const before=rows(f,'threshold_history');assert.equal(before.length,1);
 for(const sql of ['UPDATE threshold_history SET new_value=1','DELETE FROM threshold_history']){assert.throws(()=>f.sql.exec(sql),/immutable threshold history/);assert.deepEqual(rows(f,'threshold_history'),before);}
});
test('an unset threshold is not configured, so decisions stay final as before',async()=>{
 const f=await portalFixture();assert.equal(await thresholdOf(f.env.DB,f.workspaceId,'claim'),null);assert.equal((await f.call(thresholds)).data.thresholds.length,0);
});
test('settings defaults, validation, sorted alerts and before/after audit',async()=>{
 const f=await portalFixture();const defaults={currency:'PKR',tax_rate_bp:1800,invoice_format:'INV-{YYYY}-{NNNN}',reminder_hours:24,credit_alert_days:[7,3]};assert.deepEqual(DEFAULT_SETTINGS,defaults);assert.deepEqual(await settingsOf(f.env.DB,f.workspaceId),defaults);assert.deepEqual((await f.call(settings)).data,{settings:defaults});
 for(const [key,value] of [['invoice_format','INV-{NNNN}'],['invoice_format','{YYYY}-{YYYY}-{NNNN}'],['invoice_format','INV_{YYYY}-{NNNN}'],['tax_rate_bp',10001],['tax_rate_bp',1.5],['reminder_hours',0],['reminder_hours',721],['credit_alert_days',[]],['credit_alert_days',[7,7]],['credit_alert_days',[91]],['currency','BTC'],['unknown',1]])assert.equal((await f.call(settings,{key,value})).status,422,`${key}: ${value}`);
 for(const [key,value] of [['invoice_format','FAZ-{YYYY}-{NNNN}'],['tax_rate_bp',0],['tax_rate_bp',10000],['reminder_hours',720],['credit_alert_days',[1,7,3]]])assert.equal((await f.call(settings,{key,value})).status,200);
 assert.deepEqual((await settingsOf(f.env.DB,f.workspaceId)).credit_alert_days,[7,3,1]);const a=rows(f,'erp_audit_events').at(-1);assert.equal(a.action,'setting.changed');assert.deepEqual(JSON.parse(a.old_json),{value:[7,3]});assert.deepEqual(JSON.parse(a.new_json),{value:[7,3,1]});
});
test('currency changes preserve threshold denomination and isolate workspaces',async()=>{
 const f=await portalFixture();for(const type of THRESHOLDS)await f.call(thresholds,{type,value:100});
 assert.equal((await f.call(settings,{key:'currency',value:'USD'})).status,200);
 for(const type of THRESHOLDS)assert.equal(await thresholdOf(f.env.DB,f.workspaceId,type),['purchase','claim'].includes(type)?null:100);
 assert.equal((await f.call(thresholds,{type:'purchase',value:200})).status,200);
 const h=rows(f,'threshold_history').at(-1);assert.deepEqual([h.old_value,h.new_value,h.old_currency,h.new_currency],[100,200,'PKR','USD']);assert.equal(await thresholdOf(f.env.DB,f.workspaceId,'purchase'),200);
 assert.equal(await thresholdOf(f.env.DB,'other','purchase'),null);assert.deepEqual(await settingsOf(f.env.DB,'other'),DEFAULT_SETTINGS);
});
function insert(f,table,data){const cols=Object.keys(data);f.sql.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...Object.values(data));}
function commercial(f,kind,currency='PKR'){
 const now=Date.now(),w=f.workspaceId,u=f.adminId,id=crypto.randomUUID();
 if(kind==='bid'){
  insert(f,'suppliers',{id,workspace_id:w,name:id,contact_name:'Contact',email:'test@test.com',phone:'+923001234567',status:'approved',created_at:now,updated_at:now});
  insert(f,'procurement_rfqs',{id,workspace_id:w,reference:id,title:'Cotton',category_id:'cotton',specifications:'Cotton yarn',quantity_milli:1000,unit:'kg',delivery_location:'Karachi',deadline_at:now+86400000,requested_delivery_at:now+86400000,status:'open',request_hash:id,created_by:u,created_at:now});
  insert(f,'rfq_recipients',{rfq_id:id,supplier_id:id,supplier_snapshot:'{}',delivered_at:now});
  return {id,write:()=>insert(f,'supplier_bids',{id,rfq_id:id,supplier_id:id,quantity_milli:1000,price_minor:100,currency,payment_terms:'Net 30',delivery_at:now+86400000,valid_until:now+86400000,note:'',status:'submitted',created_at:now,updated_at:now})};
 }
 insert(f,'buyers',{id,workspace_id:w,name:id,contact_name:'Contact',email:'test@test.com',phone:'+923001234567',status:'active',created_at:now,updated_at:now});
 insert(f,'buyer_purchase_orders',{id,workspace_id:w,buyer_id:id,reference:id,specifications:'Cotton',quantity_milli:1000,unit:'kg',requested_delivery_at:now+86400000,payment_terms:'Net 30',status:'entered',source:'staff',request_hash:id,created_by:u,actor_type:'staff',created_at:now,updated_at:now});
 const quote=()=>insert(f,'sales_quote_revisions',{id,workspace_id:w,buyer_po_id:id,buyer_id:id,version:1,quantity_milli:1000,unit:'kg',price_minor:100,currency,specifications:'Cotton',requested_delivery_at:now+86400000,payment_terms:'Net 30',status:'draft',created_by:u,created_at:now,updated_at:now});
 if(kind==='quote')return {id,write:quote};
 quote();f.sql.prepare("UPDATE sales_quote_revisions SET status='sent' WHERE id=?").run(id);f.sql.prepare("UPDATE sales_quote_revisions SET status='approved' WHERE id=?").run(id);
 insert(f,'sales_orders',{id,workspace_id:w,reference:id,buyer_id:id,buyer_po_id:id,revision_id:id,status:'confirmed',terms_snapshot:'{}',created_by:u,created_at:now});
 return {id,write:()=>insert(f,'invoices',{id,workspace_id:w,number:id,sales_order_id:id,revision_id:id,buyer_id:id,lines_json:'[]',total_minor:100,currency,issued_at:now})};
}
async function changeCurrency(f,value='USD'){return f.call(settings,{key:'currency',value});}
test('currency changes refuse incompatible active commercial records',async()=>{
 for(const kind of ['bid','quote','invoice']){
  const f=await portalFixture(),c=commercial(f,kind);c.write();
  const before=['settings','threshold_history','erp_audit_events'].map(t=>rows(f,t));const result=await changeCurrency(f);assert.equal(result.status,409,kind);assert.equal(result.data.error,'Close open bids and unaccepted quotations and settle unpaid invoices before changing currency.');
  assert.deepEqual(['settings','threshold_history','erp_audit_events'].map(t=>rows(f,t)),before);
  assert.equal((await changeCurrency(f,'PKR')).status,200);
  if(kind==='bid')f.sql.prepare("UPDATE supplier_bids SET status='rejected' WHERE id=?").run(c.id);
  if(kind==='quote'){f.sql.prepare("UPDATE sales_quote_revisions SET status='sent' WHERE id=?").run(c.id);assert.equal((await changeCurrency(f)).status,409);f.sql.prepare("UPDATE sales_quote_revisions SET status='approved' WHERE id=?").run(c.id);}
  if(kind!=='invoice')assert.equal((await changeCurrency(f)).status,200);
 }
});
test('commercial creation racing currency changes commits only compatible state',async()=>{
 for(const kind of ['bid','quote']){
  const f=await portalFixture(),c=commercial(f,kind),batch=f.env.DB.batch;await f.login('Anas');
  f.env.DB.batch=async statements=>{c.write();return batch(statements);};
  assert.equal((await changeCurrency(f)).status,409);assert.equal((await settingsOf(f.env.DB,f.workspaceId)).currency,'PKR');
  const g=await portalFixture(),d=commercial(g,kind);assert.equal((await changeCurrency(g)).status,200);assert.throws(d.write,/factory currency/);
 }
});
test('a concurrent threshold or setting edit aborts stale writes and their audit',async()=>{
 for(const path of [thresholds,settings]){
  const f=await portalFixture(),body=path===thresholds?{type:'purchase',value:100}:{key:'reminder_hours',value:48};await f.call(path,body);
  const batch=f.env.DB.batch;f.env.DB.batch=async statements=>{f.env.DB.batch=batch;assert.equal((await f.call(path,{...body,value:200})).status,200);return batch(statements);};
  assert.equal((await f.call(path,{...body,value:300})).status,409);assert.equal(rows(f,'erp_audit_events').length,2);
  assert.equal(path===thresholds?await thresholdOf(f.env.DB,f.workspaceId,'purchase'):(await settingsOf(f.env.DB,f.workspaceId)).reminder_hours,200);
 }
});
function receivable(f,id){
 const now=Date.now(),w=f.workspaceId,u=f.adminId;
 insert(f,'products',{id,workspace_id:w,sku:id,name:'Cotton',created_at:now});
 insert(f,'lots',{id,workspace_id:w,product_id:id,batch:id,quality:'approved',created_at:now});
 insert(f,'balances',{lot_id:id,stage:'finished',grams:1000,cartons:0,cones:0});
 insert(f,'movements',{id,workspace_id:w,lot_id:id,action:'dispatch',from_stage:'finished',to_stage:null,grams:1000,cartons:0,cones:0,note:'Dispatch',actor:u,actor_name:'Anas',request_hash:id,created_at:now});
 insert(f,'sales_order_lines',{id,workspace_id:w,sales_order_id:id,product_id:id,specifications:'Cotton',quantity_milli:1000,unit:'kg',created_at:now});
 insert(f,'sales_dispatches',{id,workspace_id:w,sales_order_id:id,movement_id:id,lot_id:id,from_stage:'finished',quantity_milli:1000,unit:'kg',grams:1000,carrier:'Carrier',dispatched_at:now,request_hash:id,created_by:u,created_at:now});
 insert(f,'sales_deliveries',{id,workspace_id:w,dispatch_id:id,delivery_date:now,confirmed_by:u,created_at:now});
 insert(f,'receivables',{id,workspace_id:w,invoice_id:id,delivery_id:id,buyer_id:id,amount_minor:100,currency:'PKR',due_at:now+86400000,status:'open',created_at:now});
}
test('closed bids, accepted quotes and fully paid invoices allow currency changes; partial payment does not',async()=>{
 const f=await portalFixture(),bid=commercial(f,'bid'),quote=commercial(f,'quote'),invoice=commercial(f,'invoice');bid.write();quote.write();invoice.write();
 f.sql.prepare("UPDATE procurement_rfqs SET status='closed' WHERE id=?").run(bid.id);assert.equal((await changeCurrency(f)).status,409);
 f.sql.prepare("UPDATE supplier_bids SET status='rejected' WHERE id=?").run(bid.id);
 f.sql.prepare("UPDATE sales_quote_revisions SET status='sent' WHERE id=?").run(quote.id);f.sql.prepare("UPDATE sales_quote_revisions SET status='approved' WHERE id=?").run(quote.id);
 receivable(f,invoice.id);
 const pay=amount=>insert(f,'sales_payments',{id:crypto.randomUUID(),workspace_id:f.workspaceId,invoice_id:invoice.id,receivable_id:invoice.id,amount_minor:amount,currency:'PKR',actor_id:f.adminId,actor_name:'Anas',created_at:Date.now()});
 pay(40);assert.equal((await changeCurrency(f)).status,409);pay(60);assert.equal((await changeCurrency(f)).status,200);assert.equal((await changeCurrency(f)).status,200);
 assert.equal((await settingsOf(f.env.DB,f.workspaceId)).currency,'USD');
 assert.equal(f.sql.prepare('SELECT currency FROM invoices WHERE id=?').get(invoice.id).currency,'PKR');
});
test('database guards cover direct currency writes, commercial inserts and threshold denomination races',async()=>{
 const f=await portalFixture(),c=commercial(f,'bid');c.write();
 assert.throws(()=>insert(f,'settings',{workspace_id:f.workspaceId,key:'currency',value_json:'"USD"',created_by:f.adminId,created_at:1,updated_by:f.adminId,updated_at:1}),/Close open bids/);
 assert.equal((await changeCurrency(f,'PKR')).status,200);
 assert.throws(()=>f.sql.exec(`UPDATE settings SET value_json='"USD"' WHERE key='currency'`),/Close open bids/);
 assert.throws(()=>f.sql.exec(`UPDATE supplier_bids SET currency='USD'`),/factory currency/);
 const g=await portalFixture(),invoice=commercial(g,'invoice');assert.equal((await changeCurrency(g)).status,200);assert.throws(()=>insert(g,'invoices',{id:invoice.id,workspace_id:g.workspaceId,number:invoice.id,sales_order_id:invoice.id,revision_id:invoice.id,buyer_id:invoice.id,lines_json:'[]',total_minor:100,currency:'USD',issued_at:Date.now()}),/accepted quotation currency/);invoice.write();assert.equal(g.sql.prepare('SELECT currency FROM invoices WHERE id=?').get(invoice.id).currency,'PKR');
 const h=await portalFixture(),batch=h.env.DB.batch;await h.login('Anas');
 h.env.DB.batch=async statements=>{h.env.DB.batch=batch;assert.equal((await changeCurrency(h)).status,200);return batch(statements);};
 assert.equal((await h.call(thresholds,{type:'purchase',value:100})).status,409);assert.equal(rows(h,'thresholds').length,0);assert.equal(rows(h,'threshold_history').length,0);assert.equal(rows(h,'erp_audit_events').length,1);
});
test('sales reads configured currency and drafts quotations after a currency change',async()=>{
 const f=await portalFixture(),c=commercial(f,'quote');
 assert.equal((await f.call('/erp/sales')).data.settings.currency,'PKR');
 assert.equal((await changeCurrency(f)).status,200);
 await f.person('Sales','sales_manager');
 const overview=await f.call('/erp/sales',undefined,'Sales');
 assert.equal(overview.status,200);assert.equal(overview.data.settings.currency,'USD');
 const result=await f.call('/erp/sales/quotes',{id:crypto.randomUUID(),poId:c.id,priceMinor:100,specifications:'Cotton yarn',requestedDeliveryAt:Date.now()+86400000,paymentTerms:'Net 30',creditDays:30},'Sales');
 assert.equal(result.status,201);assert.equal(result.data.revision.currency,'USD');
});
test('a currency change racing a quotation returns the currency error and rolls back its audit',async()=>{
 const f=await portalFixture(),c=commercial(f,'quote');await f.login('Anas');
 const before=rows(f,'erp_audit_events'),batch=f.env.DB.batch;
 f.env.DB.batch=async statements=>{f.env.DB.batch=batch;assert.equal((await changeCurrency(f)).status,200);return batch(statements);};
 const result=await f.call('/erp/sales/quotes',{id:crypto.randomUUID(),poId:c.id,priceMinor:100,specifications:'Cotton yarn',requestedDeliveryAt:Date.now()+86400000,paymentTerms:'Net 30',creditDays:30,interventionReason:'Covering for the sales manager'});
 assert.equal(result.status,409);assert.equal(result.data.error,'Use the factory currency. Reload to get the current currency.');
 assert.equal(rows(f,'sales_quote_revisions').length,0);assert.equal(rows(f,'erp_audit_events').length,before.length+1);assert.equal(rows(f,'erp_audit_events').at(-1).action,'setting.changed');
});
test('credit notes settle an invoice for currency changes; superseded and cancelled quotations do not block',async()=>{
 const f=await portalFixture();await f.person('Sales','sales_manager');const sales=await f.member('Sales');
 const q=await f.acceptedQuote(),{invoice}=await noteSale(f.env.DB,sales,{id:crypto.randomUUID(),revisionId:q.revisionId});
 const credit=amountMinor=>f.call('/erp/sales/credit-notes',{id:crypto.randomUUID(),invoiceId:invoice.id,amountMinor,reason:'Goods returned'},'Sales');
 assert.equal((await changeCurrency(f)).status,409);
 assert.equal((await credit(invoice.total_minor-1)).status,201);assert.equal((await changeCurrency(f)).status,409);
 assert.equal((await credit(1)).status,201);
 // v1 stays "sent" after v2 replaces it; once v2 is accepted neither blocks, and a cancelled RFQ's draft never does.
 const buyerId=await f.insertBuyer({status:'active'}),rfqId=await f.insertBuyerRfq({buyerId}),revisions=[];
 for(const price of [100,200]){const draft=await f.call('/erp/sales/quotes',{id:crypto.randomUUID(),poId:rfqId,priceMinor:price,specifications:'Cotton yarn',requestedDeliveryAt:Date.now()+86400000,paymentTerms:'Net 30',creditDays:30},'Sales');
  assert.equal((await f.call('/erp/sales/quotes/send',{id:draft.data.revision.id},'Sales')).status,200);revisions.push(draft.data.revision);}
 assert.equal((await changeCurrency(f)).status,409);
 await recordAcceptance(f.env.DB,{workspaceId:f.workspaceId,revisionId:revisions[1].id,version:2,buyerId,acceptedBy:'Buyer Contact',now:Date.now()});
 const other=await f.insertBuyer({status:'active'}),otherRfq=await f.insertBuyerRfq({buyerId:other});
 assert.equal((await f.call('/erp/sales/quotes',{id:crypto.randomUUID(),poId:otherRfq,priceMinor:100,specifications:'Cotton yarn',requestedDeliveryAt:Date.now()+86400000,paymentTerms:'Net 30',creditDays:30},'Sales')).status,201);
 assert.equal((await changeCurrency(f)).status,409,'a live draft blocks');
 assert.equal((await f.call('/erp/sales/buyers/review',{id:other,status:'rejected',version:1,reason:'Company could not be verified'},'Sales')).status,200);
 assert.equal((await changeCurrency(f)).status,200);
});
test('invoice payments block currency changes until fully paid or credited',async()=>{
 for(const credit of [0,750000]){
  const f=await portalFixture();await f.person('Sana','sales_manager');const q=await f.acceptedQuote(),{invoice}=await noteSale(f.env.DB,await f.member('Sana'),{id:crypto.randomUUID(),revisionId:q.revisionId});
  if(credit)assert.equal((await f.call('/erp/sales/credit-notes',{id:crypto.randomUUID(),invoiceId:invoice.id,amountMinor:credit,reason:'Goods returned'},'Sana')).status,201);
  const pay=amountMinor=>f.call('/erp/sales/payments',{id:crypto.randomUUID(),invoiceId:invoice.id,amountMinor,receivedAt:Date.now()},'Sana');
  assert.equal((await pay(5000000)).status,201);assert.equal((await changeCurrency(f)).status,409);
  assert.equal(rows(f,'erp_audit_events').filter(r=>r.action==='setting.changed').length,0);
  assert.throws(()=>insert(f,'settings',{workspace_id:f.workspaceId,key:'currency',value_json:'"USD"',created_by:f.adminId,created_at:1,updated_by:f.adminId,updated_at:1}),/Close open bids/);
  assert.equal((await pay(invoice.total_minor-credit-5000000)).status,201);assert.equal((await changeCurrency(f)).status,200);
 }
});
test('currency switch losing a race to an unpaid invoice aborts its audit',async()=>{
 const f=await portalFixture(),q=await f.acceptedQuote(),batch=f.env.DB.batch;await f.login('Anas');const member=await f.member('Anas');
 f.env.DB.batch=async statements=>{f.env.DB.batch=batch;await noteSale(f.env.DB,member,{id:crypto.randomUUID(),revisionId:q.revisionId});return batch(statements);};
 assert.equal((await changeCurrency(f)).status,409);assert.equal((await settingsOf(f.env.DB,f.workspaceId)).currency,'PKR');assert.equal(rows(f,'erp_audit_events').filter(r=>r.action==='setting.changed').length,0);assert.equal(rows(f,'invoices').length,1);
});
