import type { CSSProperties } from 'react';
import { CheckCheck, ChevronRight, ClipboardCheck, ClipboardList, FileText, ListChecks, PackagePlus, ScanSearch, Truck, UsersRound, type LucideIcon } from 'lucide-react';
import { NextStep, StatusTag, portal } from './PortalCommon';
import { when, StockFlow, TodayGreeting } from './WorkspaceDashboard';
import { useLanguage } from './i18n';
import { eventTitle, INSTALLED_MODULES, NAV, objectRoute } from './roles';
import { weight, type Member, type Role, type WorkspaceState } from './inventory-client';
import { money, useSalesData } from './SalesWidget';
import { NoticeWidget } from './NoticeWidget';
import { ShipmentsWidget } from './ShipmentTracking';
import { AttentionWidget, useAttentionQueue } from './AttentionWidget';
import { WallpaperButton } from './Wallpaper';
import { ConeIcon } from './icons';
import './people-ui.css';

export interface Notice { id: string; event: string; object_type: string; object_id: string; label: string; status: 'unread' | 'read'; created_at: number }
export interface Inbox { notifications: Notice[]; unread: number }

/** Opens the notification's item and marks it read; the new hash is chosen before the read finishes. */
export function useOpen(member: Member, reload: () => Promise<void>) {
  return async (notice: Notice) => {
    location.hash = objectRoute(notice.object_type, notice.object_id, { role: member.role, installedModules: INSTALLED_MODULES });
    if (notice.status === 'unread') { await portal('/notifications/read', { ids: [notice.id] }); await reload(); }
  };
}

function Row({ notice, onOpen }: { notice: Notice; onOpen: (notice: Notice) => void }) {
  const { language, t } = useLanguage();
  const [en, ur] = eventTitle[notice.event] || [notice.event, notice.event];
  return <li><button className={`live-lot-row yf-notice${notice.status === 'unread' ? ' is-unread' : ''}`} onClick={() => onOpen(notice)}>
    <span className="live-lot-name"><strong>{t(en, ur)}</strong><span>{[notice.label, when.format(notice.created_at, language)].filter(Boolean).join(' · ')}</span></span>
    {notice.status === 'unread' && <StatusTag status="unread" />}<ChevronRight size={20} aria-hidden="true" />
  </button></li>;
}

const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
/** Notifications arrive newest first; consecutive ones on the same local day form one group. */
function groupByDay(list: Notice[], language: string, t: (english: string, urdu?: string) => string) {
  const groups: { key: string; title: string; items: Notice[] }[] = [];
  for (const notice of list) {
    const key = dayKey(notice.created_at), last = groups[groups.length - 1];
    if (last && last.key === key) { last.items.push(notice); continue; }
    const title = key === dayKey(Date.now()) ? t('Today', 'آج')
      : key === dayKey(Date.now() - 86400000) ? t('Yesterday', 'کل')
      : new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'short' }).format(notice.created_at);
    groups.push({ key, title, items: [notice] });
  }
  return groups;
}

export function Notifications({ member, inbox, reload }: { member: Member; inbox: Inbox; reload: () => Promise<void> }) {
  const { language, t } = useLanguage();
  const open = useOpen(member, reload);
  return <section className="yf-inbox" aria-label={t('Notifications', 'اطلاعات')}>
    {inbox.unread > 0 && <div className="live-actions"><button className="button" onClick={async () => { await portal('/notifications/read', { all: true }); await reload(); }}><CheckCheck size={18} aria-hidden="true" />{t('Mark all as read', 'سب کو پڑھا ہوا کریں')}</button></div>}
    {inbox.notifications.length ? groupByDay(inbox.notifications, language, t).map(group => <section className="pp-day" key={group.key} aria-label={group.title}>
      <h3 className="pp-day-title">{group.title}</h3>
      <ul className="pp-day-list">{group.items.map(notice => <Row key={notice.id} notice={notice} onOpen={notice => void open(notice)} />)}</ul>
    </section>)
      : <div className="live-empty"><h3>{t('No notifications yet', 'ابھی کوئی اطلاع نہیں')}</h3><p>{t('Items that need you will appear here.', 'جن چیزوں پر آپ کی توجہ چاہیے وہ یہاں نظر آئیں گی۔')}</p></div>}
  </section>;
}
/** Notices that mean someone is waiting on an approval or award; they count toward the Approvals action. */
const APPROVAL_EVENT = /^(approval\.pending|award\.pending_approval)/;

interface Counts { approvals: number; reports?: number; arrivals: number }
interface QuickAction { key: string; en: string; ur: string; icon: LucideIcon; to: string; count?: { n: number; en: string; ur: string } }
const waiting = (n: number | undefined, en = 'waiting', ur = 'منتظر'): QuickAction['count'] => (n === undefined ? undefined : { n, en, ur });

const scanLot: QuickAction = { key: 'scan', en: 'Scan a lot', ur: 'لاٹ اسکین کریں', icon: ScanSearch, to: 'scanner' };
const stockAction: QuickAction = { key: 'stock', en: 'Stock', ur: 'اسٹاک', icon: ConeIcon as LucideIcon, to: 'inventory' };
// Each role's first action is its main job and takes the pop colour. Counts come only from real queues.
const ACTIONS: Record<Role, (c: Counts) => QuickAction[]> = {
  admin: c => [
    { key: 'approvals', en: 'Approvals', ur: 'منظوریاں', icon: ListChecks, to: 'approvals', count: waiting(c.approvals, 'new', 'نئی') },
    scanLot, stockAction,
    { key: 'reports', en: 'Reports', ur: 'رپورٹس', icon: FileText, to: 'reports' },
  ],
  supervisor: c => [
    { key: 'review', en: 'Review QC reports', ur: 'QC رپورٹس دیکھیں', icon: ClipboardCheck, to: 'reviews', count: waiting(c.reports) },
    scanLot, stockAction,
    { key: 'requests', en: 'Requests', ur: 'درخواستیں', icon: ClipboardList, to: 'requests' },
  ],
  quality_inspector: c => [
    scanLot,
    { key: 'inspections', en: 'Inspections', ur: 'معائنے', icon: ClipboardCheck, to: 'lots', count: waiting(c.arrivals) },
    stockAction,
  ],
  purchase_manager: () => [
    { key: 'procurement', en: 'Procurement', ur: 'خریداری', icon: PackagePlus, to: 'procurement' },
    scanLot,
  ],
  sales_manager: () => [
    { key: 'dispatch-requests', en: 'Dispatch requests', ur: 'ڈسپیچ درخواستیں', icon: Truck, to: 'dispatch-requests' },
    { key: 'invoices', en: 'Invoices', ur: 'انوائسز', icon: FileText, to: 'invoices' },
    { key: 'buyer-rfqs', en: 'Buyer RFQs', ur: 'خریدار کی درخواستیں', icon: FileText, to: 'buyer-rfqs' },
    { key: 'buyers', en: 'Sales portal', ur: 'سیلز پورٹل', icon: UsersRound, to: 'buyers' },
  ],
  dispatch: () => [
    { key: 'new-dispatch', en: 'New dispatch', ur: 'نئی ڈسپیچ', icon: PackagePlus, to: 'new-dispatch' },
    { key: 'dispatches', en: 'Dispatches', ur: 'ڈسپیچز', icon: Truck, to: 'dispatches' },
    scanLot,
  ],
};

// Where a role's money and stock figures lead, first screen it can open.
const HOMES: [string, string, string][] = [['inventory', 'Open stock', 'اسٹاک کھولیں'], ['invoices', 'Open invoices', 'انوائسز کھولیں'], ['dispatches', 'Open dispatches', 'ڈسپیچز کھولیں']];

function salesTotals(invoices: { total_minor: number; paid_minor: number; outstanding_minor: number; status: string; currency: string }[]) {
  const sum = (pick: (invoice: (typeof invoices)[number]) => number) => invoices.reduce((total, invoice) => total + pick(invoice), 0);
  return {
    currency: invoices[0]?.currency ?? 'PKR',
    invoiced: sum(i => i.total_minor),
    collected: sum(i => i.paid_minor),
    outstanding: sum(i => i.outstanding_minor),
    overdue: invoices.some(i => i.status === 'overdue'),
  };
}

/** The Today screen: greeting, the next step, quick actions for this role, what needs attention, one KPI strip, then activity and stock side by side. */
export function Dashboard({ member, inbox, reload, state, onChanged }: { member: Member; inbox: Inbox; reload: () => Promise<void>; state: WorkspaceState; onChanged?: () => Promise<void> }) {
  const { t } = useLanguage();
  const open = useOpen(member, reload);
  const queue = useAttentionQueue(member);
  const sales = useSalesData();
  const oldest = [...inbox.notifications].reverse().find(notice => notice.status === 'unread');
  const [en, ur] = oldest ? eventTitle[oldest.event] || [oldest.event, oldest.event] : ['', ''];
  const actions = ACTIONS[member.role]({
    approvals: inbox.notifications.filter(notice => notice.status === 'unread' && APPROVAL_EVENT.test(notice.event)).length,
    reports: queue.data ? queue.data.reports.length : undefined,
    arrivals: state.qcArrivals?.length ?? 0,
  });

  const stockGrams = state.balances.reduce((total, b) => total + b.grams, 0);
  const reversed = new Set(state.movements.flatMap(m => (m.reverses ? [m.reverses] : [])));
  const producedGrams = state.movements.reduce((total, m) => (m.action === 'transfer' && m.to_stage === 'finished' && !reversed.has(m.id) ? total + m.grams : total), 0);
  const totals = sales.kind === 'ready' ? salesTotals(sales.data.invoices) : null;
  const sections = NAV[member.role].map(section => section.id);
  const home = HOMES.find(([id]) => sections.includes(id));

  return <div className="wd-home">
    <TodayGreeting name={member.name} />
    {oldest && <NextStep tone="warn" title={t(`Next: ${en}`, `اگلا کام: ${ur}`)} reason={oldest.label} action={<button className="button" onClick={() => void open(oldest)}>{t('Open', 'کھولیں')}</button>} />}

    <nav className="wd-actions" aria-label={t('Quick actions', 'فوری کام')}>
      {actions.map((action, index) => <a key={action.key} className={`wd-action${index === 0 ? ' is-pop' : ''}`} href={`#/${action.to}`} style={{ '--d': `${index * 40}ms` } as CSSProperties}>
        <span className="wd-action-icon"><action.icon size={22} aria-hidden="true" /></span>
        <strong>{t(action.en, action.ur)}</strong>
        {action.count && <small><span dir="ltr">{action.count.n}</span> {t(action.count.en, action.count.ur)}</small>}
      </a>)}
    </nav>

    <AttentionWidget member={member} onChanged={onChanged} queue={queue} />

    <section className="wd-section" aria-labelledby="wd-glance-title">
      <div className="wd-section-head">
        <h2 id="wd-glance-title">{t('At a glance', 'ایک نظر میں')}</h2>
        {home && <a className="wd-next" href={`#/${home[0]}`}>{t(home[1], home[2])}</a>}
      </div>
      <dl className="wd-kpis">
        <div><dt>{t('Stock on hand', 'موجودہ اسٹاک')}</dt><dd>{weight(stockGrams)} <small>kg</small></dd></div>
        <div><dt>{t('Produced, all time', 'کل پیداوار')}</dt><dd>{weight(producedGrams)} <small>kg</small></dd></div>
        {totals && <>
          <div><dt>{t('Invoiced', 'انوائس کی گئی')}</dt><dd>{money(totals.invoiced, totals.currency)}</dd></div>
          <div><dt>{t('Collected', 'وصول شدہ')}</dt><dd>{money(totals.collected, totals.currency)}</dd></div>
          <div className={totals.overdue ? 'is-alert' : undefined}><dt>{t('Outstanding', 'باقی رقم')}</dt><dd>{money(totals.outstanding, totals.currency)}</dd>{totals.overdue && <small>{t('Overdue', 'مدت گزر چکی')}</small>}</div>
        </>}
      </dl>
    </section>

    <div className="wd-cols">
      <div className="wd-col">
        <NoticeWidget member={member} inbox={inbox} reload={reload} />
      </div>
      <div className="wd-col">
        <ShipmentsWidget />
        <section className="wd-section wd-stages" aria-labelledby="wd-stages-title">
          <div className="wd-section-head">
            <h2 id="wd-stages-title">{t('Stock stages', 'اسٹاک کے مراحل')}</h2>
            <a className="wd-next" href="#/inventory">{t('Open stock', 'اسٹاک کھولیں')}</a>
          </div>
          <StockFlow balances={state.balances} compact />
        </section>
      </div>
    </div>
    <WallpaperButton />
  </div>;
}
