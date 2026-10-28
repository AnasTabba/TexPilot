// Test fixture only: four yarns with one batch each, entered through the API so the ledger and QC
// rules apply. The dev server loads it into its in-memory test database (YARNFLOW_TEST_MODE=1) for
// the end-to-end tests. Never load it into a real database: the live site shows only real entries.
const yarns = [
  ['CTN-30', 'Combed cotton Ne 30/1', 'Crescent Cotton Co.', 8250, 'approved'],
  ['PC-26', 'Poly cotton Ne 26/1', 'Indus Textile Mills', 5950, 'approved'],
  ['PES-40', 'Polyester Ne 40/1', 'Crescent Cotton Co.', 4100, 'uninspected'],
  ['VIS-30', 'Viscose Ne 30/1', 'Indus Textile Mills', 3350, 'hold'],
];
const move = (lotId, action, kg, stage, toStage) => ({
  id: crypto.randomUUID(), lotId, action, stage, ...(toStage ? { toStage } : {}),
  grams: kg * 1000, cartons: Math.round(kg / 250), cones: Math.round(kg / 25), note: 'Opening inventory',
});

/** post(path, body) sends one signed-in API request and resolves to its JSON. */
export async function seedDemoStock(post) {
  const lots = [];
  for (const [i, [sku, name, supplier, kg, quality]] of yarns.entries()) {
    const product = await post('/products', { sku, name, barcode: '' });
    const lot = await post('/lots', { productId: product.id, batch: `LOT-${1024 - i}`, supplier });
    lots.push(lot.id);
    await post('/movements', move(lot.id, 'receive', kg, 'raw'));
    if (quality !== 'uninspected') await post('/quality', { lotId: lot.id, status: quality, note: quality === 'hold' ? 'Shade differs from the approved sample' : 'Opening inventory checked' });
  }
  await post('/movements', move(lots[1], 'transfer', 2100, 'raw', 'wip'));
  await post('/movements', move(lots[0], 'transfer', 1500, 'raw', 'finished'));
}
