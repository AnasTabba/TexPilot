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
// What an admin can let each person record. Admins can do all of it; scanning and viewing need none.
export type Permission = 'receive' | 'produce' | 'dispatch' | 'catalog' | 'inspect' | 'qc' | 'waste' | 'reverse';
export interface Member { user_id: string; name: string; role: 'owner' | 'operator'; admin: boolean; permissions: Permission[] }
export interface WorkspaceState {
  workspace: { id: string; name: string };
  member: Member;
  products: Product[]; lots: StockLot[]; balances: StockBalance[]; movements: StockMovement[];
  members: { name: string; role: string; joined_at: number }[];
  inspections: Inspection[];
  photos: { id: string; lot_id: string; content_type: string; size: number; actor_name: string; created_at: number }[];
  qualityEvents: { id: string; lot_id: string; status: Quality; note: string; actor_name: string; created_at: number }[];
  pending: number; serverTime: number; backend: string;
}
export class InventoryError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}
export async function inventoryRequest<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 20000);
  try {
    const response = await fetch('/api' + path, {
      method: data === undefined ? 'GET' : 'POST',
      ...(data === undefined ? {} : { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new InventoryError(result?.error || 'The request was not saved. Refresh and try again.', response.status);
    if (result === null) throw new InventoryError('The server returned an unreadable response.');
    return result as T;
  } catch (error) {
    if (error instanceof InventoryError) throw error;
    throw new InventoryError('Could not confirm a save. Check the connection and retry with the same values; duplicate requests are safe.');
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
  }
}
export const can = (member: Member, permission: Permission) => member.admin || member.permissions.includes(permission);
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
