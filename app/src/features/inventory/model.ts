export type Material = {
  id: string;
  name: string;
  category: string;
  colour: string;
  swatch: 'denim' | 'cotton' | 'polyester' | 'jersey' | 'linen' | 'rose' | 'charcoal' | 'satin';
  sku: string;
  lot: string;
  metres: number;
  reserved: number;
  rolls: number;
  reorderAt: number;
  warehouse: string;
  location: string;
  supplier: string;
  composition: string;
  gsm: number;
  width: number;
  held: boolean;
};
export type MovementKind = 'received' | 'issued';
export type Movement = {
  id: string;
  kind: MovementKind;
  materialId: string;
  name: string;
  metres: number;
  rolls: number;
  reference: string;
  note: string;
  at: string;
  sample: boolean;
};
export type StockStatus = 'all' | 'low' | 'held';
export type MovementInput = {
  kind: MovementKind;
  materialId: string;
  metres: number;
  rolls: number;
  reference: string;
  note: string;
};
export const categories = ['All', 'Woven', 'Knitted', 'Specialty'];
export const warehouses = ['All stores', 'Main store', 'Finishing store'];
export const materials: Material[] = [
  {
    id: 'denim-indigo',
    name: 'Indigo denim',
    category: 'Woven',
    colour: 'Deep indigo',
    swatch: 'denim',
    sku: 'FAB-001',
    lot: 'IND-2408',
    metres: 6420,
    reserved: 1600,
    rolls: 68,
    reorderAt: 2000,
    warehouse: 'Main store',
    location: 'Aisle A · Rack 04',
    supplier: 'Crescent Textiles',
    composition: '98% cotton · 2% elastane',
    gsm: 320,
    width: 150,
    held: false,
  },
  {
    id: 'cotton-poplin',
    name: 'Cotton poplin',
    category: 'Woven',
    colour: 'Warm ivory',
    swatch: 'cotton',
    sku: 'FAB-002',
    lot: 'CTN-1826',
    metres: 4800,
    reserved: 1200,
    rolls: 52,
    reorderAt: 2000,
    warehouse: 'Main store',
    location: 'Aisle A · Rack 08',
    supplier: 'Al-Karam Mills',
    composition: '100% cotton',
    gsm: 130,
    width: 145,
    held: false,
  },
  {
    id: 'polyester-twill',
    name: 'Polyester twill',
    category: 'Woven',
    colour: 'Storm grey',
    swatch: 'polyester',
    sku: 'FAB-003',
    lot: 'PLY-0932',
    metres: 3560,
    reserved: 800,
    rolls: 38,
    reorderAt: 1500,
    warehouse: 'Finishing store',
    location: 'Aisle C · Rack 02',
    supplier: 'Nishat Textiles',
    composition: '100% polyester',
    gsm: 180,
    width: 150,
    held: false,
  },
  {
    id: 'cotton-jersey',
    name: 'Cotton jersey',
    category: 'Knitted',
    colour: 'Soft sage',
    swatch: 'jersey',
    sku: 'FAB-004',
    lot: 'JRS-0714',
    metres: 3100,
    reserved: 400,
    rolls: 32,
    reorderAt: 1500,
    warehouse: 'Main store',
    location: 'Inspection bay · Q02',
    supplier: 'Crescent Textiles',
    composition: '95% cotton · 5% elastane',
    gsm: 180,
    width: 160,
    held: true,
  },
  {
    id: 'linen-natural',
    name: 'Natural linen',
    category: 'Woven',
    colour: 'Sand',
    swatch: 'linen',
    sku: 'FAB-005',
    lot: 'LIN-0421',
    metres: 2080,
    reserved: 300,
    rolls: 24,
    reorderAt: 2500,
    warehouse: 'Main store',
    location: 'Aisle B · Rack 03',
    supplier: 'Artisan Weaves',
    composition: '100% linen',
    gsm: 165,
    width: 140,
    held: false,
  },
  {
    id: 'viscose-crepe',
    name: 'Viscose crêpe',
    category: 'Specialty',
    colour: 'Dusty rose',
    swatch: 'rose',
    sku: 'FAB-006',
    lot: 'VIS-0605',
    metres: 1800,
    reserved: 300,
    rolls: 20,
    reorderAt: 1000,
    warehouse: 'Finishing store',
    location: 'Aisle C · Rack 06',
    supplier: 'Al-Karam Mills',
    composition: '100% viscose',
    gsm: 140,
    width: 145,
    held: false,
  },
  {
    id: 'rib-knit',
    name: 'Rib knit',
    category: 'Knitted',
    colour: 'Charcoal',
    swatch: 'charcoal',
    sku: 'FAB-007',
    lot: 'RIB-0812',
    metres: 1420,
    reserved: 400,
    rolls: 18,
    reorderAt: 1800,
    warehouse: 'Main store',
    location: 'Aisle B · Rack 07',
    supplier: 'Nishat Textiles',
    composition: '96% cotton · 4% elastane',
    gsm: 240,
    width: 150,
    held: false,
  },
  {
    id: 'pearl-satin',
    name: 'Pearl satin',
    category: 'Specialty',
    colour: 'Pearl',
    swatch: 'satin',
    sku: 'FAB-008',
    lot: 'SAT-0328',
    metres: 1680,
    reserved: 200,
    rolls: 16,
    reorderAt: 2000,
    warehouse: 'Finishing store',
    location: 'Aisle D · Rack 01',
    supplier: 'Artisan Weaves',
    composition: '100% polyester',
    gsm: 110,
    width: 145,
    held: false,
  },
];
export const sampleMovements: Movement[] = [
  {
    id: 'sample-1',
    kind: 'received',
    materialId: 'denim-indigo',
    name: 'Indigo denim',
    metres: 840,
    rolls: 9,
    reference: 'GRN-1042',
    note: 'Delivery checked at the receiving bay.',
    at: '2026-10-21T09:40:00+05:00',
    sample: true,
  },
  {
    id: 'sample-2',
    kind: 'issued',
    materialId: 'cotton-poplin',
    name: 'Cotton poplin',
    metres: 320,
    rolls: 4,
    reference: 'CUT-0086',
    note: 'Issued to cutting line 02.',
    at: '2026-10-21T08:15:00+05:00',
    sample: true,
  },
  {
    id: 'sample-3',
    kind: 'received',
    materialId: 'viscose-crepe',
    name: 'Viscose crêpe',
    metres: 600,
    rolls: 6,
    reference: 'GRN-1041',
    note: 'Received in finishing store.',
    at: '2026-10-20T15:30:00+05:00',
    sample: true,
  },
  {
    id: 'sample-4',
    kind: 'issued',
    materialId: 'polyester-twill',
    name: 'Polyester twill',
    metres: 450,
    rolls: 5,
    reference: 'CUT-0085',
    note: 'Production order PR-026.',
    at: '2026-10-20T11:20:00+05:00',
    sample: true,
  },
];
export const purchaseOrders = [
  {
    id: 'PO-2026-048',
    materialId: 'linen-natural',
    name: 'Natural linen',
    supplier: 'Artisan Weaves',
    metres: 3200,
    rolls: 32,
    date: '24 Oct',
    status: 'In transit',
  },
  {
    id: 'PO-2026-049',
    materialId: 'rib-knit',
    name: 'Rib knit',
    supplier: 'Nishat Textiles',
    metres: 2400,
    rolls: 26,
    date: '26 Oct',
    status: 'Confirmed',
  },
  {
    id: 'PO-2026-050',
    materialId: 'pearl-satin',
    name: 'Pearl satin',
    supplier: 'Artisan Weaves',
    metres: 1800,
    rolls: 18,
    date: '28 Oct',
    status: 'Confirmed',
  },
];
export const number = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
export const availableMetres = (item: Material) =>
  item.held ? 0 : Math.max(0, item.metres - item.reserved);
export const isLow = (item: Material) => !item.held && item.metres <= item.reorderAt;
export function inventorySummary(items: Material[]) {
  return {
    metres: items.reduce((n, item) => n + item.metres, 0),
    available: items.reduce((n, item) => n + availableMetres(item), 0),
    rolls: items.reduce((n, item) => n + item.rolls, 0),
    reserved: items.reduce((n, item) => n + item.reserved, 0),
    low: items.filter(isLow).length,
    held: items.filter((item) => item.held).length,
  };
}
export function filterMaterials(
  items: Material[],
  filters: { query: string; status: StockStatus; category: string; warehouse: string },
) {
  const q = filters.query.trim().toLowerCase();
  return items.filter(
    (item) =>
      (filters.warehouse === 'All stores' || item.warehouse === filters.warehouse) &&
      (filters.category === 'All' || item.category === filters.category) &&
      (filters.status === 'all' || (filters.status === 'low' ? isLow(item) : item.held)) &&
      `${item.name} ${item.colour} ${item.sku} ${item.lot} ${item.supplier}`
        .toLowerCase()
        .includes(q),
  );
}
export function movementError(items: Material[], input: MovementInput): string | null {
  const item = items.find((material) => material.id === input.materialId);
  if (!item) return 'Choose a material to continue.';
  if (!Number.isFinite(input.metres) || input.metres <= 0)
    return 'Enter a quantity greater than 0 metres.';
  if (Math.abs(input.metres * 10 - Math.round(input.metres * 10)) > 0.00001)
    return 'Use at most one decimal place for metres, for example 125.5.';
  if (!Number.isSafeInteger(input.rolls) || input.rolls < 1)
    return 'Enter a whole number of rolls, at least 1.';
  if (!input.reference.trim()) return 'Add a delivery or production reference.';
  if (input.kind === 'issued' && item.held)
    return 'This lot is on quality hold and cannot be issued.';
  if (input.kind === 'issued' && input.metres > availableMetres(item))
    return `Only ${number(availableMetres(item))} m is available. Reserved stock cannot be issued here.`;
  if (input.kind === 'issued' && input.rolls > item.rolls)
    return `Only ${item.rolls} rolls are on hand.`;
  if (input.kind === 'issued' && (input.metres === item.metres) !== (input.rolls === item.rolls))
    return 'Issuing all remaining stock must include all remaining rolls.';
  return null;
}
