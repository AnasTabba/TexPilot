import { expect, type Page } from '@playwright/test';

export const origin = `http://127.0.0.1:${process.env.YARNFLOW_TEST_PORT || 8794}`;

/** Sign in with a name and 4-digit PIN. The app now opens on the PIN screen, not a workspace form. */
export async function signIn(page: Page, name = 'Anas', pin = '2468') {
  await page.goto('/');
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByLabel('4-digit PIN', { exact: true }).fill(pin);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

/** One signed-in API call; the server rejects writes without a same-origin Origin header. */
export async function apiPost<T = Record<string, unknown>>(page: Page, path: string, data: object): Promise<T> {
  const response = await page.request.post('/api' + path, { data, headers: { Origin: origin } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export async function workspace(page: Page) {
  const response = await page.request.get('/api/workspace');
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

/** The test database starts with four real-shaped yarns; tests identify them by batch number. */
export async function seededLot(page: Page, batch: string) {
  const state = await workspace(page);
  const lot = state.lots.find((candidate: { batch: string }) => candidate.batch === batch);
  expect(lot, `seeded batch ${batch}`).toBeTruthy();
  return { lot, state };
}

/** Seed real QC arrivals through the supplier, purchasing, shipment and receiving APIs. */
export async function seedQcLots(page: Page, references: string[]) {
  const call = async <T = Record<string, unknown>>(path: string, data: object, headers: Record<string, string> = {}) => {
    const response = await page.request.post('/api' + path, { data, headers: { Origin: origin, ...headers } });
    expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
    return response.json() as Promise<T>;
  };
  const suffix = crypto.randomUUID().slice(0, 8), email = `quality-${suffix}@factory.test`, token = { Authorization: 'Bearer e2e-supplier-portal-token-000000000000' }, supplierId = crypto.randomUUID();
  await call('/integration/v1/suppliers', { id: supplierId, company: `Quality test mill ${suffix}`, contactName: 'Quality Contact', email, phone: '+923001234567', categories: ['cotton'] }, token);
  const pending = await page.request.get('/api/erp/suppliers?status=pending').then(response => response.json());
  const supplier = pending.suppliers.find((row: { email: string }) => row.email === email);
  expect(supplier).toBeTruthy();
  await call('/erp/suppliers/review', { id: supplier.id, version: supplier.version, status: 'approved', reason: 'Verified in supervisor e2e setup', categories: ['cotton'], interventionReason: 'Test fixture setup' });
  const now = Date.now();
  const { rfq } = await call<{ rfq: { id: string; quantity_milli: number } }>('/erp/rfqs', { id: crypto.randomUUID(), title: `QC e2e ${suffix}`, categoryId: 'cotton', specifications: 'Combed cotton for QC end to end coverage', quantityMilli: 100000, unit: 'kg', deliveryLocation: 'Test factory', deadlineAt: now + 86400000, requestedDeliveryAt: now + 172800000, interventionReason: 'Test fixture setup' });
  await call('/erp/rfqs/publish', { id: rfq.id, interventionReason: 'Test fixture setup' });
  const { bid } = await call<{ bid: { id: string; version: number } }>('/integration/v1/bids', { supplierId, id: crypto.randomUUID(), rfqId: rfq.id, version: 0, quantityMilli: rfq.quantity_milli, priceMinor: 1, currency: 'PKR', paymentTerms: 'Net 30', deliveryAt: now + 172800000, validUntil: now + 86400000, note: 'QC e2e fixture' }, token);
  const { order } = await call<{ order: { id: string } }>('/erp/bids/award', { id: bid.id, version: bid.version, interventionReason: 'Test fixture setup' });
  const { shipment } = await call<{ shipment: { id: string } }>('/erp/shipments', { id: crypto.randomUUID(), orderId: order.id, billOfLading: `QCE2E-${suffix}`, interventionReason: 'Test fixture setup' });
  const state = await workspace(page), product = state.products.find((row: { sku: string }) => row.sku === 'CTN-30');
  expect(product).toBeTruthy();
  const lots = [];
  for (const reference of references) {
    lots.push(await call('/erp/qc/lots', { id: crypto.randomUUID(), orderId: order.id, shipmentId: shipment.id, productId: product.id, reference, quantityMilli: 20000, arrivedAt: Date.now(), interventionReason: 'Test fixture setup' }));
  }
  return { lots, setupIds: { orderId: order.id, shipmentId: shipment.id, supplierId: supplier.id } };
}
