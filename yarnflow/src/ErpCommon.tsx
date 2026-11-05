import { useState } from 'react';
import { AsyncForm, Field } from './forms';
import { useLanguage } from './i18n';
import { inventoryRequest as api } from './inventory-client';
import { type SupplierCategory, type ProcurementRfq, type SupplierBid, type PurchaseOrder, type ProcurementShipment, quantity, rate, factoryTime, fixedInput, localFactoryInput, factoryInput } from './erp-client';

export function CategoryPicker({ categories, value, onChange }: { categories: SupplierCategory[]; value: string[]; onChange: (value: string[]) => void }) {
 const { language, t } = useLanguage();
 return <fieldset className="erp-category-picker"><legend>{t('Yarn categories', 'دھاگے کی اقسام')}</legend>{categories.map(c => <label key={c.id}><input type="checkbox" checked={value.includes(c.id)} onChange={e => onChange(e.target.checked ? [...value, c.id] : value.filter(v => v !== c.id))} /><span>{language === 'ur' ? c.urdu_name : c.name}</span></label>)}</fieldset>;
}
export function RfqSummary({ rfq }: { rfq: ProcurementRfq }) {
 const { t } = useLanguage();
 return <div className="erp-order-summary"><h3>{rfq.reference} · {rfq.title}</h3><p className="erp-multiline">{rfq.specifications}</p><dl className="erp-facts"><div><dt>{t('Quantity', 'مقدار')}</dt><dd>{quantity(rfq.quantity_milli)} {rfq.unit}</dd></div><div><dt>{t('Delivery location', 'ترسیل کی جگہ')}</dt><dd>{rfq.delivery_location}</dd></div><div><dt>{t('Bid deadline (PKT)', 'بولی کی آخری تاریخ')}</dt><dd>{factoryTime(rfq.deadline_at)}</dd></div><div><dt>{t('Requested delivery', 'مطلوبہ ترسیل')}</dt><dd>{factoryTime(rfq.requested_delivery_at)}</dd></div></dl></div>;
}
export function BidTerms({ bid, unit }: { bid: SupplierBid; unit: string }) {
 const { t } = useLanguage();
 return <dl className="erp-facts"><div><dt>{t('Rate', 'قیمت')}</dt><dd>{rate(bid.price_minor, bid.currency)} / {unit}</dd></div><div><dt>{t('Offered quantity', 'پیش کردہ مقدار')}</dt><dd>{quantity(bid.quantity_milli)} {unit}</dd></div><div><dt>{t('Payment terms', 'ادائیگی کی شرائط')}</dt><dd>{bid.payment_terms}</dd></div><div><dt>{t('Delivery', 'ترسیل')}</dt><dd>{factoryTime(bid.delivery_at)}</dd></div><div><dt>{t('Valid until', 'میعاد')}</dt><dd>{factoryTime(bid.valid_until)}</dd></div>{bid.note && <div><dt>{t('Note', 'نوٹ')}</dt><dd>{bid.note}</dd></div>}</dl>;
}
export function BidForm({ rfq, previous, onSaved, onCancel }: { rfq: ProcurementRfq; previous?: SupplierBid; onSaved: () => Promise<void>; onCancel: () => void }) {
 const { t } = useLanguage();
 const [id] = useState(previous?.id || crypto.randomUUID()); const [version] = useState(previous?.version || 0);
 const [offered, setOffered] = useState(String((previous?.quantity_milli || rfq.quantity_milli) / 1000));
 const [price, setPrice] = useState(previous ? String(previous.price_minor / 100) : ''); const [currency, setCurrency] = useState(previous?.currency || 'PKR');
 const [payment, setPayment] = useState(previous?.payment_terms || ''); const [note, setNote] = useState(previous?.note || '');
 const [delivery, setDelivery] = useState(localFactoryInput(previous?.delivery_at || rfq.requested_delivery_at));
 const [valid, setValid] = useState(localFactoryInput(previous?.valid_until || rfq.deadline_at + 86400000));
 return <AsyncForm title={t('Your bid', 'آپ کی بولی')} detail={t('Your price is private to the purchase team. Include freight and taxes in your terms.', 'آپ کی قیمت صرف خریداری کی ٹیم دیکھ سکتی ہے۔ شرائط میں کرایہ اور ٹیکس واضح کریں۔')} submit={t('Submit bid', 'بولی جمع کریں')} onCancel={onCancel} onSubmit={async () => { await api('/portal/bids', { id, rfqId: rfq.id, version, quantityMilli: fixedInput(offered, 3, 'Quantity'), priceMinor: fixedInput(price, 2, 'Rate'), currency, paymentTerms: payment, deliveryAt: factoryInput(delivery), validUntil: factoryInput(valid), note }); await onSaved(); }}>
  <RfqSummary rfq={rfq} /><div className="live-fields"><Field>{t('Offered quantity', 'پیش کردہ مقدار')}<input inputMode="decimal" value={offered} onChange={e => setOffered(e.target.value)} required /></Field><Field>{t(`Rate per ${rfq.unit}`, `فی ${rfq.unit} قیمت`)}<input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} required /></Field><Field>{t('Currency', 'کرنسی')}<select value={currency} onChange={e => setCurrency(e.target.value)}>{['PKR', 'USD', 'EUR', 'GBP'].map(c => <option key={c}>{c}</option>)}</select></Field></div>
  <Field>{t('Payment terms', 'ادائیگی کی شرائط')}<textarea value={payment} onChange={e => setPayment(e.target.value)} minLength={3} maxLength={1000} required /></Field>
  <div className="live-fields"><Field>{t('Delivery date and time (PKT)', 'ترسیل کی تاریخ و وقت (پاکستان)')}<input type="datetime-local" value={delivery} onChange={e => setDelivery(e.target.value)} required /></Field><Field>{t('Bid valid until (PKT)', 'بولی کی میعاد (پاکستان)')}<input type="datetime-local" value={valid} onChange={e => setValid(e.target.value)} required /></Field></div>
  <Field>{t('Freight, taxes and other notes', 'کرایہ، ٹیکس اور دیگر تفصیلات')}<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} /></Field>
 </AsyncForm>;
}
export function DispatchNotice({ order, shipments, onSaved, onCancel }: { order: PurchaseOrder; shipments: ProcurementShipment[]; onSaved: () => Promise<void>; onCancel: () => void }) {
 const { t } = useLanguage(); const [id] = useState(crypto.randomUUID());
 const remaining = order.terms.quantity_milli - shipments.filter(s => s.purchase_order_id === order.id).reduce((n, s) => n + s.quantity_milli, 0);
 const [qty, setQty] = useState(String(remaining / 1000)), [bl, setBl] = useState(''), [carrier, setCarrier] = useState(''), [containers, setContainers] = useState(''), [note, setNote] = useState('');
 const [dispatched, setDispatched] = useState(localFactoryInput(Date.now()));
 return <AsyncForm title={t('Record dispatch', 'روانگی درج کریں')} detail={order.reference} submit={t('Save dispatch notice', 'روانگی محفوظ کریں')} onCancel={onCancel} note={t('This records your shipment. It does not confirm arrival or purchase tracking credits.', 'یہ صرف آپ کی روانگی درج کرتا ہے۔ یہ وصولی کی تصدیق یا ٹریکنگ کریڈٹ کی خریداری نہیں ہے۔')} onSubmit={async () => { await api('/portal/dispatches', { id, orderId: order.id, billOfLading: bl, carrier, containers: containers.split(/[\s,]+/).filter(Boolean).map(c => c.toUpperCase()), quantityMilli: fixedInput(qty, 3, 'Quantity'), dispatchedAt: factoryInput(dispatched), note }); await onSaved(); }}>
  <p>{t('Remaining to dispatch:', 'باقی روانگی:')} {quantity(remaining)} {order.terms.unit}</p>
  <Field>{t('Bill of lading number', 'بل آف لیڈنگ نمبر')}<input value={bl} onChange={e => setBl(e.target.value)} minLength={3} maxLength={100} required /></Field>
  <Field>{t('Shipping carrier', 'شپنگ کمپنی')}<input value={carrier} onChange={e => setCarrier(e.target.value)} minLength={2} maxLength={100} required /></Field>
  <Field>{t('Container numbers (optional, separated by commas)', 'کنٹینر نمبر (اختیاری، کوما سے الگ کریں)')}<textarea dir="ltr" value={containers} onChange={e => setContainers(e.target.value)} /></Field>
  <div className="live-fields"><Field>{t(`Quantity (${order.terms.unit})`, `مقدار (${order.terms.unit})`)}<input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} required /></Field><Field>{t('Dispatched at (PKT)', 'روانگی کا وقت (پاکستان)')}<input type="datetime-local" value={dispatched} onChange={e => setDispatched(e.target.value)} required /></Field></div>
  <Field>{t('Dispatch note', 'روانگی کی تفصیل')}<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} /></Field>
 </AsyncForm>;
}
