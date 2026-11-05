import { useState } from 'react';
import { AsyncForm, Field } from './forms';
import { useLanguage } from './i18n';
import { InterventionField, money } from './PortalCommon';
import { fixedInput } from './erp-client';
import { factoryDate, factoryDateValue } from './sales-client';
import type { Member } from './inventory-client';
import './invoice.css';

type Buyer = { id: string; name: string; status: string };
type Product = { id: string; sku: string; name: string; product_type?: string | null };
/** Values a corrected invoice starts from: the voided invoice's buyer, material and terms. Everything stays editable. */
export type InvoicePrefill = { buyerId: string; productId: string; quantity: string; unit: string; rate: string; currency: string;
  paymentTerms: string; creditDays: string; specifications: string; delivery: string; voidedNumber: string };
/** Material types the sales team picks from; "Other" takes free text. */
const typePresets = ['Cotton yarn', 'Polyester yarn', 'Blended yarn', 'Viscose yarn', 'Fabric'] as const;
const typeFor = (product?: Product) => {
  const value = product?.product_type ?? '';
  if (!value) return { choice: '', text: '' };
  return (typePresets as readonly string[]).includes(value) ? { choice: value, text: '' } : { choice: 'other', text: value };
};
const currencies = ['PKR', 'USD', 'EUR', 'GBP'] as const;
/** Payment-term presets fill the terms text and credit days; both stay editable. */
const termPresets = [
  { id: 'advance', en: 'Advance', ur: 'پیشگی', terms: 'Advance payment', days: 0 },
  { id: 'net15', en: 'Net 15', ur: 'نیٹ 15', terms: 'Net 15 days', days: 15 },
  { id: 'net30', en: 'Net 30', ur: 'نیٹ 30', terms: 'Net 30 days', days: 30 },
  { id: 'net60', en: 'Net 60', ur: 'نیٹ 60', terms: 'Net 60 days', days: 60 },
  { id: 'other', en: 'Other terms', ur: 'دیگر شرائط', terms: '', days: 30 },
] as const;
const owner = ['sales_manager'] as const;

/** Whole amount in minor units from a quantity (up to three decimals) and a rate, or null when either is not usable. */
function previewOf(quantity: string, rate: string, taxRateBp: number) {
  const quantityMilli = /^\d+(\.\d{1,3})?$/.test(quantity.trim()) ? Math.round(Number(quantity) * 1000) : 0;
  let rateMinor = 0;
  try { rateMinor = fixedInput(rate, 2, 'Rate'); } catch { rateMinor = 0; }
  if (!quantityMilli || !rateMinor) return null;
  const amountMilli = rateMinor * quantityMilli;
  if (amountMilli % 1000 !== 0) return { quantityMilli, rateMinor, error: true as const };
  const subtotal = amountMilli / 1000, tax = Math.floor((subtotal * taxRateBp + 5000) / 10000);
  return { quantityMilli, rateMinor, subtotal, tax, total: subtotal + tax, error: false as const };
}

/** New invoice for an approved buyer. The server records the RFQ, quotation and acceptance as entered by the sales team, then issues the invoice. */
export function InvoiceGenerator({ member, buyers, products, currency, taxRateBp, prefill, onCancel, onSave, onSaveProductType }: {
  member: Member; buyers: Buyer[]; products: Product[]; currency: string; taxRateBp: number; prefill?: InvoicePrefill; onCancel: () => void;
  onSave: (body: unknown) => Promise<void>; onSaveProductType: (productId: string, productType: string | null, intervention: string) => Promise<void>;
}) {
  const { t } = useLanguage();
  const approved = buyers.filter(buyer => buyer.status === 'active');
  const [id] = useState(() => crypto.randomUUID());
  // A prefilled buyer or material that is no longer selectable falls back to the first option, so the controlled selects stay valid.
  const [buyerId, setBuyerId] = useState(approved.some(buyer => buyer.id === prefill?.buyerId) ? prefill!.buyerId : approved[0]?.id ?? ''),
    [productId, setProductId] = useState(products.some(product => product.id === prefill?.productId) ? prefill!.productId : products[0]?.id ?? '');
  const [quantity, setQuantity] = useState(prefill?.quantity ?? ''), [unit, setUnit] = useState(prefill?.unit ?? 'kg'), [rate, setRate] = useState(prefill?.rate ?? '');
  const [invoiceCurrency, setInvoiceCurrency] = useState(prefill?.currency ?? currency);
  const [preset, setPreset] = useState<typeof termPresets[number]['id']>(prefill ? (termPresets.find(item => item.terms === prefill.paymentTerms)?.id ?? 'other') : 'net30');
  const [terms, setTerms] = useState(prefill?.paymentTerms ?? 'Net 30 days'), [creditDays, setCreditDays] = useState(prefill?.creditDays ?? '30');
  const [specifications, setSpecifications] = useState(prefill?.specifications ?? ''), [delivery, setDelivery] = useState(prefill?.delivery ?? ''), [intervention, setIntervention] = useState('');
  const initialType = typeFor(products.find(product => product.id === productId));
  const [typeChoice, setTypeChoice] = useState(initialType.choice), [typeText, setTypeText] = useState(initialType.text);

  const choosePreset = (value: string) => {
    const found = termPresets.find(item => item.id === value) ?? termPresets[2];
    setPreset(found.id); setTerms(found.terms); setCreditDays(String(found.days));
  };
  const chooseProduct = (value: string) => {
    setProductId(value);
    const next = typeFor(products.find(product => product.id === value));
    setTypeChoice(next.choice); setTypeText(next.text);
  };
  const selectedProduct = products.find(product => product.id === productId);
  const nextType = (typeChoice === 'other' ? typeText.trim() : typeChoice) || null;
  const line = previewOf(quantity, rate, taxRateBp);
  const days = Number(creditDays) || 0;
  const due = factoryDate(Date.now() + days * 86400000);
  const preview = <section className="invoice-preview" aria-label={t('Invoice preview', 'انوائس کا پیش نظارہ')}>
    <h3>{t('Preview', 'پیش نظارہ')}</h3>
    {line?.error && <p className="live-warning">{t('Choose a quantity and rate that give a whole amount in the smallest currency unit.', 'ایسی مقدار اور شرح منتخب کریں جو سب سے چھوٹی کرنسی اکائی میں مکمل رقم دے۔')}</p>}
    {selectedProduct && line && !line.error ? <table className="invoice-preview-table">
      <thead><tr><th>{t('Product', 'مصنوعات')}</th><th className="num">{t('Quantity', 'مقدار')}</th><th className="num">{t('Rate', 'شرح')}</th><th className="num">{t('Amount', 'رقم')}</th></tr></thead>
      <tbody><tr><td>{selectedProduct.name}{nextType && <small> · {nextType}</small>}{specifications.trim() && <small> · {specifications.trim()}</small>}</td><td className="num">{quantity} {unit}</td><td className="num">{money(line.rateMinor, invoiceCurrency)}</td><td className="num">{money(line.subtotal, invoiceCurrency)}</td></tr></tbody>
    </table> : <p className="invoice-preview-empty">{t('Enter a product, quantity and rate to see the invoice.', 'انوائس دیکھنے کے لیے مصنوعات، مقدار اور شرح درج کریں۔')}</p>}
    {line && !line.error && <dl className="invoice-doc-totals">
      <div><dt>{t('Subtotal', 'ذیلی کل')}</dt><dd>{money(line.subtotal, invoiceCurrency)}</dd></div>
      <div><dt>{t(`GST (${taxRateBp / 100}%)`, `جی ایس ٹی (${taxRateBp / 100}%)`)}</dt><dd>{money(line.tax, invoiceCurrency)}</dd></div>
      <div className="is-total"><dt>{t('Total', 'کل')}</dt><dd>{money(line.total, invoiceCurrency)}</dd></div>
    </dl>}
    <p className="invoice-preview-due">{t('Due', 'آخری تاریخ')}: <strong>{due}</strong> · {t(`${days} days credit`, `${days} دن ادھار`)}</p>
  </section>;

  return <AsyncForm title={t('New invoice', 'نئی انوائس')} detail={t('Creates a locked invoice for an approved buyer. Numbering and GST follow the sales settings.', 'کسی منظور شدہ خریدار کے لیے مقفل انوائس بناتا ہے۔ نمبر اور جی ایس ٹی سیلز سیٹنگز کے مطابق ہوں گے۔')}
    submit={t('Issue invoice', 'انوائس جاری کریں')} onCancel={onCancel} note={t('An issued invoice is locked. Corrections are made with credit notes.', 'جاری انوائس مقفل ہوتی ہے۔ اصلاح کریڈٹ نوٹ سے ہوتی ہے۔')}
    onSubmit={async () => {
      if (typeChoice === 'other' && !typeText.trim()) throw new Error(t('Enter the material type, or choose a preset.', 'مواد کی قسم درج کریں، یا کوئی پری سیٹ چنیں۔'));
      // The type is saved to the material first, so the invoice line takes it at issue time. Changing it is audited.
      if (selectedProduct && nextType !== (selectedProduct.product_type || null)) await onSaveProductType(productId, nextType, intervention);
      await onSave({
        id, buyerId, productId, quantity: Number(quantity), unit, rateMinor: fixedInput(rate, 2, 'Rate'), currency: invoiceCurrency,
        paymentTerms: terms, creditDays: Number(creditDays), ...(specifications.trim() ? { specifications: specifications.trim() } : {}),
        ...(delivery ? { deliveryAt: factoryDateValue(delivery) } : {}), ...(intervention ? { interventionReason: intervention } : {}),
      });
    }}>
    {prefill && <p className="invoice-prefill-note">{t(`Corrected invoice: values start from the voided invoice ${prefill.voidedNumber}. Check each one before issuing.`, `درست شدہ انوائس: قدریں منسوخ انوائس ${prefill.voidedNumber} سے شروع ہوئیں۔ جاری کرنے سے پہلے ہر ایک چیک کریں۔`)}</p>}
    {!approved.length && <p className="live-warning">{t('No approved buyers yet. Approve a buyer before issuing an invoice.', 'ابھی کوئی منظور شدہ خریدار نہیں۔ انوائس جاری کرنے سے پہلے خریدار منظور کریں۔')}</p>}
    <Field>{t('Buyer', 'خریدار')}<select value={buyerId} onChange={event => setBuyerId(event.target.value)} required>{approved.map(buyer => <option key={buyer.id} value={buyer.id}>{buyer.name}</option>)}</select></Field>
    <div className="invoice-form-row">
      <Field>{t('Product', 'مصنوعات')}<select value={productId} onChange={event => chooseProduct(event.target.value)} required>{products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.product_type || t('type not set', 'قسم درج نہیں')}</option>)}</select></Field>
      <Field>{t('Type', 'قسم')}<select value={typeChoice} onChange={event => setTypeChoice(event.target.value)}>
        <option value="">{t('Not set', 'درج نہیں')}</option>{typePresets.map(item => <option key={item} value={item}>{item}</option>)}<option value="other">{t('Other', 'دیگر')}</option>
      </select></Field>
      {typeChoice === 'other' && <Field>{t('Type name', 'قسم کا نام')}<input value={typeText} onChange={event => setTypeText(event.target.value)} maxLength={60} required /></Field>}
    </div>
    {selectedProduct && nextType !== (selectedProduct.product_type || null) && <p className="invoice-type-hint">{t('Saving this invoice also changes the material’s type for future invoices. Invoices already issued keep their type.', 'یہ انوائس محفوظ کرنے سے مواد کی قسم آئندہ انوائسز کے لیے بھی بدل جائے گی۔ جاری شدہ انوائسز اپنی قسم برقرار رکھیں گی۔')}</p>}
    <div className="invoice-form-row">
      <Field>{t('Quantity', 'مقدار')}<input type="number" inputMode="decimal" min="0.001" step="0.001" value={quantity} onChange={event => setQuantity(event.target.value)} required /></Field>
      <Field>{t('Unit', 'اکائی')}<select value={unit} onChange={event => setUnit(event.target.value)}><option value="kg">kg</option><option value="metre">{t('metre', 'میٹر')}</option><option value="piece">{t('piece', 'نگ')}</option></select></Field>
      <Field>{t('Rate per unit', 'فی اکائی شرح')}<input inputMode="decimal" value={rate} onChange={event => setRate(event.target.value)} required /></Field>
      <Field>{t('Currency', 'کرنسی')}<select value={invoiceCurrency} onChange={event => setInvoiceCurrency(event.target.value)}>{currencies.map(code => <option key={code} value={code} disabled={code !== currency}>{code}{code !== currency ? ` (${t('factory currency is ' + currency, 'فیکٹری کی کرنسی ' + currency)})` : ''}</option>)}</select></Field>
    </div>
    <div className="invoice-form-row">
      <Field>{t('Payment terms', 'ادائیگی کی شرائط')}<select value={preset} onChange={event => choosePreset(event.target.value)}>{termPresets.map(item => <option key={item.id} value={item.id}>{t(item.en, item.ur)}</option>)}</select></Field>
      <Field>{t('Terms text', 'شرائط کا متن')}<input value={terms} onChange={event => setTerms(event.target.value)} minLength={3} maxLength={1000} required /></Field>
      <Field>{t('Credit days', 'ادھار کے دن')}<input type="number" min="0" max="365" value={creditDays} onChange={event => setCreditDays(event.target.value)} required /></Field>
      <Field>{t('Delivery date (optional)', 'ترسیل کی تاریخ (اختیاری)')}<input type="date" value={delivery} onChange={event => setDelivery(event.target.value)} /></Field>
    </div>
    <Field>{t('Specifications (optional)', 'تفصیلات (اختیاری)')}<textarea value={specifications} onChange={event => setSpecifications(event.target.value)} maxLength={4000} placeholder={t('Type or quality of the material, for example combed cotton 30/1', 'مواد کی قسم یا معیار، مثلاً کومبڈ کاٹن 30/1')} /></Field>
    {preview}
    <InterventionField member={member} owners={[...owner]} value={intervention} onChange={setIntervention} />
  </AsyncForm>;
}
