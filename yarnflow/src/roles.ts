import { Bell, ChartColumn, ChartNoAxesCombined, CircleHelp, ClipboardCheck, ClipboardList, CircleUserRound, FileText, House, History, ListChecks, PackagePlus, ScanSearch, Settings, ShieldCheck, Truck, UsersRound, type LucideIcon } from 'lucide-react';
import { ConeIcon } from './icons';
import { roleLabel, type Role } from './inventory-client';
import { objectRoute as route } from './routes.ts';
export { eventTitle, parseHash } from './routes.ts';

export interface Section { id: string; en: string; ur: string; icon: LucideIcon; tabs?: { id: string; en: string; ur: string }[] }

const dashboard: Section = { id: 'dashboard', en: 'Dashboard', ur: 'ڈیش بورڈ', icon: House };
const stock: Section = { id: 'inventory', en: 'Stock', ur: 'اسٹاک', icon: ConeIcon as LucideIcon };
const history: Section = { id: 'activity', en: 'History', ur: 'ہسٹری', icon: History };
const lots: Section = { id: 'lots', en: 'Lots', ur: 'لاٹس', icon: ClipboardCheck };
const reviews: Section = { id: 'reviews', en: 'Reviews', ur: 'جائزے', icon: ClipboardCheck, tabs: [
  { id: 'reports', en: 'Reports', ur: 'رپورٹس' }, { id: 'rejections', en: 'Issues', ur: 'مسائل' },
] };
const submissions: Section = { id: 'submissions', en: 'My submissions', ur: 'میری جمع کرائی گئی رپورٹس', icon: History, tabs: [{ id: 'mine', en: 'All', ur: 'تمام' }, { id: 'returned', en: 'Returned', ur: 'واپس شدہ' }] };
const buyers: Section = { id: 'buyers', en: 'Buyers', ur: 'خریدار', icon: UsersRound, tabs: [{ id: 'pending', en: 'Pending', ur: 'زیرِ التوا' }, { id: 'active', en: 'Active', ur: 'فعال' }, { id: 'all', en: 'All', ur: 'سب' }] };
const buyerRfqs: Section = { id: 'buyer-rfqs', en: 'Buyer RFQs', ur: 'خریدار کی درخواستیں', icon: FileText, tabs: [{ id: 'open', en: 'To quote', ur: 'قیمت دینے کے لیے' }, { id: 'quoted', en: 'Quoted', ur: 'قیمت دی گئی' }, { id: 'sold', en: 'Sold', ur: 'فروخت شدہ' }, { id: 'all', en: 'All', ur: 'سب' }] };
const invoices: Section = { id: 'invoices', en: 'Invoices', ur: 'انوائسز', icon: FileText, tabs: [{ id: 'owed', en: 'To collect', ur: 'وصولی کے لیے' }, { id: 'paid', en: 'Paid', ur: 'ادا شدہ' }, { id: 'all', en: 'All', ur: 'سب' }] };
const dispatchRequests: Section = { id: 'dispatch-requests', en: 'Dispatch requests', ur: 'ڈسپیچ درخواستیں', icon: Truck, tabs: [{ id: 'pending_approval', en: 'Needs approval', ur: 'منظوری درکار' }, { id: 'all', en: 'All', ur: 'سب' }] };
const analytics: Section = { id: 'analytics', en: 'Analytics', ur: 'تجزیہ', icon: ChartNoAxesCombined };
const dispatches: Section = { id: 'dispatches', en: 'Dispatches', ur: 'ڈسپیچز', icon: Truck, tabs: [{ id: 'all', en: 'All', ur: 'سب' }, { id: 'pending_approval', en: 'Needs approval', ur: 'منظوری درکار' }, { id: 'approved', en: 'Approved', ur: 'منظور شدہ' }, { id: 'on_hold', en: 'On hold', ur: 'روکی گئی' }, { id: 'dispatched', en: 'Dispatched', ur: 'روانہ' }, { id: 'delivered', en: 'Delivered', ur: 'پہنچائی گئی' }] };
const newDispatch: Section = { id: 'new-dispatch', en: 'New dispatch', ur: 'نئی ڈسپیچ', icon: PackagePlus };
const dispatchHistory: Section = { id: 'history', en: 'History', ur: 'ہسٹری', icon: History };
// The purchase manager's section and tab ids are also the admin's module routes (moduleOf in routes.ts).
const suppliers: Section = { id: 'suppliers', en: 'Suppliers', ur: 'سپلائرز', icon: UsersRound, tabs: [{ id: 'directory', en: 'All suppliers', ur: 'تمام سپلائرز' }, { id: 'pending', en: 'Pending', ur: 'زیرِ التوا' }] };
const rfqs: Section = { id: 'rfqs', en: 'RFQs', ur: 'درخواستیں', icon: PackagePlus, tabs: [{ id: 'requests', en: 'Requests', ur: 'درخواستیں' }, { id: 'awards', en: 'Awards', ur: 'منظوریاں' }] };
const orders: Section = { id: 'orders', en: 'Orders', ur: 'آرڈر', icon: Truck, tabs: [{ id: 'orders', en: 'Orders', ur: 'آرڈر' }, { id: 'tracking', en: 'Tracking', ur: 'ٹریکنگ' }, { id: 'incoming', en: 'Arrivals', ur: 'آمد' }] };
const claims: Section = { id: 'claims', en: 'Claims', ur: 'دعوے', icon: ClipboardCheck };
const purchaseAnalytics: Section = { id: 'analytics', en: 'Analytics', ur: 'تجزیے', icon: ChartColumn };
const supervisorInventory: Section = { id: 'inventory', en: 'Inventory', ur: 'انوینٹری', icon: ConeIcon as LucideIcon };
const requests: Section = { id: 'requests', en: 'Requests', ur: 'درخواستیں', icon: ClipboardList, tabs: [
  { id: 'queries', en: 'Stock queries', ur: 'اسٹاک کی درخواستیں' }, { id: 'stock-issues', en: 'Stock issues', ur: 'اسٹاک کے مسائل' },
] };
const report: Section = { id: 'report', en: 'Report', ur: 'رپورٹ', icon: ClipboardCheck };
const activity: Section = { id: 'admin-activity', en: 'Activity', ur: 'سرگرمیاں', icon: History, tabs: [{ id: 'monitor', en: 'Monitor', ur: 'نگرانی' }, { id: 'audit', en: 'Audit log', ur: 'آڈٹ لاگ' }] };
export const accessSummary = (role: Role, language: 'en' | 'ur' = 'en') => {
  const [en, ur] = roleLabel[role]; return language === 'ur' ? ur : en;
};
export const accessEntries: [string,string,string][] = [
  ['receive','Receive deliveries','آمد درج کریں'],['produce','Move between stages','مراحل کے درمیان منتقل کریں'],['dispatch','Dispatch','ڈسپیچ'],['waste','Record waste','ضائع شدہ اسٹاک درج کریں'],['catalog','Materials and batches','مواد اور بیچ'],['inspect','Inspections','معائنہ'],['qc','QC decisions','کوالٹی فیصلے'],['reverse','Reverse entries','اندراج واپس کریں'],['suppliers','Supplier directory','سپلائر فہرست'],['procure','Procurement','خریداری'],['sales','Sales orders','فروخت کے آرڈر'],['payments','Customer payments','صارف کی ادائیگیاں'],
];
const approvals: Section = { id: 'approvals', en: 'Approvals', ur: 'منظوریاں', icon: ListChecks };
const adminClaims: Section = { id: 'claims', en: 'Claims', ur: 'دعوے', icon: ShieldCheck };
const reports: Section = { id: 'reports', en: 'Reports', ur: 'رپورٹس', icon: FileText };
const adminAnalytics: Section = { id: 'analytics', en: 'Analytics', ur: 'تجزیات', icon: ChartNoAxesCombined };
const settings: Section = { id: 'settings', en: 'Settings', ur: 'ترتیبات', icon: Settings, tabs: [{ id: 'thresholds', en: 'Thresholds', ur: 'حدود' }, { id: 'invoices', en: 'Invoices', ur: 'انوائس' }, { id: 'users', en: 'Users', ur: 'صارفین' }] };
const modules: Section = { id: 'modules', en: 'Modules', ur: 'ماڈیولز', icon: PackagePlus, tabs: ['purchase_manager', 'quality_inspector', 'supervisor', 'sales_manager', 'dispatch'].map(id => ({ id, en: roleLabel[id as Role][0], ur: roleLabel[id as Role][1] })) };

export const NAV: Record<Role, Section[]> = {
  admin: [dashboard, approvals, adminClaims, activity, reports, adminAnalytics, settings, modules],
  purchase_manager: [dashboard, suppliers, rfqs, orders, claims, purchaseAnalytics],
  sales_manager: [dashboard, buyers, buyerRfqs, invoices, dispatchRequests, analytics],
  dispatch: [dashboard, dispatches, newDispatch, dispatchHistory],
  quality_inspector: [dashboard, lots, submissions],
  supervisor: [dashboard, reviews, supervisorInventory, requests, report, history],
};
export const COMMON: Section[] = [
  { id: 'notifications', en: 'Notifications', ur: 'اطلاعات', icon: Bell },
  { id: 'profile', en: 'My profile', ur: 'میری پروفائل', icon: CircleUserRound },
  { id: 'scanner', en: 'Scan', ur: 'اسکین', icon: ScanSearch },
  { id: 'help', en: 'Help', ur: 'مدد', icon: CircleHelp },
];

/** Role modules an admin can open; owner screens handle notification deep links. */
export const INSTALLED_MODULES: Role[] = ['purchase_manager', 'sales_manager', 'dispatch', 'quality_inspector', 'supervisor'];

export const objectRoute = (objectType: string, objectId: string, context: { role: Role; module?: Role; installedModules: Role[] }) => route(objectType, objectId, context, NAV);
