import { all, one, query, json, fail, multiline, keys, recordId, role, viewer, audit } from './erp-utils.mjs';
import { sha256 } from './auth.mjs';

/** The stock side of a reversal: a reversing ledger entry and its negative delta. Receipt reversal and QC undo both use it. */
export function reversalQueries(db, member, { id, lotId, movementId, grams, cartons, cones, reason, digest }, now) {
 return [query(db,"INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at) VALUES(?,?,?,'reverse','raw',NULL,?,?,?,?,?,?,?,?,?)",id,member.workspace_id,lotId,grams,cartons,cones,reason,member.user_id,member.name,movementId,digest,now),
  query(db,"INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,'raw',?,?,?)",crypto.randomUUID(),id,lotId,-grams,-cartons,-cones)];
}

export async function receiving(request,env,member,path,data) {
 const db=env.DB,w=member.workspace_id,now=Date.now();
 if(!member.admin&&!member.permissions.some(p=>['receive','procure'].includes(p)))fail(403,'Your account cannot view incoming purchase orders.');
 if(path==='/api/erp/inbound'&&!data) {
  viewer(member,'purchase_manager','supervisor');
  const orders=await all(db,'SELECT p.*,s.name AS supplier_name,a.arrived_milli FROM supplier_purchase_orders p JOIN suppliers s ON s.id=p.supplier_id JOIN po_arrived a ON a.order_id=p.id WHERE p.workspace_id=? ORDER BY p.created_at DESC LIMIT 100',w);
  const receipts=await all(db,'SELECT g.*,l.batch,r.id AS reversal_id FROM goods_receipts g JOIN lots l ON l.id=g.lot_id LEFT JOIN receipt_reversals r ON r.receipt_id=g.id WHERE g.workspace_id=? ORDER BY g.created_at DESC LIMIT 500',w);
  const products=await all(db,'SELECT id,sku,name FROM products WHERE workspace_id=? ORDER BY name',w);
  const shipments=await all(db,'SELECT id,purchase_order_id,bill_of_lading FROM shipments WHERE workspace_id=? ORDER BY created_at DESC LIMIT 500',w);
  return json({orders:orders.map(p=>{const t=JSON.parse(p.terms_snapshot);return {id:p.id,reference:p.reference,status:p.status,supplier_name:p.supplier_name,title:t.title,specifications:t.specifications,quantity_milli:p.quantity_milli,arrived_milli:p.arrived_milli,unit:t.unit};}),receipts,products,shipments});
 }
 if(path==='/api/erp/receipts'&&data){role(member,data,'purchase_manager','supervisor','admin');fail(410,'Goods receipts are now registered as QC lots. Use Register arrival (POST /api/erp/qc/lots).');}
 if(path==='/api/erp/receipts/reverse'&&data) {
  const intervention=role(member,data,'supervisor');keys(data,['id','receiptId','reason','interventionReason']);const id=recordId(data.id),reason=multiline(data.reason,'Reversal reason',5,1000);
  const receipt=await one(db,'SELECT g.*,m.cartons,m.cones FROM goods_receipts g JOIN movements m ON m.id=g.movement_id WHERE g.id=? AND g.workspace_id=?',recordId(data.receiptId),w);
  if(!receipt)fail(404,'Receipt not found.');
  const previous=await one(db,'SELECT * FROM receipt_reversals WHERE receipt_id=?',receipt.id);
  if(previous){if(previous.id!==id||previous.reason!==reason)fail(409,'This receipt was already reversed.');return json({reversed:true});}
  const digest=await sha256(JSON.stringify({receipt:receipt.id,reason}));
  try {await db.batch([
   ...reversalQueries(db,member,{id,lotId:receipt.lot_id,movementId:receipt.movement_id,grams:receipt.grams,cartons:receipt.cartons,cones:receipt.cones,reason,digest},now),
   query(db,'INSERT INTO receipt_reversals(id,receipt_id,movement_id,reason,actor_id,created_at) VALUES(?,?,?,?,?,?)',id,receipt.id,id,reason,member.user_id,now),
   query(db,"UPDATE supplier_purchase_orders SET status=CASE WHEN EXISTS(SELECT 1 FROM shipments WHERE purchase_order_id=supplier_purchase_orders.id) OR EXISTS(SELECT 1 FROM procurement_shipments WHERE purchase_order_id=supplier_purchase_orders.id) THEN 'dispatched' ELSE 'accepted' END WHERE id=? AND (SELECT arrived_milli FROM po_arrived WHERE order_id=supplier_purchase_orders.id)<quantity_milli",receipt.purchase_order_id),
   audit(db,member,'receipt.reversed',receipt.id,{reason},'staff',{intervention})]);}
  catch {fail(409,'This receipt was already reversed or its stock has been used. No reversal was saved.');}
  return json({reversed:true});
 }
 fail(404,'Receipt route not found.');
}
