import type { JSX } from 'react';
import type { Member, Role, WorkspaceState } from './inventory-client';
import PurchaseScreens from './PurchaseScreens';
import SalesScreens from './SalesScreens';
import DispatchScreens from './DispatchScreens';
import QualityScreens from './QualityScreens';
import Review from './Review';
import { SupervisorScreens } from './SupervisorScreens';

/** Owner screens render with the signed-in member (an admin keeps the admin role, so intervention reasons are asked for). */
export interface ModuleProps { member: Member; section: string; tab: string; id: string; navigate: (to: string, tabOrId?: string, detailId?: string) => void; state?: WorkspaceState; onInventoryChanged?: () => Promise<void> }
type ModuleScreen = (props: ModuleProps) => JSX.Element;
type SupervisorSection = Parameters<typeof SupervisorScreens>[0]['section'];

const qualitySections = ['dashboard', 'lots', 'submissions'] as const;
export const MODULES: Record<Role, ModuleScreen | undefined> = {
  admin: undefined,
  purchase_manager: p => <PurchaseScreens member={p.member} section={p.section} tab={p.tab} id={p.id} navigate={p.navigate} onInventoryChanged={p.onInventoryChanged} />,
  sales_manager: p => <SalesScreens member={p.member} section={p.section} tab={p.tab} id={p.id} navigate={p.navigate} />,
  dispatch: p => <DispatchScreens member={p.member} section={p.section} tab={p.tab} id={p.id} navigate={p.navigate} />,
  quality_inspector: p => <QualityScreens member={p.member} section={(qualitySections as readonly string[]).includes(p.section) ? p.section as typeof qualitySections[number] : 'dashboard'} />,
  supervisor: p => p.section === 'reviews' ? <Review member={p.member} tab={p.tab} itemId={p.id} /> : <SupervisorScreens section={(p.section === 'activity' ? 'history' : p.section || 'dashboard') as SupervisorSection} member={p.member} state={p.state!} tab={p.tab} itemId={p.id} />,
};
