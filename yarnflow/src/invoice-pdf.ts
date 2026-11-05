// Invoice data and the A4 PDF builder. No React here, so the node test can load it directly.
// jsPDF is loaded with a dynamic import: it stays out of the main bundle until someone downloads a PDF.
import type { jsPDF } from 'jspdf';

/** The invoice fields the document needs; the staff sales overview and the buyer invoice route both supply them. */
export type InvoiceSource = {
  number: string; issued_at: number; due_at: number | null; currency: string; sales_order_id: string; order_reference?: string;
  payment_terms?: string; credit_days?: number | null; subtotal_minor: number | null; tax_rate_bp: number | null; tax_minor: number | null;
  total_minor: number; paid_minor: number; credited_minor: number; outstanding_minor: number; lines_json: string;
  voided_at?: number | null; void_reason?: string | null;
};
export type BuyerSource = { name: string; contact_name: string; city: string; email: string; phone: string };
export type SaleLineSource = { sales_order_id: string; product_name: string | null };

export type InvoiceDocData = {
  number: string; issuedAt: number; dueAt: number | null; currency: string; factoryName: string; orderReference: string;
  paymentTerms: string; creditDays: number | null;
  buyer: { name: string; contact: string; city: string; email: string; phone: string };
  lines: { product: string; type: string; quantityMilli: number; unit: string; priceMinor: number; amountMinor: number }[];
  subtotalMinor: number | null; taxRateBp: number | null; taxMinor: number | null; totalMinor: number;
  paidMinor: number; creditedMinor: number; balanceMinor: number;
  voidedAt: number | null; voidReason: string | null;
};

// Lines store the material type as it was when the invoice was issued; older invoices have none and show the specification.
type StoredLine = { specifications: string; product_type?: string | null; quantity_milli: number; unit: string; price_minor: number; amount_minor: number };

/** Builds the document data from one invoice row. Product names come from the sale's order lines. */
export function invoiceDocData(invoice: InvoiceSource, saleLines: SaleLineSource[], buyer: BuyerSource | undefined, factoryName: string, buyerName = ''): InvoiceDocData {
  const productName = saleLines.find(line => line.sales_order_id === invoice.sales_order_id && line.product_name)?.product_name ?? null;
  const lines = (JSON.parse(invoice.lines_json) as StoredLine[]).map(line => ({
    product: productName ?? line.specifications, type: line.product_type || line.specifications, quantityMilli: line.quantity_milli, unit: line.unit,
    priceMinor: line.price_minor, amountMinor: line.amount_minor,
  }));
  return {
    number: invoice.number, issuedAt: invoice.issued_at, dueAt: invoice.due_at, currency: invoice.currency, factoryName,
    orderReference: invoice.order_reference ?? '', paymentTerms: invoice.payment_terms ?? '', creditDays: invoice.credit_days ?? null,
    buyer: { name: buyer?.name ?? buyerName, contact: buyer?.contact_name ?? '', city: buyer?.city ?? '', email: buyer?.email ?? '', phone: buyer?.phone ?? '' },
    lines, subtotalMinor: invoice.subtotal_minor, taxRateBp: invoice.tax_rate_bp, taxMinor: invoice.tax_minor, totalMinor: invoice.total_minor,
    paidMinor: invoice.paid_minor, creditedMinor: invoice.credited_minor, balanceMinor: invoice.outstanding_minor,
    voidedAt: invoice.voided_at ?? null, voidReason: invoice.void_reason ?? null,
  };
}

/** Same format as the on-screen money helper; the PDF is English and Helvetica has no Urdu. */
export const pdfMoney = (minor: number, currency: string) => `${currency} ${new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
export const pdfDate = (time: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium' }).format(time);
const quantityText = (milli: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(milli / 1000);

/** Lays out the A4 invoice. Returns the jsPDF document; call `.save()` or `.output('arraybuffer')`. */
export async function buildInvoicePdf(doc: InvoiceDocData): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const left = 48, right = 595.28 - 48, middle = 320, bottom = 780;
  const cols = [['Product', 110], ['Type', 120], ['Quantity', 55], ['Unit', 40], ['Rate', 80], ['Amount', 94.28]] as const;
  const rightAligned = (label: string) => label === 'Quantity' || label === 'Rate' || label === 'Amount';
  let y = 60;
  const text = (value: string, x: number, at: number, align: 'left' | 'right' = 'left') => pdf.text(value, x, at, { align });
  const rule = (at: number) => { pdf.setDrawColor(170); pdf.line(left, at, right, at); };
  const newPageIfNeeded = (needed: number) => { if (y + needed > bottom) { pdf.addPage(); y = 60; } };

  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.setTextColor(17); text(doc.factoryName, left, y);
  pdf.setFontSize(22); text('INVOICE', right, y, 'right');
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(85);
  y += 18; text(doc.number, right, y, 'right');
  y += 14; text(`Issued ${pdfDate(doc.issuedAt)}`, right, y, 'right');
  y += 14; rule(y);

  y += 26; pdf.setFont('helvetica', 'bold'); pdf.setTextColor(85); text('BILL TO', left, y); text('DETAILS', middle, y);
  pdf.setFont('helvetica', 'normal'); pdf.setTextColor(17);
  const billTo = [doc.buyer.name, doc.buyer.contact, doc.buyer.city, doc.buyer.email, doc.buyer.phone].filter(Boolean);
  const details: [string, string][] = [['Buyer order', doc.orderReference || '—'], ['Payment terms', doc.paymentTerms || '—'],
    ['Credit days', doc.creditDays === null ? '—' : String(doc.creditDays)], ['Due date', doc.dueAt === null ? '—' : pdfDate(doc.dueAt)]];
  billTo.forEach((line, index) => text(line, left, y + 16 + index * 14));
  details.forEach(([label, value], index) => { text(label, middle, y + 16 + index * 14); text(value, right, y + 16 + index * 14, 'right'); });
  y += 16 + Math.max(billTo.length, details.length) * 14 + 12;

  rule(y); y += 16; pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(85);
  let x = left;
  for (const [label, width] of cols) { text(label, rightAligned(label) ? x + width - 4 : x, y, rightAligned(label) ? 'right' : 'left'); x += width; }
  y += 8; rule(y); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(17);
  for (const line of doc.lines) {
    const product = pdf.splitTextToSize(line.product, cols[0][1] - 6) as string[], type = pdf.splitTextToSize(line.type, cols[1][1] - 6) as string[];
    const rows = Math.max(product.length, type.length);
    newPageIfNeeded(rows * 12 + 14);
    y += 14; x = left;
    const cells = [product, type, [quantityText(line.quantityMilli)], [line.unit], [pdfMoney(line.priceMinor, doc.currency)], [pdfMoney(line.amountMinor, doc.currency)]];
    cells.forEach((cell, index) => {
      const width = cols[index][1], right = rightAligned(cols[index][0]);
      cell.forEach((part, row) => text(part, right ? x + width - 4 : x, y + row * 12, right ? 'right' : 'left'));
      x += width;
    });
    y += (rows - 1) * 12;
  }
  y += 10; rule(y);
  const gst = `GST (${(doc.taxRateBp ?? 0) / 100}%)`;
  const totals: [string, string, boolean][] = [];
  if (doc.subtotalMinor !== null) totals.push(['Subtotal', pdfMoney(doc.subtotalMinor, doc.currency), false]);
  if (doc.taxMinor !== null) totals.push([gst, pdfMoney(doc.taxMinor, doc.currency), false]);
  totals.push(['Total due', pdfMoney(doc.totalMinor, doc.currency), true], ['Paid', pdfMoney(doc.paidMinor, doc.currency), false]);
  if (doc.creditedMinor > 0) totals.push(['Credit notes', pdfMoney(doc.creditedMinor, doc.currency), false]);
  totals.push(['Balance', pdfMoney(doc.balanceMinor, doc.currency), true]);
  for (const [label, value, strong] of totals) {
    y += 16; pdf.setFont('helvetica', strong ? 'bold' : 'normal'); text(label, middle + 60, y); text(value, right, y, 'right');
  }
  y += 40; pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(85);
  text(`Payable per the quoted payment terms: ${doc.paymentTerms || '—'}.`, left, y);
  if (doc.voidedAt !== null) {
    // A voided invoice keeps its numbers on record; the stamp marks it as not payable.
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(96); pdf.setTextColor(190, 30, 30);
    pdf.text('VOID', 297.64, 430, { align: 'center', angle: 30 });
    pdf.setFontSize(9); text(`Voided ${pdfDate(doc.voidedAt)}${doc.voidReason ? `: ${doc.voidReason}` : ''}`, left, y + 14);
  }
  return pdf;
}

/** Builds the PDF and saves it as `<invoice number>.pdf`. */
export async function downloadInvoicePdf(doc: InvoiceDocData) {
  const pdf = await buildInvoicePdf(doc);
  pdf.save(`${doc.number}.pdf`);
}
