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
