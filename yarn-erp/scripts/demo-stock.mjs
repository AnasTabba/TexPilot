// The opening stock the demo starts with: four yarns with one batch each, entered through the API
// so the ledger, QC rules and audit trail apply exactly as for any entry. On a live site:
//   SEED_NAME=Anas SEED_PIN=<pin> node scripts/demo-stock.mjs https://<site>
// The dev server calls seedDemoStock directly for a new local or test database.
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2];
  if (!base || !process.env.SEED_NAME || !process.env.SEED_PIN) throw new Error('Usage: SEED_NAME=<admin> SEED_PIN=<pin> node scripts/demo-stock.mjs <site URL>');
  const origin = new URL(base).origin;
  const send = async (path, body, cookie) => {
    const response = await fetch(origin + '/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(`${path}: ${response.status} ${data.error}`);
    return { data, cookie: response.headers.get('Set-Cookie')?.split(';')[0] };
  };
  const { cookie } = await send('/auth/login', { name: process.env.SEED_NAME, pin: process.env.SEED_PIN });
  await seedDemoStock(async (path, body) => (await send(path, body, cookie)).data);
  console.log('Opening stock added.');
}
