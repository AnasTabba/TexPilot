/** A receipt acknowledges an existing dispatch. It never changes stock or the issued invoice's agreed terms. */
import { one, query, audit, fail } from './erp-utils.mjs';
import { notifyRole } from './notify.mjs';

export async function confirmDelivery(db, member, { id, salesDispatchId, deliveryDate, note, actorType = 'staff', buyerId = null, intervention = null, now = Date.now() }) {
 const shipment = await one(db, `SELECT s.*,o.buyer_id,o.reference AS order_reference,d.id AS dispatch_record_id,d.status AS delivery_status
   FROM sales_dispatches s JOIN sales_orders o ON o.id=s.sales_order_id
   LEFT JOIN dispatches d ON d.sales_dispatch_id=s.id AND d.workspace_id=s.workspace_id
   WHERE s.id=? AND s.workspace_id=?${buyerId ? ' AND o.buyer_id=?' : ''}`, salesDispatchId, member.workspace_id, ...(buyerId ? [buyerId] : []));
 if (!shipment) fail(404,'This delivery was not found.');
 const prior = await one(db,'SELECT * FROM sales_deliveries WHERE id=?',id);
 if (prior) {
  if (prior.workspace_id!==member.workspace_id || prior.dispatch_id!==salesDispatchId || prior.delivery_date!==deliveryDate || prior.evidence_note!==note || prior.confirmed_by!==member.user_id) fail(409,'This confirmation ID was used for different delivery details.');
  return {delivery:prior,already:true};
 }
 const existing = await one(db,'SELECT * FROM sales_deliveries WHERE dispatch_id=? AND workspace_id=?',salesDispatchId,member.workspace_id);
 if (existing) return {delivery:existing,already:true};
 if (await one(db,'SELECT 1 FROM movements WHERE reverses=?',shipment.movement_id)) fail(409,'This dispatch was reversed and cannot be received.');
 if (shipment.dispatch_record_id && !['dispatched','delivered'].includes(shipment.delivery_status)) fail(409,'Only a dispatched delivery can be confirmed.');
 if (deliveryDate<shipment.dispatched_at || deliveryDate>now) fail(422,'The receipt time must be between dispatch and now.');
 try {
  await db.batch([
   // Recheck the current dispatch inside the write transaction, including concurrent undo.
   query(db,`INSERT INTO sales_deliveries(id) SELECT 'invalid' WHERE EXISTS(SELECT 1 FROM movements WHERE reverses=?)
    OR EXISTS(SELECT 1 FROM dispatches WHERE id=? AND (sales_dispatch_id IS NOT ? OR status NOT IN ('dispatched','delivered')))`,shipment.movement_id,shipment.dispatch_record_id,salesDispatchId),
   query(db,'INSERT INTO sales_deliveries(id,workspace_id,dispatch_id,delivery_date,evidence_note,confirmed_by,created_at) VALUES(?,?,?,?,?,?,?)',id,member.workspace_id,salesDispatchId,deliveryDate,note,member.user_id,now),
   ...(shipment.dispatch_record_id && shipment.delivery_status==='dispatched' ? [query(db,"UPDATE dispatches SET status='delivered',delivery_proof=?,delivered_at=?,updated_at=? WHERE id=? AND workspace_id=? AND status='dispatched'",note,deliveryDate,now,shipment.dispatch_record_id,member.workspace_id)] : []),
   audit(db,member,'dispatch.delivered',shipment.dispatch_record_id ?? salesDispatchId,{salesDispatchId,deliveryId:id,deliveryDate,confirmedBy:actorType},actorType,{objectType:'dispatch',intervention}),
   notifyRole(db,member.workspace_id,'sales_manager','dispatch.delivered','dispatch',shipment.dispatch_record_id ?? salesDispatchId,shipment.order_reference),
  ]);
 } catch {
  const duplicate = await one(db,'SELECT * FROM sales_deliveries WHERE dispatch_id=? AND workspace_id=?',salesDispatchId,member.workspace_id);
  if (duplicate) return {delivery:duplicate,already:true};
  fail(409,'The dispatch changed while confirming delivery. Refresh and try again.');
 }
 return {delivery:await one(db,'SELECT * FROM sales_deliveries WHERE id=?',id),already:false};
}
