import { Truck } from 'lucide-react';
import { useLanguage } from './i18n';
import { factoryTime, quantity, rate, type ProcurementState, type PurchaseOrder } from './erp-client';
import './purchase-orders.css';

// The server row carries the order's bill of lading; the shared client type does not declare it yet.
export type OrderRecord = PurchaseOrder & { bill_of_lading?: string };
export const ORDER_LABEL: Record<string, [string, string]> = {
 accepted: ['Accepted', 'قبول شدہ'], dispatched: ['Dispatched', 'روانہ'], received: ['Received', 'موصول'], closed: ['Closed', 'بند'], cancelled: ['Cancelled', 'منسوخ'],
};

// The container list is stored as JSON text; a bad value must not break the screen.
export function containersOf(json: string): string[] {
 try { const value = JSON.parse(json); return Array.isArray(value) ? value.map(String) : []; } catch { return []; }
}

/** Facts of one purchase order and its shipments, shown in the procurement detail sheet. */
export function OrderFacts({ order, shipments }: { order: OrderRecord; shipments: ProcurementState['shipments'] }) {
 const { t } = useLanguage(); const ships = shipments.filter(s => s.purchase_order_id === order.id), label = ORDER_LABEL[order.status];
 return <>
  <dl className="erp-facts"><div><dt>{t('Supplier', 'سپلائر')}</dt><dd>{order.supplier_name ?? t('Unknown supplier', 'نامعلوم سپلائر')}</dd></div><div><dt>{t('Quantity', 'مقدار')}</dt><dd>{quantity(order.quantity_milli)} {order.terms.unit}</dd></div><div><dt>{t('Value', 'قیمت')}</dt><dd>{rate(order.total_minor, order.terms.currency)}</dd></div><div><dt>{t('Status', 'حیثیت')}</dt><dd>{label ? t(label[0], label[1]) : order.status}</dd></div></dl>
  <p className="po-specs">{order.terms.specifications}</p>
  <p className="po-mono">{order.bill_of_lading ? `${t('Bill of lading', 'بل آف لیڈنگ')}: ${order.bill_of_lading}` : t('Bill of lading not attached yet', 'بل آف لیڈنگ ابھی منسلک نہیں')}</p>
  <section className="po-block"><h4>{t('Shipments', 'ترسیلات')}</h4>{ships.length ? ships.map(s => <div className="po-ship" key={s.id}><strong className="po-mono"><Truck size={16} aria-hidden />{`${t('Bill of lading', 'بل آف لیڈنگ')}: ${s.bill_of_lading}`}</strong><span>{s.carrier}</span><span>{quantity(s.quantity_milli)} {order.terms.unit} · {factoryTime(s.dispatched_at)}</span><span className="po-muted">{t('Containers:', 'کنٹینر:')} {containersOf(s.containers_json).join(', ') || t('Not supplied', 'درج نہیں کیے گئے')}</span></div>) : <p className="po-muted">{t('No shipments yet', 'ابھی کوئی ترسیل نہیں')}</p>}</section>
 </>;
}
