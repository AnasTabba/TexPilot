import { all, one, query, json, fail, text, multiline, keys, integer, recordId, allow, audit } from './erp-utils.mjs';
import { sha256 } from './auth.mjs';

export async function receiving(request,env,member,path,data) {
 const db=env.DB,w=member.workspace_id,now=Date.now();
 if(!member.admin&&!member.permissions.some(p=>['receive','procure'].includes(p)))fail(403,'Your account cannot view incoming purchase orders.');
 if(path==='/api/erp/inbound'&&!data) {
  const orders=await all(db,'SELECT p.*,s.name AS supplier_name FROM supplier_purchase_orders p JOIN suppliers s ON s.id=p.supplier_id WHERE p.workspace_id=? ORDER BY p.created_at DESC LIMIT 100',w);
  const receipts=await all(db,'SELECT g.*,l.batch,r.id AS reversal_id FROM goods_receipts g JOIN lots l ON l.id=g.lot_id LEFT JOIN receipt_reversals r ON r.receipt_id=g.id WHERE g.workspace_id=? ORDER BY g.created_at DESC LIMIT 500',w);
  const products=await all(db,'SELECT id,sku,name FROM products WHERE workspace_id=? ORDER BY name',w);
  return json({orders:orders.map(p=>{const t=JSON.parse(p.terms_snapshot);return {id:p.id,reference:p.reference,status:p.status,supplier_name:p.supplier_name,title:t.title,specifications:t.specifications,quantity_milli:t.quantity_milli,unit:t.unit};}),receipts,products});
 }
 if(path==='/api/erp/receipts'&&data) {
  allow(member,'receive');keys(data,['id','orderId','productId','batch','quantityMilli','cartons','cones','supplierLot']);
  const id=recordId(data.id),orderId=recordId(data.orderId),productId=recordId(data.productId),batch=text(data.batch,'Internal batch',1,100),quantity=integer(data.quantityMilli,'Received quantity'),cartons=integer(data.cartons??0,'Cartons',0),cones=integer(data.cones??0,'Cones',0),supplierLot=text(data.supplierLot??'','Supplier lot',0,100);
  const digest=await sha256(JSON.stringify({orderId,productId,batch,quantity,cartons,cones,supplierLot}));
  const previous=await one(db,'SELECT * FROM goods_receipts WHERE id=?',id);
  if(previous){if(previous.workspace_id!==w||previous.request_hash!==digest)fail(409,'Receipt ID was used for other values.');return json({receipt:previous});}
  const order=await one(db,'SELECT p.*,s.name AS supplier_name FROM supplier_purchase_orders p JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=? AND p.workspace_id=?',orderId,w);
  if(!order)fail(404,'Purchase order not found.');
  if(!await one(db,'SELECT id FROM products WHERE id=? AND workspace_id=?',productId,w))fail(404,'Material not found.');
  const terms=JSON.parse(order.terms_snapshot),grams=quantity*(terms.unit==='tonne'?1000:1);
  const note=`Receipt ${order.reference}${supplierLot?' · Supplier lot '+supplierLot:''}`;
  const movementHash=await sha256(JSON.stringify({receipt:id,grams,cartons,cones}));
  try {await db.batch([
   query(db,"INSERT INTO lots(id,workspace_id,product_id,batch,supplier,quality,created_at) VALUES(?,?,?,?,?,'uninspected',?)",id,w,productId,batch,order.supplier_name,now),
   query(db,"INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at) VALUES(?,?,?,'receive',NULL,'raw',?,?,?,?,?,?,NULL,?,?)",id,w,id,grams,cartons,cones,note,member.user_id,member.name,movementHash,now),
   query(db,'INSERT INTO goods_receipts(id,workspace_id,purchase_order_id,product_id,lot_id,movement_id,quantity_milli,grams,supplier_lot,request_hash,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,w,orderId,productId,id,id,quantity,grams,supplierLot,digest,member.user_id,now),
   query(db,"INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,'raw',?,?,?)",crypto.randomUUID(),id,id,grams,cartons,cones),
   query(db,"UPDATE supplier_purchase_orders SET status='received' WHERE id=? AND (SELECT COALESCE(SUM(g.quantity_milli),0) FROM goods_receipts g WHERE g.purchase_order_id=? AND NOT EXISTS(SELECT 1 FROM receipt_reversals r WHERE r.receipt_id=g.id))=?",orderId,orderId,terms.quantity_milli),
   audit(db,member,'receipt.created',id,{order:orderId,grams,quantity,unit:terms.unit})]);}
  catch {const raced=await one(db,'SELECT * FROM goods_receipts WHERE id=? AND workspace_id=?',id,w);if(raced?.request_hash===digest)return json({receipt:raced});fail(409,'Receipt exceeds the order quantity, its batch number is already used, or the order changed. Reload and check the values.');}
  return json({receipt:await one(db,'SELECT * FROM goods_receipts WHERE id=?',id)},201);
 }
 if(path==='/api/erp/receipts/reverse'&&data) {
  allow(member,'reverse');keys(data,['id','receiptId','reason']);const id=recordId(data.id),reason=multiline(data.reason,'Reversal reason',5,1000);
  const receipt=await one(db,'SELECT g.*,m.cartons,m.cones FROM goods_receipts g JOIN movements m ON m.id=g.movement_id WHERE g.id=? AND g.workspace_id=?',recordId(data.receiptId),w);
  if(!receipt)fail(404,'Receipt not found.');
  const previous=await one(db,'SELECT * FROM receipt_reversals WHERE receipt_id=?',receipt.id);
  if(previous){if(previous.id!==id||previous.reason!==reason)fail(409,'This receipt was already reversed.');return json({reversed:true});}
  const digest=await sha256(JSON.stringify({receipt:receipt.id,reason}));
  try {await db.batch([
   query(db,"INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at) VALUES(?,?,?,'reverse','raw',NULL,?,?,?,?,?,?,?,?,?)",id,w,receipt.lot_id,receipt.grams,receipt.cartons,receipt.cones,reason,member.user_id,member.name,receipt.movement_id,digest,now),
   query(db,'INSERT INTO receipt_reversals(id,receipt_id,movement_id,reason,actor_id,created_at) VALUES(?,?,?,?,?,?)',id,receipt.id,id,reason,member.user_id,now),
   query(db,"INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,'raw',?,?,?)",crypto.randomUUID(),id,receipt.lot_id,-receipt.grams,-receipt.cartons,-receipt.cones),
   query(db,"UPDATE supplier_purchase_orders SET status=CASE WHEN EXISTS(SELECT 1 FROM procurement_shipments WHERE purchase_order_id=supplier_purchase_orders.id) THEN 'dispatched' ELSE 'accepted' END WHERE id=?",receipt.purchase_order_id),
   audit(db,member,'receipt.reversed',receipt.id,{reason})]);}
  catch {fail(409,'This receipt was already reversed or its stock has been used. No reversal was saved.');}
  return json({reversed:true});
 }
 fail(404,'Receipt route not found.');
}
