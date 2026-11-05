/** The one builder of a single-stage ledger entry: exactly one movement and its matching delta, in the caller's batch. Callers own authorization, thresholds and disposition. */
import { query, role } from './erp-utils.mjs';

const SIGN = { receive: 1, dispatch: -1, waste: -1 };
const STAGES = ['raw', 'wip', 'finished', 'cops'];
/** The ledger is immutable and balances cannot go negative (database CHECKs), so an oversized withdrawal aborts the whole batch. */
export function movementQueries(db, member, { id = crypto.randomUUID(), lotId, action, stage, deltaGrams, cartons = 0, cones = 0, note = '', sourceId = id }, now) {
  if (!Object.hasOwn(SIGN, action) || !STAGES.includes(stage) || !Number.isSafeInteger(deltaGrams) || deltaGrams === 0 || Math.sign(deltaGrams) !== SIGN[action] || !Number.isSafeInteger(cartons) || !Number.isSafeInteger(cones) || cartons < 0 || cones < 0) throw new Error('movement and delta disagree');
  const grams = Math.abs(deltaGrams);
  return [
    query(db, 'INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)',
      id, member.workspace_id, lotId, action, deltaGrams < 0 ? stage : null, deltaGrams > 0 ? stage : null, grams, cartons, cones, note, member.user_id, member.name ?? member.role, `source:${sourceId}`, now),
    query(db, 'INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?,?,?)', crypto.randomUUID(), id, lotId, stage, deltaGrams, Math.sign(deltaGrams) * cartons, Math.sign(deltaGrams) * cones)];
}

/** A compensating entry: the opposite of `reverses`, with its own movement and one delta per stage. Only reversal routes call it; the original stays untouched. */
export function reversalQueries(db, member, { id = crypto.randomUUID(), lotId, reverses, fromStage = null, toStage = null, grams, cartons = 0, cones = 0, note, deltas, requestHash }, now) {
  return [
    query(db, "INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at) VALUES(?,?,?,'reverse',?,?,?,?,?,?,?,?,?,?,?)",
      id, member.workspace_id, lotId, fromStage, toStage, grams, cartons, cones, note, member.user_id, member.name ?? member.role, reverses, requestHash, now),
    ...deltas.map(d => query(db, 'INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?,?,?)', crypto.randomUUID(), id, lotId, d.stage, d.grams, d.cartons, d.cones)),
  ];
}
/** Reversals belong to the role that made the entry, to anyone holding the reverse permission, and to admin (who must give an intervention reason). */
export function reversalIntervention(member, data, roleName) {
  return member.permissions?.includes('reverse') && !member.admin ? null : role(member, data, roleName);
}
