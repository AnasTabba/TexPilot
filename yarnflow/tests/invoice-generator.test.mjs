import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalFixture } from './portal-fixture.mjs';
import { dueAt, karachiDate } from '../server/sales.mjs';
import { buildInvoicePdf, invoiceDocData } from '../src/invoice-pdf.ts';

const sales = '/erp/sales';
const uuid = () => crypto.randomUUID();
const one = (f, sql, ...args) => f.sql.prepare(sql).get(...args);
const count = (f, sql, ...args) => f.sql.prepare(`SELECT COUNT(*) n FROM (${sql})`).get(...args).n;
const audits = (f, action) => f.sql.prepare('SELECT * FROM erp_audit_events WHERE action=?').all(action);
const generate = (f, body, as = 'Sana') => f.call(`${sales}/invoices/generate`, body, as);
const requestBody = (buyerId, productId, extra = {}) => ({ id: uuid(), buyerId, productId, quantity: 2.5, unit: 'kg', rateMinor: 125000,
  currency: 'PKR', paymentTerms: 'Net 30 days', creditDays: 30, ...extra });
async function setup() {
  const f = await portalFixture();
  await f.person('Sana', 'sales_manager');
  return f;
}
// jsPDF writes text uncompressed by default, so the invoice number and total can be found in the bytes.
function assertPdf(pdf, { number, total }) {
  const bytes = Buffer.from(pdf.output('arraybuffer')), body = bytes.toString('latin1');
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(bytes.length > 1000);
  assert.ok(body.includes(number), 'invoice number in the PDF');
  assert.ok(body.includes(total), 'total in the PDF');
}

test('a staff-entered sale issues a locked invoice with GST, due date and a yearly number', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' }), productId = await f.insertProduct();
  const request = requestBody(buyerId, productId, { specifications: 'Combed cotton single jersey, 180 GSM' });
  const created = await generate(f, request);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const { invoice, order } = created.data;
  // 2.5 kg at 1250.00 is 3125.00; GST 18% is 562.50; total 3687.50 (minor units 312500, 56250, 368750).
  assert.deepEqual([invoice.subtotal_minor, invoice.tax_rate_bp, invoice.tax_minor, invoice.total_minor, invoice.currency], [312500, 1800, 56250, 368750, 'PKR']);
  assert.equal(invoice.number, `INV-${karachiDate(invoice.issued_at).slice(0, 4)}-0001`);
  assert.equal(invoice.due_at, dueAt(invoice.issued_at, 30));
  assert.deepEqual([invoice.payment_terms, invoice.credit_days, invoice.locked, order.status], ['Net 30 days', 30, 1, 'confirmed']);
  const po = one(f, 'SELECT source,status,actor_type,specifications FROM buyer_purchase_orders WHERE id=?', request.id);
  assert.deepEqual([po.source, po.status, po.actor_type, po.specifications], ['staff', 'confirmed', 'staff', 'Combed cotton single jersey, 180 GSM']);
  const acceptance = one(f, "SELECT accepted_by,note FROM quotation_acceptances WHERE revision_id=(SELECT id FROM sales_quote_revisions WHERE buyer_po_id=?)", request.id);
  assert.deepEqual([acceptance.accepted_by, acceptance.note], ['Sana', 'Entered by sales team']);
  assert.equal(audits(f, 'invoice.issued').length, 1);
  assert.equal(audits(f, 'sale.noted').length, 1);
  assert.equal(count(f, 'SELECT 1 FROM invoices'), 1);
});

test('the same request ID returns the same invoice; different values under that ID are refused', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' }), productId = await f.insertProduct();
  const request = requestBody(buyerId, productId);
  const first = await generate(f, request);
  assert.equal(first.status, 201);
  const again = await generate(f, request);
  assert.equal(again.status, 200);
  assert.equal(again.data.invoice.id, first.data.invoice.id);
  assert.equal(count(f, 'SELECT 1 FROM invoices'), 1);
  const changed = await generate(f, { ...request, rateMinor: 130000 });
  assert.equal(changed.status, 409);
  assert.equal(count(f, 'SELECT 1 FROM invoices'), 1);
});

test('a buyer that is not approved is refused with nothing written', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'pending' }), productId = await f.insertProduct();
  const refused = await generate(f, requestBody(buyerId, productId));
  assert.equal(refused.status, 409, JSON.stringify(refused.data));
  assert.equal(count(f, 'SELECT 1 FROM buyer_purchase_orders'), 0);
  assert.equal(count(f, 'SELECT 1 FROM invoices'), 0);
});

test('a quality inspector cannot issue invoices', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' }), productId = await f.insertProduct();
  await f.person('Qasim', 'quality_inspector');
  assert.equal((await generate(f, requestBody(buyerId, productId), 'Qasim')).status, 403);
  assert.equal(count(f, 'SELECT 1 FROM invoices'), 0);
});

test('a bad quantity or rate is refused with 422 and nothing is written', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' }), productId = await f.insertProduct();
  const bad = [
    { quantity: 0 }, { quantity: -1 }, { quantity: 1.2345 }, { quantity: '2.5' },
    { rateMinor: 0 }, { rateMinor: 1.5 }, { rateMinor: '125000' },
    // 0.001 kg at a rate of 0.01 is 0.00001 of a currency unit: not a whole amount in minor units.
    { quantity: 0.001, rateMinor: 1 },
  ];
  for (const change of bad) {
    const result = await generate(f, requestBody(buyerId, productId, change));
    assert.equal(result.status, 422, JSON.stringify(change) + ' ' + JSON.stringify(result.data));
  }
  assert.equal(count(f, 'SELECT 1 FROM buyer_purchase_orders'), 0);
  assert.equal(count(f, 'SELECT 1 FROM invoices'), 0);
});

test('only the factory currency can be invoiced, and an admin must give an intervention reason', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' }), productId = await f.insertProduct();
  assert.equal((await generate(f, requestBody(buyerId, productId, { currency: 'USD' }))).status, 409);
  assert.equal((await generate(f, requestBody(buyerId, productId), 'Anas')).status, 422);
  const reason = 'Sales manager on leave, admin enters the sale';
  const done = await generate(f, requestBody(buyerId, productId, { interventionReason: reason }), 'Anas');
  assert.equal(done.status, 201, JSON.stringify(done.data));
  assert.equal(audits(f, 'invoice.issued')[0].intervention_reason, reason);
});

test('invoice PDFs are real PDFs for staff and for the buyer, built from the buyer invoice route', async () => {
  const f = await setup(), productId = await f.insertProduct(), email = 'pdf@buyer.test', password = 'A strong buyer password 2026';
  assert.equal((await f.call('/buyer/register', { company: 'Pdf Fabrics', contactName: 'Pdf Contact', email, phone: '+923331234567', city: 'Lahore', password }, null)).status, 201);
  const buyerId = one(f, 'SELECT buyer_id FROM buyer_users WHERE email=?', email).buyer_id;
  assert.equal((await f.call(`${sales}/buyers/review`, { id: buyerId, status: 'active', version: 1 }, 'Sana')).status, 200);
  const cookie = (await f.call('/buyer/login', { email, password }, null)).headers.get('set-cookie').split(';')[0];
  const created = await generate(f, requestBody(buyerId, productId, { specifications: 'Ring-spun 30/1' }));
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const invoiceId = created.data.invoice.id, productName = one(f, 'SELECT name FROM products WHERE id=?', productId).name;

  const overview = (await f.call(sales, undefined, 'Sana')).data;
  const staffDoc = invoiceDocData(overview.invoices.find(invoice => invoice.id === invoiceId), overview.saleLines,
    overview.buyers.find(buyer => buyer.id === buyerId), overview.factoryName);
  assert.equal(staffDoc.lines[0].product, productName);
  assertPdf(await buildInvoicePdf(staffDoc), { number: staffDoc.number, total: 'PKR 3,687.50' });

  const json = await f.call(`/buyer/invoices/${invoiceId}?format=json`, undefined, null, { Cookie: cookie });
  assert.equal(json.status, 200, JSON.stringify(json.data));
  assert.deepEqual(Object.keys(json.data.buyer).sort(), ['city', 'contact_name', 'email', 'name', 'phone']);
  assert.equal(json.data.invoice.outstanding_minor, 368750);
  const buyerDoc = invoiceDocData(json.data.invoice, json.data.lines, json.data.buyer, json.data.factoryName);
  assert.equal(buyerDoc.buyer.name, 'Pdf Fabrics');
  assertPdf(await buildInvoicePdf(buyerDoc), { number: buyerDoc.number, total: 'PKR 3,687.50' });

  assert.equal((await f.call(`${sales}/invoices/${invoiceId}`, undefined, 'Sana')).status, 200);
});

test('a material type set on the product is printed on the invoice as issued, and older invoices fall back to the specification', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' }), productId = await f.insertProduct();
  await f.person('Qasim', 'quality_inspector');
  const typed = await f.call('/erp/products/type', { productId, productType: 'Cotton yarn' }, 'Sana');
  assert.equal(typed.status, 200, typed.text);
  assert.equal(one(f, 'SELECT product_type FROM products WHERE id=?', productId).product_type, 'Cotton yarn');
  assert.equal(audits(f, 'product.type_changed').length, 1);

  const created = await generate(f, requestBody(buyerId, productId, { specifications: 'Combed cotton 30/1' }));
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const invoiceId = created.data.invoice.id;
  assert.equal(JSON.parse(created.data.invoice.lines_json)[0].product_type, 'Cotton yarn');

  // The material changes type later; the issued invoice keeps the type it was issued with.
  assert.equal((await f.call('/erp/products/type', { productId, productType: 'Fabric' }, 'Sana')).status, 200);
  const overview = (await f.call(sales, undefined, 'Sana')).data;
  const issued = overview.invoices.find(invoice => invoice.id === invoiceId);
  const doc = invoiceDocData(issued, overview.saleLines, overview.buyers.find(buyer => buyer.id === buyerId), overview.factoryName);
  assert.equal(doc.lines[0].type, 'Cotton yarn');
  const pdf = await buildInvoicePdf(doc);
  assertPdf(pdf, { number: doc.number, total: 'PKR 3,687.50' });
  assert.ok(Buffer.from(pdf.output('arraybuffer')).toString('latin1').includes('Cotton yarn'), 'the type is in the PDF');

  const legacy = { ...issued, lines_json: JSON.stringify([{ specifications: 'Combed cotton 30/1', quantity_milli: 1000, unit: 'kg', price_minor: 100, amount_minor: 100 }]) };
  assert.equal(invoiceDocData(legacy, [], undefined, 'Factory').lines[0].type, 'Combed cotton 30/1', 'older lines show the specification');

  assert.equal((await f.call('/erp/products/type', { productId, productType: 'Fabric' }, 'Qasim')).status, 403);
  assert.equal((await f.call('/erp/products/type', { productId, productType: '' }, 'Sana')).status, 422);
  assert.equal((await f.call('/erp/products/type', { productId: uuid(), productType: 'Fabric' }, 'Sana')).status, 404);
});

test('a material created with a type keeps it, and the type is optional', async () => {
  const f = await setup();
  await f.person('Saima', 'supervisor');
  const withType = await f.call('/products', { sku: 'YRN-30-1', name: 'Combed cotton 30/1', productType: 'Cotton yarn' }, 'Saima');
  assert.equal(withType.status, 201, withType.text);
  assert.equal(one(f, 'SELECT product_type FROM products WHERE sku=?', 'YRN-30-1').product_type, 'Cotton yarn');
  assert.equal((await f.call('/products', { sku: 'YRN-40-1', name: 'Combed cotton 40/1' }, 'Saima')).status, 201);
  assert.equal(one(f, 'SELECT product_type FROM products WHERE sku=?', 'YRN-40-1').product_type, null);
  assert.equal((await f.call('/products', { sku: 'YRN-50-1', name: 'Combed cotton 50/1', productType: 'x'.repeat(61) }, 'Saima')).status, 422);
});

test('a voided invoice carries a VOID stamp in its PDF', async () => {
  const f = await setup(), buyerId = await f.insertBuyer({ status: 'active' }), productId = await f.insertProduct();
  const created = await generate(f, requestBody(buyerId, productId));
  const invoiceId = created.data.invoice.id;
  const voided = await f.call(`${sales}/invoices/void`, { id: uuid(), invoiceId, reason: 'Issued for the wrong quantity' }, 'Sana');
  assert.equal(voided.status, 201, voided.text);
  const overview = (await f.call(sales, undefined, 'Sana')).data;
  const doc = invoiceDocData(overview.invoices.find(invoice => invoice.id === invoiceId), overview.saleLines, overview.buyers.find(buyer => buyer.id === buyerId), overview.factoryName);
  assert.equal(doc.voidReason, 'Issued for the wrong quantity');
  const pdf = await buildInvoicePdf(doc);
  assertPdf(pdf, { number: doc.number, total: 'PKR 3,687.50' });
  assert.ok(Buffer.from(pdf.output('arraybuffer')).toString('latin1').includes('VOID'), 'the stamp is in the PDF');
});
