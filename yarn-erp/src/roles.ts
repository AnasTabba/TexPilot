import { Bell, ChartColumn, ChartNoAxesCombined, CircleHelp, ClipboardCheck, CircleUserRound, FileText, House, History, PackagePlus, ScanSearch, Truck, UsersRound, type LucideIcon } from 'lucide-react';
import { ConeIcon } from './icons';
import type { Role } from './inventory-client';
import { objectRoute as route } from './routes.ts';
export { eventTitle, parseHash } from './routes.ts';

export interface Section { id: string; en: string; ur: string; icon: LucideIcon; tabs?: { id: string; en: string; ur: string }[] }

const dashboard: Section = { id: 'dashboard', en: 'Dashboard', ur: 'ڈیش بورڈ', icon: House };
const stock: Section = { id: 'inventory', en: 'Stock', ur: 'اسٹاک', icon: ConeIcon as LucideIcon };
const history: Section = { id: 'activity', en: 'History', ur: 'ہسٹری', icon: History };
const lots: Section = { id: 'lots', en: 'Inspections', ur: 'معائنے', icon: ClipboardCheck };
const reviews: Section = { id: 'reviews', en: 'Review', ur: 'جائزہ', icon: ClipboardCheck };
const team: Section = { id: 'team', en: 'Team', ur: 'ٹیم', icon: UsersRound };
const buyers: Section = { id: 'buyers', en: 'Buyers', ur: 'خریدار', icon: UsersRound, tabs: [{ id: 'pending', en: 'Pending', ur: 'زیرِ التوا' }, { id: 'active', en: 'Active', ur: 'فعال' }, { id: 'all', en: 'All', ur: 'سب' }] };
const buyerRfqs: Section = { id: 'buyer-rfqs', en: 'Buyer RFQs', ur: 'خریدار کی درخواستیں', icon: FileText, tabs: [{ id: 'open', en: 'To quote', ur: 'قیمت دینے کے لیے' }, { id: 'quoted', en: 'Quoted', ur: 'قیمت دی گئی' }, { id: 'sold', en: 'Sold', ur: 'فروخت شدہ' }, { id: 'all', en: 'All', ur: 'سب' }] };
const invoices: Section = { id: 'invoices', en: 'Invoices', ur: 'انوائسز', icon: FileText, tabs: [{ id: 'owed', en: 'To collect', ur: 'وصولی کے لیے' }, { id: 'paid', en: 'Paid', ur: 'ادا شدہ' }, { id: 'all', en: 'All', ur: 'سب' }] };
const dispatchRequests: Section = { id: 'dispatch-requests', en: 'Dispatch requests', ur: 'ڈسپیچ درخواستیں', icon: Truck, tabs: [{ id: 'pending_approval', en: 'Needs approval', ur: 'منظوری درکار' }, { id: 'all', en: 'All', ur: 'سب' }] };
const analytics: Section = { id: 'analytics', en: 'Analytics', ur: 'تجزیہ', icon: ChartNoAxesCombined };
const dispatchStock: Section = { id: 'dispatch', en: 'Dispatch', ur: 'ڈسپیچ', icon: Truck };
const dispatches: Section = { id: 'dispatches', en: 'Dispatches', ur: 'ڈسپیچز', icon: Truck, tabs: [{ id: 'all', en: 'All', ur: 'سب' }, { id: 'pending_approval', en: 'Needs approval', ur: 'منظوری درکار' }, { id: 'approved', en: 'Approved', ur: 'منظور شدہ' }, { id: 'on_hold', en: 'On hold', ur: 'روکی گئی' }, { id: 'dispatched', en: 'Dispatched', ur: 'روانہ' }, { id: 'delivered', en: 'Delivered', ur: 'پہنچائی گئی' }] };
const newDispatch: Section = { id: 'new-dispatch', en: 'New dispatch', ur: 'نئی ڈسپیچ', icon: PackagePlus };
const dispatchHistory: Section = { id: 'history', en: 'History', ur: 'ہسٹری', icon: History };
// The purchase manager's section and tab ids are also the admin's module routes (moduleOf in routes.ts).
const suppliers: Section = { id: 'suppliers', en: 'Suppliers', ur: 'سپلائرز', icon: UsersRound, tabs: [{ id: 'directory', en: 'All suppliers', ur: 'تمام سپلائرز' }, { id: 'pending', en: 'Pending', ur: 'زیرِ التوا' }] };
const rfqs: Section = { id: 'rfqs', en: 'RFQs', ur: 'درخواستیں', icon: PackagePlus, tabs: [{ id: 'requests', en: 'Requests', ur: 'درخواستیں' }, { id: 'awards', en: 'Awards', ur: 'منظوریاں' }] };
const orders: Section = { id: 'orders', en: 'Orders', ur: 'آرڈر', icon: Truck, tabs: [{ id: 'orders', en: 'Orders', ur: 'آرڈر' }, { id: 'tracking', en: 'Tracking', ur: 'ٹریکنگ' }, { id: 'incoming', en: 'Arrivals', ur: 'آمد' }] };
const claims: Section = { id: 'claims', en: 'Claims', ur: 'دعوے', icon: ClipboardCheck };
const purchaseAnalytics: Section = { id: 'analytics', en: 'Analytics', ur: 'تجزیے', icon: ChartColumn };

export const NAV: Record<Role, Section[]> = {
  admin: [dashboard, stock, history, team],
  purchase_manager: [dashboard, suppliers, rfqs, orders, claims, purchaseAnalytics],
  sales_manager: [dashboard, buyers, buyerRfqs, invoices, dispatchRequests, analytics],
  dispatch: [dashboard, dispatches, newDispatch, dispatchHistory],
  quality_inspector: [dashboard, lots, stock, history],
  supervisor: [dashboard, reviews, stock, history, dispatchStock],
};
export const COMMON: Section[] = [
  { id: 'notifications', en: 'Notifications', ur: 'اطلاعات', icon: Bell },
  { id: 'profile', en: 'My profile', ur: 'میری پروفائل', icon: CircleUserRound },
  { id: 'scanner', en: 'Scan', ur: 'اسکین', icon: ScanSearch },
  { id: 'help', en: 'Help', ur: 'مدد', icon: CircleHelp },
];

/** Role modules an admin can open; owner screens handle notification deep links. */
export const INSTALLED_MODULES: Role[] = ['purchase_manager', 'sales_manager', 'dispatch'];

export const objectRoute = (objectType: string, objectId: string, context: { role: Role; module?: Role; installedModules: Role[] }) => route(objectType, objectId, context, NAV);
