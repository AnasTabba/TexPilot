export interface SupplierCategory { id: string; name: string; urdu_name: string }
export type SupplierStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export interface SupplierRating { average: number; delivery: number; quality: number; terms: number; count: number }
export interface Supplier {
 id: string; name: string; contact_name: string; email: string; phone: string; city: string; website: string;
 source_url: string; source_checked_at: number | null; status: SupplierStatus; version: number; categories: string[]; rating: SupplierRating | null;
}
export interface ProcurementRfq {
 id: string; reference: string; title: string; category_id: string; specifications: string;
 quantity_milli: number; unit: 'kg' | 'tonne'; delivery_location: string; deadline_at: number;
 requested_delivery_at: number; status: 'draft' | 'open' | 'awarded' | 'closed' | 'cancelled'; recipient_count?: number; bid_count?: number;
}
export interface SupplierBid {
 id: string; rfq_id: string; supplier_id: string; supplier_name?: string; quantity_milli: number;
 price_minor: number; currency: string; payment_terms: string; delivery_at: number; valid_until: number;
 note: string; version: number; status: 'submitted' | 'rejected'; rejection_reason?: string;
}
export interface PurchaseOrder {
 id: string; rfq_id: string; bid_id: string; supplier_id: string; supplier_name?: string; reference: string;
 status: string; quantity_milli: number; total_minor: number; approval_status: 'approved' | 'pending_admin'; version: number; terms: SupplierBid & { title: string; specifications: string; unit: string; accepted_bid_version: number };
}
export interface ProcurementShipment {
 id: string; purchase_order_id: string; bill_of_lading: string; carrier: string; containers_json: string;
 quantity_milli: number; dispatched_at: number; note: string; tracking_status: string;
}
export interface ProcurementState {
 rfqs: ProcurementRfq[]; bids: SupplierBid[]; orders: PurchaseOrder[]; shipments: ProcurementShipment[]; currency?: string;
 tracking?: { configured: boolean; provider: string; reason: string };
}
export interface SupplierIdentity { user: { id: string; name: string; email: string }; supplier: Supplier }
export const quantity = (milli: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(milli / 1000);
export const rate = (minor: number, currency: string) => new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100);
export const factoryTime = (time: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' }).format(time);
export function fixedInput(value: string, precision: number, name: string) {
 if (!new RegExp(`^\\d+(?:\\.\\d{1,${precision}})?$`).test(value.trim())) throw new Error(`${name}: use a positive number with up to ${precision} decimal places.`);
 const [whole, part = ''] = value.trim().split('.'); const result = Number(whole) * 10 ** precision + Number(part.padEnd(precision, '0'));
 if (!Number.isSafeInteger(result) || result <= 0 || result > 1e9) throw new Error(`${name} is outside the supported range.`);
 return result;
}
export function factoryInput(value: string) {
 const result = Date.parse(value + '+05:00');
 if (!Number.isFinite(result)) throw new Error('Choose a valid factory date and time.');
 return result;
}
export function localFactoryInput(time: number) {
 // HTML datetime-local is deliberately labelled as factory time, independent of the device timezone.
 return new Date(time + 5 * 3600_000).toISOString().slice(0, 16);
}

export interface PendingPurchasing { awards: { approvalId: string; rfqId: string; bidId: string; bidVersion: number; amount: number }[]; changes: { approvalId: string; orderId: string; quantityMilli: number }[] }
