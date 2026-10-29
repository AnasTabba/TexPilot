// Test fixture only: four yarns with one batch each, as opening inventory. Products go through the API; batches, the opening ledger and QC state
// are written as rows because the batch and stage-transfer writes are closed to everyone (the supervisor adds finished goods, and raw stock
// arrives through a report decision, which would drag a supplier, RFQ and purchase order into every end-to-end test).
// The dev server loads it into its in-memory test database (YARNFLOW_TEST_MODE=1). Never load it into a real database: the live site shows only real entries.
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

/** post(path, body) sends one signed-in admin API request and resolves to its JSON; sql is the test database. */
export async function seedDemoStock({ post, sql }) {
  const workspaceId = sql.prepare('SELECT id FROM workspaces').get().id, admin = sql.prepare("SELECT id FROM users WHERE name='Anas'").get().id, lots = [], now = Date.now();
  for (const [i, [sku, name, supplier, kg, quality]] of yarns.entries()) {
    const product = await post('/products', { sku, name, barcode: '', interventionReason: 'Opening inventory for the test database' });
    const lot = { id: crypto.randomUUID() };
    sql.prepare('INSERT INTO lots(id,workspace_id,product_id,batch,supplier,created_at) VALUES(?,?,?,?,?,?)').run(lot.id, workspaceId, product.id, `LOT-${1024 - i}`, supplier, now);
    lots.push(lot.id);
    const receipt = move(lot.id, 'receive', kg, 'raw');
    sql.prepare("INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at) VALUES(?,?,?,'receive',NULL,'raw',?,?,?,?,?,'Anas',NULL,?,?)")
      .run(receipt.id, workspaceId, lot.id, receipt.grams, receipt.cartons, receipt.cones, receipt.note, admin, receipt.id, now);
    sql.prepare("INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,'raw',?,?,?)").run(crypto.randomUUID(), receipt.id, lot.id, receipt.grams, receipt.cartons, receipt.cones);
    if (quality !== 'uninspected') {
      sql.prepare('UPDATE lots SET quality=? WHERE id=?').run(quality, lot.id);
      sql.prepare('INSERT INTO quality_events(id,workspace_id,lot_id,status,note,actor,actor_name,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(crypto.randomUUID(), workspaceId, lot.id, quality, quality === 'hold' ? 'Shade differs from the approved sample' : 'Opening inventory checked', admin, 'Anas', now);
    }
  }
  // Legacy stage moves, written as the old transfers were so the stock page shows work in progress and finished stock.
  for (const [lotId, kg, toStage] of [[lots[1], 2100, 'wip'], [lots[0], 1500, 'finished']]) {
    const transfer = move(lotId, 'transfer', kg, 'raw', toStage);
    sql.prepare("INSERT INTO movements(id,workspace_id,lot_id,action,from_stage,to_stage,grams,cartons,cones,note,actor,actor_name,reverses,request_hash,created_at) VALUES(?,?,?,'transfer','raw',?,?,?,?,?,?,'Anas',NULL,?,?)")
      .run(transfer.id, workspaceId, lotId, toStage, transfer.grams, transfer.cartons, transfer.cones, transfer.note, admin, transfer.id, now);
    for (const [stage, sign] of [['raw', -1], [toStage, 1]]) sql.prepare('INSERT INTO stock_deltas(id,movement_id,lot_id,stage,grams,cartons,cones) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(), transfer.id, lotId, stage, sign * transfer.grams, sign * transfer.cartons, sign * transfer.cones);
  }
}
