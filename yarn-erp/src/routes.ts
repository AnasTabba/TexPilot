import type { Role } from './inventory-client';

export const eventTitle: Record<string, [string, string]> = {
  'supplier.pending': ['New supplier pending', 'نیا سپلائر منظوری کا منتظر ہے'],
  'buyer.pending': ['New buyer pending', 'نیا خریدار منظوری کا منتظر ہے'],
  'buyer_rfq.received': ['Buyer request received', 'خریدار کی درخواست موصول ہوئی'],
  'bid.received': ['Bid received', 'بولی موصول ہوئی'],
  'bidding.closed': ['Bidding closed', 'بولی کا وقت ختم ہو گیا'],
  'award.pending_approval': ['Award waiting for admin approval', 'ایوارڈ ایڈمن کی منظوری کا منتظر ہے'],
  'lot.ready': ['Lot ready for inspection', 'لاٹ معائنے کے لیے تیار ہے'],
  'inspection.submitted': ['Inspection submitted', 'معائنہ جمع ہو گیا'],
  'inspection.decided': ['Inspection decided', 'معائنے کا فیصلہ ہو گیا'],
  'approval.pending': ['Approval waiting', 'منظوری کی درخواست منتظر ہے'],
  'approval.decided': ['Approval decided', 'منظوری کا فیصلہ ہو گیا'],
  'claim.created': ['Claim raised', 'دعویٰ درج ہوا'],
  'claim.decided': ['Claim decided', 'دعوے کا فیصلہ ہو گیا'],
  'stock_query.created': ['Stock query raised', 'اسٹاک کی دریافت درج ہوئی'],
  'stock_issue.raised': ['Stock issue raised', 'اسٹاک کا مسئلہ درج ہوا'],
  'payment.due_soon': ['Payment due soon', 'ادائیگی کی تاریخ قریب ہے'],
  'payment.due_today': ['Payment due today', 'ادائیگی آج واجب ہے'],
  'payment.overdue': ['Payment overdue', 'ادائیگی کی مدت گزر چکی ہے'],
  'dispatch.approval_requested': ['Dispatch needs approval', 'ڈسپیچ کو منظوری درکار ہے'],
  'dispatch.approved': ['Dispatch approved', 'ڈسپیچ منظور ہو گیا'],
  'dispatch.held': ['Dispatch on hold', 'ڈسپیچ روک دیا گیا'],
  'dispatch.hold_notice': ['Dispatch hold notice', 'ڈسپیچ روکنے کا نوٹس'],
  'shipment.dispatched': ['Supplier dispatched shipment', 'سپلائر نے کھیپ روانہ کی'],
  'shipment.stage_changed': ['Shipment moved on its route', 'کھیپ اپنے راستے پر آگے بڑھی'],
  'po.created': ['Purchase order created', 'خریداری آرڈر بن گیا'],
  'stock.received': ['Finished stock received', 'تیار اسٹاک موصول ہوا'],
  'stock.adjusted': ['Stock adjusted', 'اسٹاک میں تبدیلی ہوئی'],
  'user.added': ['Team member added', 'ٹیم میں نیا رکن شامل ہوا'],
  'user.removed': ['Team member removed', 'ٹیم سے رکن ہٹایا گیا'],
  'supplier.rated': ['Supplier rated', 'سپلائر کی درجہ بندی ہوئی'],
  reminder: ['Reminder: still waiting', 'یاددہانی: اب بھی منتظر ہے'],
};

// Where each kind of object lives, per role: 'section[/tab]'; the object id follows. Order is priority for admin modules.
const destination: Record<string, Partial<Record<Role, string>>> = {
  supplier: { purchase_manager: 'suppliers' },
  rfq: { purchase_manager: 'rfqs' }, bid: { purchase_manager: 'rfqs' },
  purchase_order: { purchase_manager: 'orders' }, shipment: { purchase_manager: 'orders' },
  qc_lot: { quality_inspector: 'lots', supervisor: 'inventory' },
  qc_inspection: { supervisor: 'reviews/reports', quality_inspector: 'submissions' }, qc_rejection: { supervisor: 'reviews/rejections' },
  stock_query: { supervisor: 'requests/queries' }, stock_issue: { supervisor: 'requests/stock-issues' },
  inventory_adjustment: { supervisor: 'inventory' },
  buyer: { sales_manager: 'buyers' }, buyer_rfq: { sales_manager: 'buyer-rfqs' }, quotation: { sales_manager: 'buyer-rfqs' },
  invoice: { sales_manager: 'invoices' }, payment: { sales_manager: 'invoices' }, credit_note: { sales_manager: 'invoices' },
  dispatch: { dispatch: 'dispatches', sales_manager: 'dispatch-requests' },
  approval: { admin: 'approvals' }, claim: { admin: 'claims', purchase_manager: 'claims' },
  supervisor_report: { admin: 'reports' },
  user: { admin: 'settings/users' }, threshold: { admin: 'settings/thresholds' }, setting: { admin: 'settings/invoices' },
};
const moduleOf: Partial<Record<Role, string>> = { purchase_manager: 'purchase', quality_inspector: 'quality', supervisor: 'supervisor', sales_manager: 'sales', dispatch: 'dispatch' };
/** The hash that opens an object for this person, or their inbox when no accessible screen shows it yet. */
export function objectRoute(objectType: string, objectId: string, context: { role: Role; module?: Role; installedModules: Role[] }, nav: Record<Role, { id: string }[]>): string {
  const where = destination[objectType];
  const has = (role: Role, path: string) => nav[role].some(section => section.id === path.split('/')[0]);
  const id = encodeURIComponent(objectId);
  if (where) {
    const own = where[context.role];
    if (own && has(context.role, own)) return `#/${own}/${id}`;
    if (context.role === 'admin') {
      const owners = (context.module ? [context.module] : Object.keys(where) as Role[]).filter(role => role !== 'admin');
      for (const owner of owners) {
        const path = where[owner];
        if (path && moduleOf[owner] && context.installedModules.includes(owner) && has(owner, path)) return `#/modules/${moduleOf[owner]}/${path}/${id}`;
      }
    }
  }
  return '#/notifications';
}

/** `#/<section>/<tab>/<id>`: the tab is optional, so a second segment is a tab only when that section has such a tab. */
export function parseHash(hash: string, tabs: Record<string, string[]>) {
  const [, section = '', second = '', third = ''] = hash.split('/');
  if (!section) return { section: 'dashboard', tab: '', id: '' };
  return tabs[section]?.includes(second) ? { section, tab: second, id: third } : { section, tab: '', id: second };
}
