import { Bell, CircleHelp, ClipboardCheck, CircleUserRound, House, History, PackagePlus, ScanSearch, UsersRound, type LucideIcon } from 'lucide-react';
import { ConeIcon } from './icons';
import type { Role } from './inventory-client';
import { objectRoute as route } from './routes.ts';
export { eventTitle, parseHash } from './routes.ts';

export interface Section { id: string; en: string; ur: string; icon: LucideIcon; tabs?: { id: string; en: string; ur: string }[] }

const dashboard: Section = { id: 'dashboard', en: 'Dashboard', ur: 'ڈیش بورڈ', icon: House };
const stock: Section = { id: 'inventory', en: 'Stock', ur: 'اسٹاک', icon: ConeIcon as LucideIcon };
const history: Section = { id: 'activity', en: 'History', ur: 'ہسٹری', icon: History };
const procurement: Section = { id: 'procurement', en: 'Procurement', ur: 'خریداری', icon: PackagePlus };
const lots: Section = { id: 'lots', en: 'Inspections', ur: 'معائنے', icon: ClipboardCheck };
const reviews: Section = { id: 'reviews', en: 'Review', ur: 'جائزہ', icon: ClipboardCheck };
const team: Section = { id: 'team', en: 'Team', ur: 'ٹیم', icon: UsersRound };

// Until a role's owner task lands, its users keep the legacy screens they had; Tasks 18-21 replace these lists.
export const NAV: Record<Role, Section[]> = {
  admin: [dashboard, stock, history, procurement, team],
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
