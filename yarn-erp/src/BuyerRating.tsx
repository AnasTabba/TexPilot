import { useState } from 'react';
import { Star } from 'lucide-react';
import { inventoryRequest as api, type Member } from './inventory-client';
import { AsyncForm, Field } from './forms';
import { InterventionField, useResource } from './PortalCommon';
import { useLanguage } from './i18n';
import { StarMeter } from './Procurement';
import { factoryTime } from './erp-client';
import './erp.css';
import './buyer-rating.css';

export interface BuyerRatingAverages { payment: number; communication: number; reliability: number; overall: number; count: number }
interface BuyerRatingRecord { id: string; payment: number; communication: number; reliability: number; feedback: string; created_by: string; created_by_name: string | null; created_at: number; void_reason: string | null; voided_at: number | null }
interface BuyerRatingDetail { summary: BuyerRatingAverages | null; ratings: BuyerRatingRecord[] }

const CRITERIA = [
 { key: 'payment', en: 'Payment terms followed', ur: 'ادائیگی کی شرائط کی پابندی' },
 { key: 'communication', en: 'Communication', ur: 'بات چیت' },
 { key: 'reliability', en: 'Orders as agreed', ur: 'طے شدہ کے مطابق آرڈر' },
] as const;
type Criterion = typeof CRITERIA[number]['key'];
const useBuyerRatings = (buyerId: string) => useResource<BuyerRatingDetail>(`/buyer-ratings?buyerId=${encodeURIComponent(buyerId)}`);

/** Overall stars and count for one buyer. Renders nothing until the first load finishes. */
export function BuyerRatingSummary({ buyerId }: { buyerId: string }) {
 const { t } = useLanguage(); const { data, error, loading } = useBuyerRatings(buyerId);
 if (loading) return null;
 if (error || !data) return <p className="erp-rating live-muted">{t('Ratings could not load.', 'ریٹنگز لوڈ نہیں ہو سکیں۔')}</p>;
 if (!data.summary) return <p className="erp-rating live-muted">{t('No ratings yet', 'ابھی کوئی ریٹنگ نہیں')}</p>;
 const { overall, count } = data.summary;
 const label = t(`${overall.toFixed(1)} out of 5 from ${count} ratings`, `5 میں سے ${overall.toFixed(1)}، ${count} ریٹنگز`);
 return <p className="erp-rating"><StarMeter value={overall} label={label} /><strong>{overall.toFixed(1)}</strong><span className="live-muted">({count})</span></p>;
}

/** Past ratings for one buyer, newest first, with the rater's name and each criterion. A rating typo is voided, not removed:
 * it shows struck through with its reason, and only its rater or an admin can void it. */
export function BuyerRatingHistory({ buyerId, member, onChanged }: { buyerId: string; member: Member; onChanged?: () => void }) {
 const { t } = useLanguage(); const { data, error, loading } = useBuyerRatings(buyerId); const [voiding, setVoiding] = useState('');
 if (loading) return null;
 if (error || !data) return <p className="live-muted">{t('Ratings could not load.', 'ریٹنگز لوڈ نہیں ہو سکیں۔')}</p>;
 if (!data.ratings.length) return <p className="live-muted">{t('No ratings yet', 'ابھی کوئی ریٹنگ نہیں')}</p>;
 return <ul className="buyer-rating-history">{data.ratings.map(r => {
  const voided = r.voided_at !== null, mine = member.admin || r.created_by === member.user_id;
  return <li key={r.id} className={voided ? 'is-voided' : undefined}>
   <div className="live-muted">{factoryTime(r.created_at)}{r.created_by_name ? ' · ' + r.created_by_name : ''}</div>
   <div className="buyer-rating-scores">{CRITERIA.map(c => <span key={c.key}>{t(c.en, c.ur)} <strong>{r[c.key]}/5</strong></span>)}</div>
   {r.feedback && <p>{r.feedback}</p>}
   {voided && <p className="buyer-rating-void">{t('Voided', 'منسوخ')} · {factoryTime(r.voided_at ?? 0)}{r.void_reason ? ` · ${r.void_reason}` : ''}</p>}
   {!voided && mine && (voiding === r.id
     ? <VoidRatingForm member={member} ratingId={r.id} onCancel={() => setVoiding('')} onSaved={async () => { setVoiding(''); onChanged?.(); }} />
     : <button className="button" onClick={() => setVoiding(r.id)}>{t('Void rating', 'ریٹنگ منسوخ کریں')}</button>)}
  </li>;
 })}</ul>;
}

/** Voids one rating as a typo. The request ID is fixed for this form, so a retry cannot void a second rating. */
function VoidRatingForm({ member, ratingId, onSaved, onCancel }: { member: Member; ratingId: string; onSaved: () => Promise<void>; onCancel: () => void }) {
 const { t } = useLanguage(); const [id] = useState(() => crypto.randomUUID()); const [reason, setReason] = useState(''), [intervention, setIntervention] = useState('');
 return <AsyncForm title={t('Void this rating', 'یہ ریٹنگ منسوخ کریں')} detail={t('For a typo. The rating stays in the history, struck through, and leaves the averages.', 'ٹائپ کی غلطی کے لیے۔ ریٹنگ تاریخ میں کاٹ کر دکھائی جائے گی اور اوسط سے نکل جائے گی۔')}
  submit={t('Void rating', 'ریٹنگ منسوخ کریں')} onCancel={onCancel}
  onSubmit={async () => { await api('/erp/buyer-ratings/void', { id, ratingId, reason, ...(intervention ? { interventionReason: intervention } : {}) }); await onSaved(); }}>
  <Field>{t('Reason', 'وجہ')}<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={500} required /></Field>
  <InterventionField member={member} owners={['sales_manager']} value={intervention} onChange={setIntervention} />
 </AsyncForm>;
}

/** Sales manager form. Ratings are append-only, so the form saves once and the record ID makes retries safe. */
export function RateBuyer({ member, buyerId, onSaved, onCancel }: { member: Member; buyerId: string; onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
 const { t } = useLanguage(); const [id] = useState(() => crypto.randomUUID());
 const [scores, setScores] = useState<Record<Criterion, number>>({ payment: 0, communication: 0, reliability: 0 }), [hover, setHover] = useState<Partial<Record<Criterion, number>>>({});
 const [feedback, setFeedback] = useState(''), [intervention, setIntervention] = useState('');
 return <AsyncForm title={t('Rate buyer', 'خریدار کی ریٹنگ دیں')} submit={t('Save rating', 'ریٹنگ محفوظ کریں')} onCancel={onCancel} note={t('Ratings stay in the buyer history and cannot be edited afterwards.', 'ریٹنگ خریدار کی تاریخ میں محفوظ رہے گی اور بعد میں بدلی نہیں جا سکتی۔')} onSubmit={async () => {
  if (CRITERIA.some(c => !scores[c.key])) throw new Error(t('Rate all three criteria before saving.', 'محفوظ کرنے سے پہلے تینوں پہلوؤں کی ریٹنگ دیں۔'));
  await api('/erp/buyer-ratings', { id, buyerId, ...scores, feedback, ...(intervention ? { interventionReason: intervention } : {}) });
  await onSaved(t('Rating saved.', 'ریٹنگ محفوظ ہو گئی۔'));
 }}>
  {CRITERIA.map(c => { const shown = hover[c.key] ?? scores[c.key]; return <fieldset className="erp-rating-row" key={c.key} onPointerLeave={() => setHover(h => ({ ...h, [c.key]: undefined }))}>
   <legend>{t(c.en, c.ur)}</legend>
   <div className="erp-rating-stars">{[1, 2, 3, 4, 5].map(n => <button type="button" key={n} className={`erp-star-button${n <= shown ? ' is-on' : ''}`} aria-label={t(`${n} of 5 stars`, `5 میں سے ${n} ستارے`)} aria-pressed={scores[c.key] === n} onPointerEnter={() => setHover(h => ({ ...h, [c.key]: n }))} onClick={() => setScores(s => ({ ...s, [c.key]: n }))}><Star size={28} /></button>)}</div>
  </fieldset>; })}
  <Field>{t('Feedback (optional)', 'رائے (اختیاری)')}<textarea value={feedback} onChange={e => setFeedback(e.target.value)} maxLength={1000} /></Field>
  <InterventionField member={member} owners={['sales_manager']} value={intervention} onChange={setIntervention} />
 </AsyncForm>;
}
