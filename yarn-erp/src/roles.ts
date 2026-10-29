import { Bell, CircleHelp, ClipboardCheck, CircleUserRound, House, History, PackagePlus, ScanSearch, UsersRound, ListChecks, FileText, ChartNoAxesCombined, Settings, ShieldCheck, Cone, type LucideIcon } from 'lucide-react';
import { ConeIcon } from './icons';
import { roleLabel, type Role } from './inventory-client';
import { objectRoute as route } from './routes.ts';
export { eventTitle, parseHash } from './routes.ts';

export interface Section { id: string; en: string; ur: string; icon: LucideIcon; tabs?: { id: string; en: string; ur: string }[] }

const dashboard: Section = { id: 'dashboard', en: 'Dashboard', ur: 'ڈیش بورڈ', icon: House };
const stock: Section = { id: 'inventory', en: 'Stock', ur: 'اسٹاک', icon: ConeIcon as LucideIcon };
const history: Section = { id: 'activity', en: 'History', ur: 'ہسٹری', icon: History };
const activity: Section = { id: 'admin-activity', en: 'Activity', ur: 'سرگرمیاں', icon: History, tabs: [{ id: 'monitor', en: 'Monitor', ur: 'نگرانی' }, { id: 'audit', en: 'Audit log', ur: 'آڈٹ لاگ' }] };
const procurement: Section = { id: 'procurement', en: 'Procurement', ur: 'خریداری', icon: PackagePlus };
const lots: Section = { id: 'lots', en: 'Inspections', ur: 'معائنے', icon: ClipboardCheck };
const reviews: Section = { id: 'reviews', en: 'Review', ur: 'جائزہ', icon: ClipboardCheck };
export const accessSummary = (role: Role, language: 'en' | 'ur' = 'en') => {
  const [en, ur] = roleLabel[role]; return language === 'ur' ? ur : en;
};
export const accessEntries: [string,string,string][] = [
  ['receive','Receive deliveries','آمد درج کریں'],['produce','Move between stages','مراحل کے درمیان منتقل کریں'],['dispatch','Dispatch','ڈسپیچ'],['waste','Record waste','ضائع شدہ اسٹاک درج کریں'],['catalog','Materials and batches','مواد اور بیچ'],['inspect','Inspections','معائنہ'],['qc','QC decisions','کوالٹی فیصلے'],['reverse','Reverse entries','اندراج واپس کریں'],['suppliers','Supplier directory','سپلائر فہرست'],['procure','Procurement','خریداری'],['sales','Sales orders','فروخت کے آرڈر'],['payments','Customer payments','صارف کی ادائیگیاں'],
];
const approvals: Section = { id: 'approvals', en: 'Approvals', ur: 'منظوریاں', icon: ListChecks };
const claims: Section = { id: 'claims', en: 'Claims', ur: 'دعوے', icon: ShieldCheck };
const reports: Section = { id: 'reports', en: 'Reports', ur: 'رپورٹس', icon: FileText };
const analytics: Section = { id: 'analytics', en: 'Analytics', ur: 'تجزیات', icon: ChartNoAxesCombined };
const settings: Section = { id: 'settings', en: 'Settings', ur: 'ترتیبات', icon: Settings, tabs: [{ id: 'thresholds', en: 'Thresholds', ur: 'حدود' }, { id: 'invoices', en: 'Invoices', ur: 'انوائس' }, { id: 'users', en: 'Users', ur: 'صارفین' }] };
const modules: Section = { id: 'modules', en: 'Modules', ur: 'ماڈیولز', icon: PackagePlus };

// Until a role's owner task lands, its users keep the legacy screens they had; Tasks 18-21 replace these lists.
export const NAV: Record<Role, Section[]> = {
  admin: [dashboard, approvals, claims, activity, reports, analytics, settings, modules],
  purchase_manager: [dashboard, procurement],
  sales_manager: [dashboard],
  dispatch: [dashboard, stock, history],
  quality_inspector: [dashboard, lots, stock, history],
  supervisor: [dashboard, reviews, stock, history],
};
export const COMMON: Section[] = [
  { id: 'notifications', en: 'Notifications', ur: 'اطلاعات', icon: Bell },
  { id: 'profile', en: 'My profile', ur: 'میری پروفائل', icon: CircleUserRound },
  { id: 'scanner', en: 'Scan', ur: 'اسکین', icon: ScanSearch },
  { id: 'help', en: 'Help', ur: 'مدد', icon: CircleHelp },
];

/** Role modules an admin can open; each owner task adds its role here when its screens exist. */
export const INSTALLED_MODULES: Role[] = [];

export const objectRoute = (objectType: string, objectId: string, context: { role: Role; module?: Role; installedModules: Role[] }) => route(objectType, objectId, context, NAV);
