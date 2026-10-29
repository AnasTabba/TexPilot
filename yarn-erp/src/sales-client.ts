// Types and request helpers for the sales domain (/api/erp/sales/*) and the buyer portal
// (/api/buyer/*, its own cookie and identity). Mirrors server/sales.mjs and server/buyer-portal.mjs.
import { InventoryError, Member, Permission } from './inventory-client';
import { factoryTime } from './erp-client';

export type SalesUnit = 'kg' | 'metre' | 'piece';
export type BuyerStatus = 'pending' | 'active' | 'rejected' | 'suspended' | 'archived';
export interface Buyer {
  id: string; name: string; contact_name: string; email: string; phone: string; city: string; notes: string;
  assigned_manager_id: string | null; status: BuyerStatus; version: number; created_at: number; updated_at: number;
}
export interface BuyerPurchaseOrder {
  id: string; workspace_id: string; buyer_id: string; buyer_name?: string; reference: string; specifications: string;
  quantity_milli: number; unit: SalesUnit; requested_delivery_at: number; payment_terms: string;
  status: 'entered' | 'quoted' | 'confirmed' | 'cancelled'; source: 'staff' | 'buyer_portal'; created_at: number; updated_at: number;
}
export interface QuoteRevision {
  id: string; workspace_id: string; buyer_po_id: string; buyer_id: string; version: number;
  quantity_milli: number; unit: SalesUnit; price_minor: number; currency: string; specifications: string;
  requested_delivery_at: number; payment_terms: string; note: string; status: 'draft' | 'sent' | 'approved'; created_at: number; updated_at: number;
}
export interface SalesOrder {
  id: string; reference: string; buyer_id: string; buyer_name?: string; buyer_po_id: string; revision_id: string;
  status: 'confirmed' | 'partially_dispatched' | 'dispatched' | 'cancelled'; terms_snapshot: string; created_at: number;
}
export interface SalesOrderLine {
  id: string; workspace_id: string; sales_order_id: string; product_id: string | null;
  specifications: string; quantity_milli: number; unit: SalesUnit; created_at: number;
}
export interface Invoice {
  id: string; number: string; sales_order_id: string; revision_id: string; buyer_id: string; lines_json: string;
  total_minor: number; currency: string; issued_at: number; order_reference?: string;
}
export interface SalesDispatch {
  id: string; sales_order_id: string; order_reference?: string; movement_id: string; lot_id: string; from_stage: 'finished' | 'cops';
  quantity_milli: number; unit: SalesUnit; grams: number; cartons: number; cones: number; carrier: string;
  packages_json: string; documents_note: string; dispatched_at: number; created_at: number; movement_reversed?: number | null;
}
export interface SalesDelivery {
  id: string; dispatch_id: string; delivery_date: number; evidence_note: string; confirmed_by: string; created_at: number;
}
export interface DeliveryCorrection {
  id: string; delivery_id: string; previous_date: number; corrected_date: number; due_revision: number; reason: string; created_at: number;
}
export interface Receivable {
  id: string; invoice_id: string; invoice_number?: string; delivery_id: string; buyer_id: string;
  amount_minor: number; paid_minor: number; currency: string; due_at: number; due_revision: number;
  status: 'open' | 'settled'; created_at: number;
}
export interface SalesPayment {
  id: string; invoice_id: string; receivable_id: string; amount_minor: number; currency: string;
  note: string; actor_name: string; created_at: number;
}
export interface SalesReminder {
  id: string; receivable_id: string; kind: 'due_soon' | 'overdue'; due_revision: number;
  target_user_id: string; target_role: 'sales_manager' | 'admin'; created_at: number;
}
export interface SalesOutboxMessage {
  id: string; kind: 'quote_sent' | 'invoice_document'; buyer_id: string; invoice_id: string | null; revision_id: string | null;
  state: 'queued' | 'sent' | 'failed'; attempts: number; last_error: string | null; last_attempted_at: number | null;
  sent_at: number | null; created_at: number;
}
export interface FinishedStockOption {
  lot_id: string; batch: string; quality: string; product_id: string; product_name: string; sku: string;
  stage: 'finished' | 'cops'; grams: number; cartons: number; cones: number;
}
export interface Manager { id: string; name: string; role: string }
export interface SalesOverview {
  buyers: Buyer[]; pos: BuyerPurchaseOrder[]; revisions: QuoteRevision[]; orders: SalesOrder[]; lines: SalesOrderLine[];
  invoices: Invoice[]; dispatches: SalesDispatch[]; deliveries: SalesDelivery[]; corrections: DeliveryCorrection[];
  receivables: Receivable[]; payments: SalesPayment[]; reminders: SalesReminder[]; outbox: SalesOutboxMessage[];
  products: { id: string; sku: string; name: string }[]; finishedStock: FinishedStockOption[]; managers: Manager[];
  currency: string; serverTime: number; emailConfigured: boolean;
}
export interface BuyerIdentity { user: { id: string; name: string; email: string }; buyer: Buyer & { manager_name: string | null } }
export interface BuyerWorkspace {
  pos: BuyerPurchaseOrder[]; revisions: QuoteRevision[];
  orders: (Pick<SalesOrder, 'id' | 'reference' | 'buyer_po_id' | 'status' | 'created_at'> & { terms: {
    po_reference: string; revision: number; quantity_milli: number; unit: SalesUnit; specifications: string;
    price_minor: number; currency: string; requested_delivery_at: number; payment_terms: string; approved_at: number } })[];
  invoices: Invoice[]; dispatches: SalesDispatch[]; deliveries: SalesDelivery[]; corrections: DeliveryCorrection[];
  receivables: Receivable[]; payments: SalesPayment[]; serverTime: number;
}

const request = async <T>(base: string, path: string, data?: unknown): Promise<T> => {
  const response = await fetch(base + path, {
    method: data === undefined ? 'GET' : 'POST',
    ...(data === undefined ? {} : { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    credentials: 'same-origin', cache: 'no-store', redirect: 'error',
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new InventoryError(result?.error || 'The request was not saved. Refresh and try again.', response.status);
  if (result === null) throw new InventoryError('The server returned an unreadable response.');
  return result as T;
};
/** Staff sales API. Idempotent POSTs are safe to retry with the same values and request ID. */
export const salesRequest = <T>(path: string, data?: unknown) => request<T>('/api/erp/sales', path, data);
/** Buyer portal API; the server issues and clears its own `yf_buyer_session` cookie. */
export const buyerRequest = <T>(path: string, data?: unknown) => request<T>('/api/buyer', path, data);
export const canSell = (member: Member) => member.admin || member.permissions.includes('sales');
export const canBill = (member: Member) => member.admin || member.permissions.includes('payments');
export const canDispatchSales = (member: Member) => member.admin || member.permissions.includes('dispatch' as Permission);
export const factoryDate = (time: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium' }).format(time);
export const factoryDay = (time: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric' }).format(time);
export const dueLabel = (receivable: Receivable, serverTime: number) => `${factoryDay(receivable.due_at)} · ${receivable.due_at <= serverTime ? 'overdue' : `in ${Math.max(1, Math.ceil((receivable.due_at - serverTime) / 86400000))} days`}`;
export const orderStatusName: Record<SalesOrder['status'], string> = {
  confirmed: 'Confirmed', partially_dispatched: 'Partially dispatched', dispatched: 'Dispatched', cancelled: 'Cancelled',
};
export const buyerStatusName: Record<BuyerStatus, string> = {
  pending: 'Pending review', active: 'Active', rejected: 'Rejected', suspended: 'Suspended', archived: 'Archived',
};
export const outboxStateName: Record<SalesOutboxMessage['state'], string> = {
  queued: 'Queued, not yet sent', sent: 'Sent', failed: 'Failed',
};
export const outboxWhen = (message: SalesOutboxMessage) =>
  message.sent_at ? factoryTime(message.sent_at) : message.last_attempted_at ? factoryTime(message.last_attempted_at) : '—';
export const invoiceLines = (invoice: Invoice) => JSON.parse(invoice.lines_json) as {
  specifications: string; quantity_milli: number; unit: SalesUnit; price_minor: number; amount_minor: number;
}[];
/** A civil PKT calendar date (from <input type="date">) as a timestamp at noon of that Karachi day. */
export function factoryDateValue(value: string) {
  const result = Date.parse(value + 'T12:00:00+05:00');
  if (!Number.isFinite(result)) throw new Error('Choose a valid date.');
  return result;
}
/** Today's Karachi civil date for <input type="date">, independent of the device timezone. */
export const localFactoryDateValue = (time: number) => new Date(time + 5 * 3600_000).toISOString().slice(0, 10);
