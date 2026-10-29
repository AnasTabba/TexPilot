import type { JSX } from 'react';
import type { Member, Role } from './inventory-client';
import Inspections from './Inspections';
import Review from './Review';
import Procurement from './Procurement';
import { useLanguage } from './i18n';
import { NAV } from './roles';

export interface ModuleProps { member: Member; section: string; tab: string; id: string; navigate: (to: string, id?: string) => void }
type ModuleScreen = (props: ModuleProps) => JSX.Element;
const legacyNav = (role: Role): ModuleScreen => props => {
  if (role === 'purchase_manager') return <Procurement member={props.member} onInventoryChanged={async () => { props.navigate('inventory'); }} />;
  if (role === 'quality_inspector') return <Inspections />;
  if (role === 'supervisor') return <Review />;
  const { t } = useLanguage();
  return <section className="live-empty"><h2>{t('This module is not installed yet.', 'یہ ماڈیول ابھی نصب نہیں ہوا۔')}</h2><p>{t('The legacy Stock and History sections remain available.', 'پرانے اسٹاک اور ہسٹری کے حصے دستیاب ہیں۔')}</p></section>;
};
// Owner tasks add their role screens here. Keep roles.ts limited to navigation and helpers.
export const MODULES: Partial<Record<Role, ModuleScreen>> = {};
export const legacyModules: Record<Role, ModuleScreen> = Object.fromEntries((Object.keys(NAV) as Role[]).filter(role => role !== 'admin').map(role => [role, legacyNav(role)])) as Record<Role, ModuleScreen>;
export function LegacyModule(props: ModuleProps) { return legacyNav(props.member.role)(props); }
