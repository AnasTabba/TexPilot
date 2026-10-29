import { Bell, ChartNoAxesCombined, CircleHelp, ClipboardCheck, ClipboardList, CircleUserRound, FileText, House, History, ListChecks, PackagePlus, ScanSearch, Settings, ShieldCheck, Truck, UsersRound, type LucideIcon } from 'lucide-react';
import { ConeIcon } from './icons';
import type { Role } from './inventory-client';
import { objectRoute as route } from './routes.ts';
export { eventTitle, parseHash } from './routes.ts';

export interface Section { id: string; en: string; ur: string; icon: LucideIcon; tabs?: { id: string; en: string; ur: string }[] }

const dashboard: Section = { id: 'dashboard', en: 'Dashboard', ur: 'ڈیش بورڈ', icon: House };
const scan: Section = { id: 'scanner', en: 'Scan', ur: 'اسکین', icon: ScanSearch };
const stock: Section = { id: 'inventory', en: 'Stock', ur: 'اسٹاک', icon: ConeIcon as LucideIcon };
const history: Section = { id: 'activity', en: 'History', ur: 'ہسٹری', icon: History };
const procurement: Section = { id: 'procurement', en: 'Procurement', ur: 'خریداری', icon: PackagePlus };
const lots: Section = { id: 'lots', en: 'Inspections', ur: 'معائنے', icon: ClipboardCheck };
const reviews: Section = { id: 'reviews', en: 'Review', ur: 'جائزہ', icon: ClipboardCheck };
const team: Section = { id: 'team', en: 'Team', ur: 'ٹیم', icon: UsersRound };

// Admin, sales, dispatch and supervisor sections are rendered by AdminScreens, SalesScreens, DispatchScreens and SupervisorScreens.
const approvals: Section = { id: 'approvals', en: 'Approvals', ur: 'منظوریاں', icon: ListChecks };
const claims: Section = { id: 'claims', en: 'Claims', ur: 'دعوے', icon: ShieldCheck };
const adminActivity: Section = { id: 'admin-activity', en: 'Activity', ur: 'سرگرمیاں', icon: History, tabs: [{ id: 'monitor', en: 'Monitor', ur: 'نگرانی' }, { id: 'audit', en: 'Audit log', ur: 'آڈٹ لاگ' }] };
const reports: Section = { id: 'reports', en: 'Reports', ur: 'رپورٹس', icon: FileText };
const analytics: Section = { id: 'analytics', en: 'Analytics', ur: 'تجزیات', icon: ChartNoAxesCombined };
const buyers: Section = { id: 'buyers', en: 'Sales portal', ur: 'سیلز پورٹل', icon: UsersRound, tabs: [{ id: 'pending', en: 'To approve', ur: 'منظوری کے لیے' }, { id: 'active', en: 'Buyers', ur: 'خریدار' }, { id: 'all', en: 'All', ur: 'سب' }, { id: 'settings', en: 'Settings', ur: 'ترتیبات' }] };
const buyerRfqs: Section = { id: 'buyer-rfqs', en: 'Buyer RFQs', ur: 'خریدار کی درخواستیں', icon: FileText, tabs: [{ id: 'open', en: 'To quote', ur: 'قیمت دینے کے لیے' }, { id: 'quoted', en: 'Quoted', ur: 'قیمت دی گئی' }, { id: 'sold', en: 'Sold', ur: 'فروخت شدہ' }, { id: 'all', en: 'All', ur: 'سب' }] };
const invoices: Section = { id: 'invoices', en: 'Invoices', ur: 'انوائسز', icon: FileText, tabs: [{ id: 'owed', en: 'To collect', ur: 'وصولی کے لیے' }, { id: 'paid', en: 'Paid', ur: 'ادا شدہ' }, { id: 'all', en: 'All', ur: 'سب' }] };
const dispatchRequests: Section = { id: 'dispatch-requests', en: 'Dispatch requests', ur: 'ڈسپیچ درخواستیں', icon: Truck, tabs: [{ id: 'pending_approval', en: 'Needs approval', ur: 'منظوری درکار' }, { id: 'all', en: 'All', ur: 'سب' }] };
const dispatches: Section = { id: 'dispatches', en: 'Dispatches', ur: 'ڈسپیچز', icon: Truck, tabs: [{ id: 'all', en: 'All', ur: 'سب' }, { id: 'pending_approval', en: 'Needs approval', ur: 'منظوری درکار' }, { id: 'approved', en: 'Approved', ur: 'منظور شدہ' }, { id: 'on_hold', en: 'On hold', ur: 'روکی گئی' }, { id: 'dispatched', en: 'Dispatched', ur: 'روانہ' }, { id: 'delivered', en: 'Delivered', ur: 'پہنچائی گئی' }] };
const newDispatch: Section = { id: 'new-dispatch', en: 'New dispatch', ur: 'نئی ڈسپیچ', icon: PackagePlus };
const dispatchHistory: Section = { id: 'history', en: 'History', ur: 'ہسٹری', icon: History };
const requests: Section = { id: 'requests', en: 'Requests', ur: 'درخواستیں', icon: ClipboardList, tabs: [{ id: 'queries', en: 'Stock queries', ur: 'اسٹاک کی درخواستیں' }, { id: 'stock-issues', en: 'Stock issues', ur: 'اسٹاک کے مسائل' }] };
const report: Section = { id: 'report', en: 'Report', ur: 'رپورٹ', icon: FileText };

export const NAV: Record<Role, Section[]> = {
  admin: [dashboard, scan, approvals, claims, stock, procurement, buyers, adminActivity, reports, analytics, team],
  purchase_manager: [dashboard, scan, procurement],
  sales_manager: [dashboard, scan, buyers, buyerRfqs, invoices, dispatchRequests, analytics],
  dispatch: [dashboard, scan, dispatches, newDispatch, dispatchHistory],
  quality_inspector: [dashboard, scan, lots, stock, history],
  supervisor: [dashboard, scan, reviews, stock, requests, report, history],
};
export const COMMON: Section[] = [
  { id: 'notifications', en: 'Notifications', ur: 'اطلاعات', icon: Bell },
  { id: 'help', en: 'Help', ur: 'مدد', icon: CircleHelp },
];
/** Not in the sidebar: profile opens from your name, app settings from the top-right gear. */
export const PROFILE: Section = { id: 'profile', en: 'My profile', ur: 'میری پروفائل', icon: CircleUserRound };
export const APP_SETTINGS: Section = { id: 'app-settings', en: 'Settings', ur: 'ترتیبات', icon: Settings };

/** Role modules an admin can open; each owner task adds its role here when its screens exist. */
export const INSTALLED_MODULES: Role[] = [];

export const objectRoute = (objectType: string, objectId: string, context: { role: Role; module?: Role; installedModules: Role[] }) => route(objectType, objectId, context, NAV);
