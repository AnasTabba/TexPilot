import { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { useLanguage } from './i18n';
import { money } from './PortalCommon';
import { factoryDate } from './sales-client';
import { downloadInvoicePdf, type InvoiceDocData } from './invoice-pdf';
import './invoice.css';

const quantityText = (milli: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(milli / 1000);
const gstLabel = (bp: number | null) => `${(bp ?? 0) / 100}%`;

/** Creates the PDF for one invoice and says so when that fails. */
export function PdfDownloadButton({ build, primary = false }: { build: () => InvoiceDocData | Promise<InvoiceDocData>; primary?: boolean }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const download = async () => {
    setBusy(true); setFailed(false);
    try { await downloadInvoicePdf(await build()); } catch { setFailed(true); } finally { setBusy(false); }
  };
  return <>
    <button className={`button${primary ? ' primary' : ''}`} onClick={() => void download()} disabled={busy}><Download size={18} aria-hidden="true" />{busy ? t('Preparing PDF…', 'PDF تیار ہو رہا ہے…') : t('Download PDF', 'PDF ڈاؤن لوڈ کریں')}</button>
    {failed && <p role="alert" className="live-error">{t('The PDF could not be created. Try again.', 'PDF نہیں بن سکا۔ دوبارہ کوشش کریں۔')}</p>}
  </>;
}

/** The printable invoice for any invoice: PDF download, the browser print option, and the document on screen. */
export function InvoiceDocument({ doc }: { doc: InvoiceDocData }) {
  const { t } = useLanguage();
  return <section className="invoice-screen" aria-label={t('Invoice document', 'انوائس کی دستاویز')}>
    <div className="invoice-toolbar">
      <PdfDownloadButton build={() => doc} primary />
      <button className="button" onClick={() => window.print()}><Printer size={18} aria-hidden="true" />{t('Print', 'پرنٹ کریں')}</button>
    </div>
    <article className="invoice-doc">
      <header className="invoice-doc-head">
        <div><p className="invoice-kicker">{t('Invoice', 'انوائس')}</p><h3>{doc.factoryName}</h3></div>
        <div className="invoice-doc-number"><strong>{doc.number}</strong><span>{t('Issued', 'جاری')} {factoryDate(doc.issuedAt)}</span></div>
      </header>
      <div className="invoice-doc-grid">
        <div>
          <h4>{t('Bill to', 'بل بھیجا گیا')}</h4>
          <p><strong>{doc.buyer.name}</strong></p>
          {doc.buyer.contact && <p>{doc.buyer.contact}</p>}
          {doc.buyer.city && <p>{doc.buyer.city}</p>}
          {doc.buyer.email && <p>{doc.buyer.email}</p>}
          {doc.buyer.phone && <p dir="ltr">{doc.buyer.phone}</p>}
        </div>
        <dl className="invoice-doc-facts">
          <div><dt>{t('Buyer order', 'خریدار کا آرڈر')}</dt><dd>{doc.orderReference || '—'}</dd></div>
          <div><dt>{t('Payment terms', 'ادائیگی کی شرائط')}</dt><dd>{doc.paymentTerms || '—'}</dd></div>
          <div><dt>{t('Credit days', 'ادھار کے دن')}</dt><dd>{doc.creditDays ?? '—'}</dd></div>
          <div><dt>{t('Due date', 'آخری تاریخ')}</dt><dd>{doc.dueAt === null ? '—' : factoryDate(doc.dueAt)}</dd></div>
        </dl>
      </div>
      {doc.voidedAt !== null && <div className="invoice-void-stamp" role="img" aria-label={t('Voided invoice', 'منسوخ انوائس')}>
        VOID<small>{t('Voided', 'منسوخ')} {factoryDate(doc.voidedAt)}{doc.voidReason ? ` · ${doc.voidReason}` : ''}</small>
      </div>}
      <table className="invoice-doc-table">
        <thead><tr>
          <th>{t('Product', 'مصنوعات')}</th><th>{t('Type', 'قسم')}</th><th className="num">{t('Quantity', 'مقدار')}</th><th>{t('Unit', 'اکائی')}</th><th className="num">{t('Rate', 'شرح')}</th><th className="num">{t('Amount', 'رقم')}</th>
        </tr></thead>
        <tbody>{doc.lines.map((line, index) => <tr key={index}>
          <td>{line.product}</td><td>{line.type}</td><td className="num">{quantityText(line.quantityMilli)}</td><td>{line.unit}</td>
          <td className="num">{money(line.priceMinor, doc.currency)}</td><td className="num">{money(line.amountMinor, doc.currency)}</td>
        </tr>)}</tbody>
      </table>
      <dl className="invoice-doc-totals">
        {doc.subtotalMinor !== null && <div><dt>{t('Subtotal', 'ذیلی کل')}</dt><dd>{money(doc.subtotalMinor, doc.currency)}</dd></div>}
        {doc.taxMinor !== null && <div><dt>{t(`GST (${gstLabel(doc.taxRateBp)})`, `جی ایس ٹی (${gstLabel(doc.taxRateBp)})`)}</dt><dd>{money(doc.taxMinor, doc.currency)}</dd></div>}
        <div className="is-total"><dt>{t('Total due', 'کل واجب')}</dt><dd>{money(doc.totalMinor, doc.currency)}</dd></div>
        <div><dt>{t('Amount paid', 'ادا شدہ رقم')}</dt><dd>{money(doc.paidMinor, doc.currency)}</dd></div>
        {doc.creditedMinor > 0 && <div><dt>{t('Credit notes', 'کریڈٹ نوٹس')}</dt><dd>{money(doc.creditedMinor, doc.currency)}</dd></div>}
        <div className="is-total"><dt>{t('Balance', 'بقایا')}</dt><dd>{money(doc.balanceMinor, doc.currency)}</dd></div>
      </dl>
      <p className="invoice-doc-note">{t(`Payable per the quoted payment terms: ${doc.paymentTerms || '—'}.`, `ادائیگی مقررہ شرائط کے مطابق: ${doc.paymentTerms || '—'}۔`)}</p>
    </article>
  </section>;
}
