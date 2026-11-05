/** Buyer ratings for sales staff: payment, communication and reliability, append-only.
 * Exported as `buyerRatingsApi(request,env,member,path,data)` for `/api/erp/buyer-ratings*`. */
import { all, one, query, json, fail, multiline, keys, integer, recordId, audit, role, viewer } from './erp-utils.mjs';

const round1 = value => Math.round(value * 10) / 10;
// Voided ratings (typos) are kept as history but leave every average.
const AGGREGATE = 'SELECT buyer_id,COUNT(*) AS count,AVG(payment) AS payment,AVG(communication) AS communication,AVG(reliability) AS reliability FROM buyer_ratings WHERE workspace_id=? AND NOT EXISTS(SELECT 1 FROM buyer_rating_voids v WHERE v.rating_id=buyer_ratings.id)';
// Every rating carries all three criteria, so the overall score is the mean of the three criterion means.
const summaryOf = r => ({ payment: round1(r.payment), communication: round1(r.communication), reliability: round1(r.reliability),
  overall: round1((r.payment + r.communication + r.reliability) / 3), count: r.count });
const CRITERIA = ['payment', 'communication', 'reliability'];

export async function buyerRatingsApi(request, env, member, path, data) {
  const db = env.DB; const w = member.workspace_id;
  if (!db) fail(503, 'The shared database is not connected.');

  if (!data) {
    viewer(member, 'sales_manager');
    if (path === '/api/erp/buyer-ratings/summary') {
      const rows = await all(db, `${AGGREGATE} GROUP BY buyer_id`, w);
      return json({ summaries: Object.fromEntries(rows.map(r => [r.buyer_id, summaryOf(r)])) });
    }
    if (path === '/api/erp/buyer-ratings') {
      const buyerId = recordId(new URL(request.url).searchParams.get('buyerId'));
      if (!await one(db, 'SELECT id FROM buyers WHERE id=? AND workspace_id=?', buyerId, w)) fail(404, 'Buyer not found.');
      const [aggregate] = await all(db, `${AGGREGATE} AND buyer_id=? GROUP BY buyer_id`, w, buyerId);
      const ratings = await all(db, 'SELECT r.id,r.payment,r.communication,r.reliability,r.feedback,r.created_by,u.name AS created_by_name,r.created_at,v.reason AS void_reason,v.created_at AS voided_at FROM buyer_ratings r LEFT JOIN users u ON u.id=r.created_by LEFT JOIN buyer_rating_voids v ON v.rating_id=r.id WHERE r.workspace_id=? AND r.buyer_id=? ORDER BY r.created_at DESC,r.id', w, buyerId);
      return json({ summary: aggregate ? summaryOf(aggregate) : null, ratings });
    }
    fail(404, 'Buyer rating route not found.');
  }

  // A typo in a rating is voided, not edited. Only the sales manager who rated, or an admin, can void it.
  if (path === '/api/erp/buyer-ratings/void') {
    const intervention = role(member, data, 'sales_manager');
    keys(data, ['id', 'ratingId', 'reason', 'interventionReason']);
    const id = recordId(data.id), ratingId = recordId(data.ratingId), why = multiline(data.reason, 'Reason', 3, 500);
    const rating = await one(db, 'SELECT * FROM buyer_ratings WHERE id=? AND workspace_id=?', ratingId, w);
    if (!rating) fail(404, 'Rating not found.');
    const previous = await one(db, 'SELECT * FROM buyer_rating_voids WHERE id=? OR rating_id=?', id, ratingId);
    if (previous) {
      if (previous.id === id && previous.rating_id === ratingId && previous.reason === why) return json({ void: previous });
      fail(409, previous.rating_id === ratingId ? 'This rating was already voided.' : 'This request ID was used for a different void.');
    }
    if (member.role !== 'admin' && rating.created_by !== member.user_id) fail(403, 'Only the sales manager who rated this buyer, or an admin, can void this rating.');
    const now = Date.now();
    try {
      await db.batch([query(db, 'INSERT INTO buyer_rating_voids(id,workspace_id,rating_id,reason,created_by,created_at) VALUES(?,?,?,?,?,?)', id, w, ratingId, why, member.user_id, now),
        audit(db, member, 'buyer.rating_voided', rating.buyer_id, { rating: ratingId, reason: why }, 'staff', { objectType: 'buyer_rating', reason: why, intervention })]);
    } catch {
      const raced = await one(db, 'SELECT * FROM buyer_rating_voids WHERE id=?', id);
      if (raced) return json({ void: raced });
      fail(409, 'This rating was already voided.');
    }
    return json({ void: await one(db, 'SELECT * FROM buyer_rating_voids WHERE id=?', id) }, 201);
  }
  if (path !== '/api/erp/buyer-ratings') fail(404, 'Buyer rating route not found.');
  const intervention = role(member, data, 'sales_manager');
  keys(data, ['id', 'buyerId', 'payment', 'communication', 'reliability', 'feedback', 'interventionReason']);
  const id = recordId(data.id), buyerId = recordId(data.buyerId);
  const scores = Object.fromEntries(CRITERIA.map(k => [k, integer(data[k], `${k[0].toUpperCase()}${k.slice(1)} rating`, 1, 5)]));
  const feedback = data.feedback === undefined ? '' : multiline(data.feedback, 'Feedback', 0, 1000);
  const buyer = await one(db, 'SELECT id,status FROM buyers WHERE id=? AND workspace_id=?', buyerId, w);
  if (!buyer) fail(404, 'Buyer not found.');
  if (buyer.status !== 'active') fail(409, 'Only an active buyer can be rated.');
  const saved = { id, buyerId, ...scores, feedback };
  const previous = await one(db, 'SELECT * FROM buyer_ratings WHERE id=?', id);
  if (previous) {
    if (previous.workspace_id !== w || previous.buyer_id !== buyerId || CRITERIA.some(k => previous[k] !== scores[k]) || previous.feedback !== feedback) fail(409, 'This record ID was already used for a different rating.');
    return json(saved);
  }
  const now = Date.now();
  await db.batch([query(db, 'INSERT INTO buyer_ratings(id,workspace_id,buyer_id,payment,communication,reliability,feedback,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)', id, w, buyerId, scores.payment, scores.communication, scores.reliability, feedback, member.user_id, now),
    audit(db, member, 'buyer.rated', buyerId, { ...scores, feedback }, 'staff', { intervention })]);
  return json(saved, 201);
}
