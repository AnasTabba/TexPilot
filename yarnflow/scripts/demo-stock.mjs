// Test fixture only: four finished yarn lots, entered the way the supervisor enters them (/products and /erp/stock/finished, signed in as Saima).
// The dev server loads it into its in-memory test database (YARNFLOW_TEST_MODE=1). Never load it into a real database: the live site shows only real entries.
const yarns = [
  ['CTN-30', 'Combed cotton Ne 30/1', 'LOT-1024', 8250],
  ['PC-26', 'Poly cotton Ne 26/1', 'LOT-1023', 5950],
  ['PES-40', 'Polyester Ne 40/1', 'LOT-1022', 4100],
  ['VIS-30', 'Viscose Ne 30/1', 'LOT-1021', 3350],
];

/** post(path, body) sends one signed-in supervisor API request and resolves to its JSON. */
export async function seedDemoStock({ post }) {
  for (const [sku, name, batch, kg] of yarns) {
    const product = await post('/products', { sku, name, barcode: '' });
    await post('/erp/stock/finished', { id: crypto.randomUUID(), productId: product.id, batch, grams: kg * 1000, cartons: Math.round(kg / 250), cones: Math.round(kg / 25), note: 'Opening inventory' });
  }
}
