import { Fragment, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Search, Truck } from 'lucide-react';
import { useLanguage } from './i18n';
import { factoryTime, quantity, rate, type ProcurementState, type PurchaseOrder } from './erp-client';
import './purchase-orders.css';

type SortKey = 'reference' | 'supplier' | 'value' | 'status';
type Sort = { key: SortKey; dir: 'asc' | 'desc' } | null;

const STATUS_ORDER = ['accepted', 'dispatched', 'received', 'closed', 'cancelled'];
const STATUS_LABEL: Record<string, [string, string]> = {
 accepted: ['Accepted', 'قبول شدہ'], dispatched: ['Dispatched', 'روانہ'], received: ['Received', 'موصول'], closed: ['Closed', 'بند'], cancelled: ['Cancelled', 'منسوخ'],
};
const TONE: Record<string, string> = { accepted: 'is-accepted', dispatched: 'is-dispatched', received: 'is-received', closed: 'is-received', cancelled: 'is-cancelled' };
const COLUMNS = 8;

// The container list is stored as JSON text; a bad value must not break the screen.
function containersOf(json: string): string[] {
 try { const value = JSON.parse(json); return Array.isArray(value) ? value.map(String) : []; } catch { return []; }
}

export function PurchaseOrders({ orders, shipments, renderActions, renderDetail }: { orders: PurchaseOrder[]; shipments: ProcurementState['shipments']; renderActions: (order: PurchaseOrder) => ReactNode; renderDetail?: (order: PurchaseOrder) => ReactNode }) {
 const { t } = useLanguage();
 const [filter, setFilter] = useState('all'), [search, setSearch] = useState(''), [sort, setSort] = useState<Sort>(null), [openId, setOpenId] = useState('');
 const statusName = (status: string) => { const label = STATUS_LABEL[status]; return label ? t(label[0], label[1]) : status; };
 const statuses = useMemo(() => [...new Set(orders.map(o => o.status))].sort((a, b) => (STATUS_ORDER.indexOf(a) + 1 || 99) - (STATUS_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b)), [orders]);
 const counts = useMemo(() => orders.reduce<Record<string, number>>((sum, o) => ({ ...sum, [o.status]: (sum[o.status] ?? 0) + 1 }), {}), [orders]);
 const rows = useMemo(() => {
  const q = search.trim().toLowerCase();
  const list = orders.filter(o => (filter === 'all' || o.status === filter) && (!q || [o.reference, o.supplier_name, o.terms.title].some(v => (v ?? '').toLowerCase().includes(q))));
  if (!sort) return list;
  const dir = sort.dir === 'asc' ? 1 : -1;
  const keyOf = (o: PurchaseOrder): string | number => sort.key === 'value' ? o.total_minor : sort.key === 'reference' ? o.reference : sort.key === 'supplier' ? o.supplier_name ?? '' : o.status;
  return [...list].sort((a, b) => { const x = keyOf(a), y = keyOf(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir; });
 }, [orders, filter, search, sort]);

 const sortBy = (key: SortKey) => setSort(s => s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
 const toggle = (id: string) => setOpenId(current => current === id ? '' : id);
 const onKey = (event: KeyboardEvent, id: string) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(id); } };
 const head = (key: SortKey, label: string, className = '') => {
  const active = sort?.key === key, asc = sort?.dir === 'asc';
  return <th scope="col" className={className} aria-sort={active ? (asc ? 'ascending' : 'descending') : undefined}>
   <button type="button" className="po-sort" onClick={() => sortBy(key)}>{label}{active ? (asc ? <ArrowUp size={14} aria-hidden /> : <ArrowDown size={14} aria-hidden />) : <ArrowUpDown size={14} aria-hidden className="po-sort-idle" />}</button>
  </th>;
 };

 if (!orders.length) return <section className="po-empty"><p>{t('No purchase orders yet. Accept a supplier bid to create one.', 'ابھی کوئی خریداری کا آرڈر نہیں۔')}</p></section>;

 return <div className="po">
  <div className="po-toolbar">
   <div className="po-chips" role="group" aria-label={t('Filter by status', 'حیثیت کے مطابق فلٹر')}>
    <button type="button" className="po-chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{t('All', 'سب')} <b>{orders.length}</b></button>
    {statuses.map(status => <button type="button" className="po-chip" key={status} aria-pressed={filter === status} onClick={() => setFilter(status)}>{statusName(status)} <b>{counts[status]}</b></button>)}
   </div>
   <label className="po-search"><Search size={16} aria-hidden /><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Reference, supplier, item', 'حوالہ، سپلائر، آئٹم')} aria-label={t('Search orders', 'آرڈر تلاش کریں')} /></label>
  </div>
  <div className="po-table-wrap">
   <table className="po-table" aria-label={t('Purchase orders', 'خریداری کے آرڈر')}>
    <thead><tr>
     {head('reference', t('PO', 'PO'))}{head('supplier', t('Supplier', 'سپلائر'))}<th scope="col">{t('Item', 'آئٹم')}</th><th scope="col" className="po-num">{t('Quantity', 'مقدار')}</th>{head('value', t('Value', 'قیمت'), 'po-num')}{head('status', t('Status', 'حیثیت'))}<th scope="col">{t('Shipments', 'ترسیلات')}</th><th scope="col"><span className="po-sr">{t('Details', 'تفصیل')}</span></th>
    </tr></thead>
    <tbody>
     {!rows.length && <tr className="po-empty-row"><td colSpan={COLUMNS}>{t('No orders match', 'کوئی آرڈر مطابقت نہیں رکھتا')}</td></tr>}
     {rows.map(o => {
      const isOpen = openId === o.id, ships = shipments.filter(s => s.purchase_order_id === o.id), detailId = `po-detail-${o.id}`;
      return <Fragment key={o.id}>
       <tr className={`po-row${isOpen ? ' is-open' : ''}`} tabIndex={0} aria-expanded={isOpen} aria-controls={detailId} onClick={() => toggle(o.id)} onKeyDown={e => onKey(e, o.id)}>
        <td className="po-ref"><span className="po-mono">{o.reference}</span></td>
        <td data-label={t('Supplier', 'سپلائر')}>{o.supplier_name ?? o.supplier_id}</td>
        <td className="po-item"><strong>{o.terms.title}</strong><span className="po-spec" title={o.terms.specifications}>{o.terms.specifications}</span></td>
        <td data-label={t('Quantity', 'مقدار')} className="po-num">{quantity(o.quantity_milli)} <span className="po-unit">{o.terms.unit}</span></td>
        <td data-label={t('Value', 'قیمت')} className="po-num">{rate(o.total_minor, o.terms.currency)}</td>
        <td data-label={t('Status', 'حیثیت')}><span className="po-tags"><span className={`po-pill ${TONE[o.status] ?? 'is-other'}`}>{statusName(o.status)}</span>{o.approval_status === 'pending_admin' && <span className="po-pill is-pending">{t('Qty change pending', 'مقدار کی تبدیلی زیرِ التوا')}</span>}</span></td>
        <td data-label={t('Shipments', 'ترسیلات')}>{ships.length ? <span className="po-ships" title={t('Shipments', 'ترسیلات')}><Truck size={16} aria-hidden /> {ships.length}</span> : <span className="po-muted">—</span>}</td>
        <td className="po-chev"><ChevronDown size={18} aria-hidden /></td>
       </tr>
       <tr id={detailId} className={`po-detail${isOpen ? ' is-open' : ''}`} inert={!isOpen}>
        <td colSpan={COLUMNS}><div className="po-expand"><div className="po-expand-body">
         <div className="po-detail-grid">
          <section className="po-block"><h4>{t('Specifications', 'تفصیلات')}</h4><p className="po-specs">{o.terms.specifications}</p></section>
          {renderDetail?.(o)}
          <section className="po-block"><h4>{t('Shipments', 'ترسیلات')}</h4>{ships.length ? ships.map(s => <div className="po-ship" key={s.id}><strong className="po-mono"><Truck size={16} aria-hidden />{s.bill_of_lading}</strong><span>{s.carrier}</span><span>{quantity(s.quantity_milli)} {o.terms.unit} · {factoryTime(s.dispatched_at)}</span><span className="po-muted">{t('Containers:', 'کنٹینر:')} {containersOf(s.containers_json).join(', ') || t('Not supplied', 'درج نہیں کیے گئے')}</span></div>) : <p className="po-muted">{t('No shipments yet', 'ابھی کوئی ترسیل نہیں')}</p>}</section>
         </div>
         <div className="po-actions">{renderActions(o)}</div>
        </div></div></td>
       </tr>
      </Fragment>;
     })}
    </tbody>
   </table>
  </div>
 </div>;
}
