import { localInventoryRequest } from './local-inventory';
export type StockStage = 'raw' | 'wip' | 'finished' | 'cops';
export type Quality = 'uninspected' | 'approved' | 'hold';
export interface Product { id: string; sku: string; name: string; barcode: string | null }
export interface StockLot { id: string; product_id: string; batch: string; supplier: string; quality: Quality; created_at: number }
export interface StockBalance { lot_id: string; stage: StockStage; grams: number; cartons: number; cones: number }
export interface StockMovement {
  id: string; lot_id: string; action: string; from_stage: StockStage | null;
  to_stage: StockStage | null; grams: number; cartons: number; cones: number;
  note: string; actor_name: string; created_at: number; reverses: string | null;
}
export interface Inspection {
  id: string; lot_id: string; label_text: string; note: string; source: string;
  result_json: string | null; actor_name: string; created_at: number;
}
export interface WorkspaceState {
  workspace: { id: string; name: string };
  member: { user_id: string; name: string; role: 'owner' | 'operator' };
  products: Product[]; lots: StockLot[]; balances: StockBalance[]; movements: StockMovement[];
  members: { name: string; role: string; joined_at: number }[];
  inspections: Inspection[];
  photos: { id: string; lot_id: string; content_type: string; size: number; actor_name: string; created_at: number }[];
  qualityEvents: { id: string; lot_id: string; status: Quality; note: string; actor_name: string; created_at: number }[];
  serverTime: number; backend: string;
}
export interface Unjoined { member: null; user: string }
export class InventoryError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}
export async function inventoryRequest<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new InventoryError('Request cancelled.');
  return localInventoryRequest<T>(path, data);
}
export const stockStages: StockStage[] = ['raw', 'wip', 'finished', 'cops'];
export const stageName: Record<StockStage, string> = { raw: 'Raw material', wip: 'Work in progress', finished: 'Finished stock', cops: 'Cops' };
export const qualityName: Record<Quality, string> = { uninspected: 'Needs inspection', approved: 'QC approved', hold: 'QC hold' };
export const weight = (grams: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(grams / 1000);
export const timestamp = (value: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' }).format(value);
export function gramsFromKg(value: string) {
  if (!/^\d+(\.\d{1,3})?$/.test(value.trim())) throw new Error('Enter kilograms with up to three decimal places.');
  const [whole, part = ''] = value.trim().split('.');
  const grams = Number(whole) * 1000 + Number(part.padEnd(3, '0'));
  if (!Number.isSafeInteger(grams) || grams <= 0 || grams > 9e12) throw new Error('Enter a positive weight of up to 9,000,000,000 kg.');
  return grams;
}
