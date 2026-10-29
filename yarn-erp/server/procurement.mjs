import { all, one, query, json, fail, text, multiline, keys, integer, date, email, phone, website, recordId, allow, reason as decisionReason, role, audit } from './erp-utils.mjs';
import { sha256 } from './auth.mjs';

export const categories = db => all(db, 'SELECT * FROM supplier_categories ORDER BY sort_order');
export async function categoryIds(db, value) {
  if (!Array.isArray(value) || !value.length || value.length > 6 || value.some(v => typeof v !== 'string')) fail(422, 'Choose at least one yarn category.');
  const ids = [...new Set(value)]; const valid = await categories(db);
  if (ids.some(id => !valid.some(c => c.id === id))) fail(422, 'Choose valid yarn categories.');
  return ids;
}
export const categoryQueries = (db, supplierId, ids) => [query(db, 'DELETE FROM supplier_category_links WHERE supplier_id=?', supplierId),
  ...ids.map(id => query(db, 'INSERT INTO supplier_category_links(supplier_id,category_id) VALUES(?,?)', supplierId, id))];
export async function supplierView(db, value) {
  if (!value) return null;
  return { ...value, categories: (await all(db, 'SELECT category_id FROM supplier_category_links WHERE supplier_id=? ORDER BY category_id', value.id)).map(c => c.category_id) };
}
const supplierFields = 'id,workspace_id,name,contact_name,email,phone,city,website,source_url,source_checked_at,status,version,created_at,updated_at';
export async function suppliers(db, workspaceId) {
  return Promise.all((await all(db, `SELECT ${supplierFields} FROM suppliers WHERE workspace_id=? AND status!='archived' ORDER BY name COLLATE NOCASE LIMIT 500`, workspaceId)).map(s => supplierView(db, s)));
}
export function supplierData(data) {
  return { name: text(data.name, 'Company', 2, 120), contact: text(data.contactName, 'Contact name', 2, 80),
    email: email(data.email), phone: phone(data.phone), city: text(data.city ?? '', 'City', 0, 100), website: website(data.website), source: website(data.sourceUrl) };
}
const reference = prefix => `${prefix}-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
export async function staffProcurement(request, env, member, path, data) {
  const db = env.DB; const w = member.workspace_id; const now = Date.now();
  if (path === '/api/erp/categories') return json({ categories: await categories(db) });
  if (path.startsWith('/api/erp/suppliers')) {
    allow(member, 'suppliers');
    if (path === '/api/erp/suppliers' && !data) return json({ suppliers: await suppliers(db, w) });
    if (path === '/api/erp/suppliers' && data) {
      keys(data, ['id','name','contactName','email','phone','city','website','sourceUrl','categories']);
      const id = recordId(data.id); const s = supplierData(data); const ids = await categoryIds(db, data.categories);
      const digest = await sha256(JSON.stringify({ ...s, categories: [...ids].sort() }));
      const previous = await one(db, 'SELECT * FROM suppliers WHERE id=?', id);
      if (previous) {
        if (previous.workspace_id !== w) fail(409, 'This record ID is already in use.');
        if(previous.request_hash!==digest) fail(409,'This record ID was already used for different contact details.');
        return json({ supplier: await supplierView(db, await one(db,`SELECT ${supplierFields} FROM suppliers WHERE id=?`,id)) });
      }
      await db.batch([query(db, 'INSERT INTO suppliers(id,workspace_id,name,contact_name,email,phone,city,website,source_url,source_checked_at,status,request_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id,w,s.name,s.contact,s.email,s.phone,s.city,s.website,s.source,s.source ? now : null,'directory',digest,now,now),
        ...categoryQueries(db,id,ids), audit(db,member,'supplier.created',id,{name:s.name,categories:ids})]);
      return json({ supplier: await supplierView(db, await one(db, `SELECT ${supplierFields} FROM suppliers WHERE id=?`, id)) }, 201);
    }
    if (path === '/api/erp/suppliers/review' && data) {
      role(member, data, 'admin');
      keys(data, ['id','status','reason','categories','version','interventionReason']);
      const s = await one(db, 'SELECT * FROM suppliers WHERE id=? AND workspace_id=?', recordId(data.id), w);
      if (!s) fail(404, 'Supplier not found.');
      if (!['approved','rejected','suspended'].includes(data.status)) fail(422, 'Choose approved, rejected or suspended.');
      if (!['pending','approved','rejected','suspended'].includes(s.status)) fail(409, 'This directory contact has no supplier registration to review.');
      const reason = decisionReason(data.reason, 'Review reason'); const version = integer(data.version, 'Version');
      const ids = await categoryIds(db, data.categories ?? (await supplierView(db,s)).categories);
      if(s.version!==version) fail(409,'Supplier changed. Reload before reviewing.');
      try { await db.batch([query(db, 'UPDATE suppliers SET status=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=?', data.status,now,s.id,w,version),
        query(db,'INSERT INTO supplier_registration_reviews(id,supplier_id,version,status,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),s.id,version+1,data.status,reason,member.user_id,now),
        ...categoryQueries(db,s.id,ids), query(db, 'DELETE FROM supplier_sessions WHERE user_id IN (SELECT id FROM supplier_users WHERE supplier_id=?)', s.id),
        audit(db,member,`supplier.${data.status}`,s.id,{reason,categories:ids,previousStatus:s.status},'staff',{reason,before:{status:s.status},after:{status:data.status}})]); }
      catch { fail(409,'Supplier changed. Reload before reviewing.'); }
      return json({ saved: true });
    }
    fail(404, 'Supplier route not found.');
  }
  allow(member, 'procure');
  if (path === '/api/erp/procurement' && !data) {
    const rfqs = await all(db, `SELECT r.*,(SELECT COUNT(*) FROM rfq_recipients WHERE rfq_id=r.id) AS recipient_count,(SELECT COUNT(*) FROM supplier_bids WHERE rfq_id=r.id) AS bid_count FROM procurement_rfqs r WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100`,w);
    const bids = await all(db, 'SELECT b.*,s.name AS supplier_name FROM supplier_bids b JOIN suppliers s ON s.id=b.supplier_id JOIN procurement_rfqs r ON r.id=b.rfq_id WHERE r.workspace_id=? ORDER BY b.updated_at DESC LIMIT 500',w);
    const orders = await all(db, 'SELECT p.*,s.name AS supplier_name FROM supplier_purchase_orders p JOIN suppliers s ON s.id=p.supplier_id WHERE p.workspace_id=? ORDER BY p.created_at DESC LIMIT 100',w);
    const shipments = await all(db, 'SELECT * FROM procurement_shipments WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100',w);
    return json({ rfqs,bids,orders:orders.map(o=>({...o,terms:JSON.parse(o.terms_snapshot)})),shipments,tracking:{configured:false,provider:'DataLoopLabs',reason:'Tracking API contract and credit policy must be configured before a paid lookup.'} });
  }
  if (path === '/api/erp/rfqs' && data) {
    keys(data,['id','title','categoryId','specifications','quantityMilli','unit','deliveryLocation','deadlineAt','requestedDeliveryAt']);
    const id = recordId(data.id); const c = (await categoryIds(db,[data.categoryId]))[0];
    const existing = await one(db,'SELECT * FROM procurement_rfqs WHERE id=?',id);
    const normalized = {title:text(data.title,'RFQ title',3,120),category:c,specifications:multiline(data.specifications,'Specifications',5,4000),quantity:integer(data.quantityMilli,'Quantity'),unit:data.unit,location:text(data.deliveryLocation,'Delivery location',3,200),deadline:date(data.deadlineAt,'Bid deadline'),delivery:date(data.requestedDeliveryAt,'Requested delivery')};
    if (!['kg','tonne'].includes(normalized.unit)) fail(422,'Choose kg or tonne.');
    if (normalized.delivery < normalized.deadline) fail(422,'Delivery must be after the bid deadline.');
    const digest=await sha256(JSON.stringify(normalized));
    if (existing) { if (existing.workspace_id!==w||existing.request_hash!==digest) fail(409,'Record ID was used for different RFQ values.'); return json({rfq:existing}); }
    date(normalized.deadline,'Bid deadline',true);date(normalized.delivery,'Requested delivery',true);
    await db.batch([query(db,'INSERT INTO procurement_rfqs(id,workspace_id,reference,title,category_id,specifications,quantity_milli,unit,delivery_location,deadline_at,requested_delivery_at,status,request_hash,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id,w,reference('RFQ'),normalized.title,c,normalized.specifications,normalized.quantity,normalized.unit,normalized.location,normalized.deadline,normalized.delivery,'draft',digest,member.user_id,now),audit(db,member,'rfq.created',id,normalized)]);
    return json({rfq:await one(db,'SELECT * FROM procurement_rfqs WHERE id=?',id)},201);
  }
  if (path === '/api/erp/rfqs/publish' && data) {
    keys(data,['id']); const r = await one(db,'SELECT * FROM procurement_rfqs WHERE id=? AND workspace_id=?',recordId(data.id),w);
    if (!r) fail(404,'RFQ not found.');
    if (r.status==='open') return json({published:true,recipients:(await one(db,'SELECT COUNT(*) AS n FROM rfq_recipients WHERE rfq_id=?',r.id)).n});
    if (r.status!=='draft'||r.deadline_at<=now) fail(409,'Only a draft with a future deadline can be published.');
    const eligible = await all(db, "SELECT s.* FROM suppliers s JOIN supplier_category_links c ON c.supplier_id=s.id WHERE s.workspace_id=? AND s.status='approved' AND c.category_id=? AND EXISTS (SELECT 1 FROM supplier_users u WHERE u.supplier_id=s.id)",w,r.category_id);
    if (!eligible.length) fail(409,'No approved registered suppliers match this category. Add and approve suppliers first.');
    await db.batch([...eligible.map(s=>query(db, "INSERT OR IGNORE INTO rfq_recipients(rfq_id,supplier_id,supplier_snapshot,delivered_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM procurement_rfqs WHERE id=? AND status='draft') AND EXISTS(SELECT 1 FROM suppliers WHERE id=? AND status='approved')",r.id,s.id,JSON.stringify({name:s.name,email:s.email,phone:s.phone}),now,r.id,s.id)),
      query(db,"UPDATE procurement_rfqs SET status='open',published_at=? WHERE id=? AND status='draft' AND EXISTS(SELECT 1 FROM rfq_recipients WHERE rfq_id=?)",now,r.id,r.id),audit(db,member,'rfq.publish_requested',r.id,{channel:'supplier_portal',recipients:eligible.map(s=>s.id)})]);
    if((await one(db,'SELECT status FROM procurement_rfqs WHERE id=?',r.id)).status!=='open')fail(409,'No eligible supplier remained when publishing. Reload and review supplier access.');
    return json({published:true,recipients:(await one(db,'SELECT COUNT(*) AS n FROM rfq_recipients WHERE rfq_id=?',r.id)).n});
  }
  if (path === '/api/erp/bids/reject' && data) {
    keys(data,['id','version','reason','interventionReason']);
    const b = await one(db,'SELECT b.* FROM supplier_bids b JOIN procurement_rfqs r ON r.id=b.rfq_id WHERE b.id=? AND r.workspace_id=?',recordId(data.id),w);
    if(!b) fail(404,'Bid not found.');
    const reason=decisionReason(data.reason,'Rejection reason');
    if(b.status==='rejected') fail(409,'This bid was already rejected.');
    const result=await db.batch([query(db,"UPDATE supplier_bids SET status='rejected',rejection_reason=?,updated_at=? WHERE id=? AND version=? AND status='submitted' AND EXISTS(SELECT 1 FROM procurement_rfqs WHERE id=supplier_bids.rfq_id AND status='open')",reason,now,b.id,integer(data.version,'Version')),
      query(db,"INSERT INTO erp_audit_events(id,workspace_id,actor_id,actor_type,action,record_id,detail_json,created_at,actor_role,object_type,reason,intervention_reason,created_by,status,updated_at) SELECT ?,?,?,'staff','bid.rejected',?,?,?,?, 'bid',?,NULL,?,'recorded',? WHERE changes()>0 AND EXISTS(SELECT 1 FROM supplier_bids WHERE id=? AND status='rejected' AND rejection_reason=? AND updated_at=?)",crypto.randomUUID(),w,member.user_id,b.id,JSON.stringify({reason}),now,member.role ?? 'staff',reason,member.user_id,now,b.id,reason,now)]);
    if(!result[0].meta.changes) fail(409,'The bid or RFQ changed. Reload first.');
    return json({saved:true});
  }
  if (path === '/api/erp/bids/award' && data) {
    keys(data,['id','version']); const bid = await one(db,'SELECT b.*,r.workspace_id,r.reference AS rfq_reference,r.title,r.specifications,r.unit,r.quantity_milli AS required_quantity FROM supplier_bids b JOIN procurement_rfqs r ON r.id=b.rfq_id WHERE b.id=? AND r.workspace_id=?',recordId(data.id),w);
    if(!bid) fail(404,'Bid not found.');
    const previous=await one(db,'SELECT * FROM supplier_purchase_orders WHERE rfq_id=?',bid.rfq_id);
    if(previous) {if(previous.bid_id!==bid.id||JSON.parse(previous.terms_snapshot).accepted_bid_version!==data.version) fail(409,'Another bid or revision has already been accepted.'); return json({order:previous});}
    if(bid.status!=='submitted'||bid.valid_until<=now||bid.version!==data.version||bid.quantity_milli<bid.required_quantity) fail(409,'Use a current, valid bid covering the full requested quantity.');
    const id=crypto.randomUUID(); const terms=JSON.stringify({...bid,quantity_milli:bid.required_quantity,accepted_bid_version:bid.version});
    try {
      await db.batch([query(db,`INSERT INTO supplier_purchase_orders(id,workspace_id,rfq_id,bid_id,supplier_id,reference,terms_snapshot,status,accepted_by,created_at)
        SELECT ?,?,?,?,?,?,?,'accepted',?,? WHERE EXISTS (SELECT 1 FROM supplier_bids b JOIN procurement_rfqs r ON r.id=b.rfq_id JOIN suppliers s ON s.id=b.supplier_id WHERE b.id=? AND b.version=? AND b.status='submitted' AND b.valid_until>? AND r.status='open' AND s.status='approved')`,
        id,w,bid.rfq_id,bid.id,bid.supplier_id,reference('PO'),terms,member.user_id,now,bid.id,data.version,now),
        query(db,"UPDATE procurement_rfqs SET status='awarded' WHERE id=? AND EXISTS(SELECT 1 FROM supplier_purchase_orders WHERE id=?)",bid.rfq_id,id),
        query(db,"INSERT INTO erp_audit_events(id,workspace_id,actor_id,actor_type,action,record_id,detail_json,created_at,actor_role,object_type,reason,intervention_reason,created_by,status,updated_at) SELECT ?,?,?,'staff','bid.awarded',?,?,?,?,'bid',NULL,NULL,?,'recorded',? WHERE EXISTS(SELECT 1 FROM supplier_purchase_orders WHERE id=?)",crypto.randomUUID(),w,member.user_id,bid.id,JSON.stringify({version:bid.version}),now,member.role ?? 'staff',member.user_id,now,id)]);
    } catch {
      const raced=await one(db,'SELECT * FROM supplier_purchase_orders WHERE rfq_id=?',bid.rfq_id);
      if(raced?.bid_id===bid.id) return json({order:raced});
      fail(409,'Another award won. Reload the RFQ.');
    }
    const order=await one(db,'SELECT * FROM supplier_purchase_orders WHERE id=?',id);
    if(!order) fail(409,'The bid or supplier status changed. Reload before accepting.');
    return json({order},201);
  }
  fail(404,'Procurement route not found.');
}

export async function supplierOperations(request, env, user, path, data) {
  const db=env.DB; const sid=user.supplier_id; const now=Date.now();
  if (user.status!=='approved') fail(403,'An admin must approve your supplier account before you can use RFQs or orders.');
  if(path==='/api/portal/workspace'&&!data) {
    const rfqs=await all(db, "SELECT r.* FROM procurement_rfqs r JOIN rfq_recipients x ON x.rfq_id=r.id WHERE x.supplier_id=? ORDER BY r.created_at DESC LIMIT 100",sid);
    const bids=await all(db,'SELECT * FROM supplier_bids WHERE supplier_id=? ORDER BY updated_at DESC LIMIT 100',sid);
    const orders=await all(db,'SELECT * FROM supplier_purchase_orders WHERE supplier_id=? ORDER BY created_at DESC LIMIT 100',sid);
    const shipments=await all(db,'SELECT * FROM procurement_shipments WHERE supplier_id=? ORDER BY created_at DESC LIMIT 100',sid);
    return json({rfqs,bids,orders:orders.map(o=>({...o,terms:JSON.parse(o.terms_snapshot)})),shipments});
  }
  if(path==='/api/portal/bids'&&data) {
    keys(data,['id','rfqId','version','quantityMilli','priceMinor','currency','paymentTerms','deliveryAt','validUntil','note']);
    const r=await one(db,"SELECT r.* FROM procurement_rfqs r JOIN rfq_recipients x ON x.rfq_id=r.id WHERE r.id=? AND x.supplier_id=? AND r.workspace_id=?",recordId(data.rfqId),sid,user.workspace_id);
    if(!r) fail(404,'RFQ not found.');
    if(r.status!=='open'||r.deadline_at<=now) fail(409,'This RFQ is no longer open for bids.');
    const id=recordId(data.id); const previous=await one(db,'SELECT * FROM supplier_bids WHERE rfq_id=? AND supplier_id=?',r.id,sid);
    const quantity=integer(data.quantityMilli,'Offered quantity'); const price=integer(data.priceMinor,'Rate');
    if(quantity<r.quantity_milli) fail(422,'Offer the full requested quantity; partial awards are not supported yet.');
    if(!['PKR','USD','EUR','GBP'].includes(data.currency)) fail(422,'Choose a supported currency.');
    const version=integer(data.version,'Version',0); if(previous&&previous.id!==id) fail(409,'A bid already exists. Reload it before editing.');
    if(previous?.status==='rejected') fail(409,'This bid was rejected. Contact the purchase manager.');
    const payment=multiline(data.paymentTerms,'Payment terms',3,1000), delivery=date(data.deliveryAt,'Delivery date'), valid=date(data.validUntil,'Valid until'), note=multiline(data.note??'','Note',0,2000);
    const snapshot=JSON.stringify({quantity_milli:quantity,price_minor:price,currency:data.currency,payment_terms:payment,delivery_at:delivery,valid_until:valid,note});
    if(previous?.version===version+1) {
      const saved=await one(db,'SELECT snapshot FROM supplier_bid_history WHERE bid_id=? AND version=?',id,previous.version);
      if(saved?.snapshot===snapshot) return json({bid:previous});
    }
    if((previous?.version??0)!==version) fail(409,'This bid changed. Reload before editing.');
    date(delivery,'Delivery date',true);date(valid,'Valid until',true);
    const write=previous ? query(db,'UPDATE supplier_bids SET quantity_milli=?,price_minor=?,currency=?,payment_terms=?,delivery_at=?,valid_until=?,note=?,version=version+1,updated_at=? WHERE id=? AND version=?',quantity,price,data.currency,payment,delivery,valid,note,now,id,version)
      : query(db,"INSERT INTO supplier_bids(id,rfq_id,supplier_id,quantity_milli,price_minor,currency,payment_terms,delivery_at,valid_until,note,version,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,'submitted',?,?)",id,r.id,sid,quantity,price,data.currency,payment,delivery,valid,note,now,now);
    try {await db.batch([write,query(db,'INSERT INTO supplier_bid_history(id,bid_id,version,snapshot,actor_id,created_at) VALUES(?,?,?,?,?,?)',crypto.randomUUID(),id,version+1,snapshot,user.user_id,now),audit(db,user,'bid.submitted',id,{version:version+1},'supplier')]);}
    catch {fail(409,'The RFQ or bid changed. Reload and retry.');}
    return json({bid:await one(db,'SELECT * FROM supplier_bids WHERE id=? AND supplier_id=?',id,sid)},previous?200:201);
  }
  if(path==='/api/portal/dispatches'&&data) {
    keys(data,['id','orderId','billOfLading','carrier','containers','quantityMilli','dispatchedAt','note']);
    const order=await one(db,'SELECT * FROM supplier_purchase_orders WHERE id=? AND supplier_id=? AND workspace_id=?',recordId(data.orderId),sid,user.workspace_id);
    if(!order) fail(404,'Purchase order not found.');
    const id=recordId(data.id), bl=text(data.billOfLading,'Bill of lading',3,100), carrier=text(data.carrier,'Carrier',2,100), qty=integer(data.quantityMilli,'Dispatched quantity'), dispatched=date(data.dispatchedAt,'Dispatch date'), note=multiline(data.note??'','Note',0,2000);
    if(dispatched>now+60000) fail(422,'Dispatch date cannot be in the future.');
    if(!Array.isArray(data.containers)||data.containers.length>100||data.containers.some(c=>typeof c!=='string'||! /^[A-Z]{4}[0-9]{7}$/.test(c))) fail(422,'Use container numbers with four capital letters and seven digits, or leave the list empty.');
    const containers=[...new Set(data.containers)]; const digest=await sha256(JSON.stringify({order:order.id,bl,carrier,qty,dispatched,note,containers}));
    const previous=await one(db,'SELECT * FROM procurement_shipments WHERE id=?',id);
    if(previous) {if(previous.supplier_id!==sid||previous.request_hash!==digest) fail(409,'This request ID was used for different values.');return json({shipment:previous});}
    try {await db.batch([query(db,'INSERT INTO procurement_shipments(id,workspace_id,purchase_order_id,supplier_id,bill_of_lading,carrier,containers_json,quantity_milli,dispatched_at,note,request_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,user.workspace_id,order.id,sid,bl,carrier,JSON.stringify(containers),qty,dispatched,note,digest,now),
      query(db,"UPDATE supplier_purchase_orders SET status='dispatched' WHERE id=?",order.id),audit(db,user,'shipment.dispatched',id,{order:order.id,billOfLading:bl},'supplier')]);}
    catch {fail(409,'This dispatch exceeds the order quantity or the order is no longer dispatchable. Reload first.');}
    return json({shipment:await one(db,'SELECT * FROM procurement_shipments WHERE id=?',id)},201);
  }
  fail(404,'Supplier portal route not found.');
}
