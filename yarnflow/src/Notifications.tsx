import { CheckCheck, BellRing, Package, ScanLine, Truck, ClipboardCheck, Boxes, ClipboardList, FileText, ShoppingCart } from 'lucide-react';
import { RowCard, StatusTag, ActionBar, EmptyState, Stat, StatRow, Section, Banner, JobTile } from './ui';
import { portal } from './PortalCommon';
import { when } from './WorkspaceDashboard';
import { useLanguage } from './i18n';
import { eventTitle, INSTALLED_MODULES, objectRoute } from './roles';
import { type Member, type WorkspaceState, weight } from './inventory-client';
import { money, useSalesData } from './SalesWidget';
import { AttentionWidget, useAttentionQueue } from './AttentionWidget';
import './people-ui.css';
import './WorkspaceDashboard.css';

export interface Notice { id: string; event: string; object_type: string; object_id: string; label: string; status: 'unread' | 'read'; created_at: number }
export interface Inbox { notifications: Notice[]; unread: number }

/** Opens the notification's item and marks it read; the new hash is chosen before the read finishes. */
export function useOpen(member: Member, reload: () => Promise<void>) {
  return async (notice: Notice) => {
    location.hash = objectRoute(notice.object_type, notice.object_id, { role: member.role, installedModules: INSTALLED_MODULES });
    if (notice.status === 'unread') { await portal('/notifications/read', { ids: [notice.id] }); await reload(); }
  };
}

function NoticeRow({ notice, onOpen }: { notice: Notice; onOpen: (notice: Notice) => void }) {
  const { language, t } = useLanguage();
  const [en, ur] = eventTitle[notice.event] || [notice.event, notice.event];
  return <li className="wd-notice-item"><RowCard
    title={t(en, ur)}
    detail={[notice.label, when.format(notice.created_at, language)].filter(Boolean).join(' · ')}
    leading={notice.status === 'unread' ? <BellRing size={20} aria-hidden="true" /> : <Package size={20} aria-hidden="true" />}
    status={notice.status === 'unread' ? <StatusTag tone="warn" label={t('Unread', 'نہیں پڑھی')} /> : undefined}
    onClick={() => onOpen(notice)}
    className={notice.status === 'unread' ? 'is-unread' : ''}
  /></li>;
}

export function Notifications({ member, inbox, reload }: { member: Member; inbox: Inbox; reload: () => Promise<void> }) {
  const { t } = useLanguage();
  const open = useOpen(member, reload);
  const markAll = async () => { await portal('/notifications/read', { all: true }); await reload(); };
  return <section className="wd-inbox" aria-label={t('Notifications', 'اطلاعات')}>
    <ul className="wd-inbox-list">
      {inbox.notifications.map(notice => <NoticeRow key={notice.id} notice={notice} onOpen={notice => void open(notice)} />)}
    </ul>
    {!inbox.notifications.length && <EmptyState message={t('No notifications yet.', 'ابھی کوئی اطلاع نہیں۔')} emptyIso="inbox" />}
    {inbox.unread > 0 && <ActionBar primary={{ label: t('Mark all read', 'سب کو پڑھا ہوا کریں'), onClick: () => void markAll(), icon: <CheckCheck size={20} aria-hidden="true" /> }} />}
  </section>;
}

const JOBS = {
  admin: [['Scan', 'اسکین', 'scanner', ScanLine], ['Approvals', 'منظوریاں', 'approvals', ClipboardCheck], ['Stock', 'اسٹاک', 'inventory', Boxes], ['Reports', 'رپورٹس', 'reports', FileText]],
  supervisor: [['Scan', 'اسکین', 'scanner', ScanLine], ['Review', 'جائزہ', 'reviews', ClipboardCheck], ['Incoming QC', 'آمد کی کوالٹی جانچ', 'incoming-qc', ClipboardList], ['Stock', 'اسٹاک', 'inventory', Boxes]],
  quality_inspector: [['Scan', 'اسکین', 'scanner', ScanLine], ['Inspections', 'معائنے', 'lots', ClipboardCheck], ['Incoming QC', 'آمد کی کوالٹی جانچ', 'incoming-qc', ClipboardList], ['Stock', 'اسٹاک', 'inventory', Boxes]],
  purchase_manager: [['Scan', 'اسکین', 'scanner', ScanLine], ['Procurement', 'خریداری', 'procurement', ShoppingCart], ['Incoming QC', 'آمد کی کوالٹی جانچ', 'incoming-qc', ClipboardList]],
  sales_manager: [['Scan', 'اسکین', 'scanner', ScanLine], ['Sales portal', 'سیلز پورٹل', 'buyers', Package], ['Buyer requests', 'خریدار کی درخواستیں', 'buyer-rfqs', FileText], ['Invoices', 'انوائسز', 'invoices', FileText]],
  dispatch: [['Scan', 'اسکین', 'scanner', ScanLine], ['Incoming QC', 'آمد کی کوالٹی جانچ', 'incoming-qc', ClipboardList], ['Dispatches', 'ڈسپیچز', 'dispatches', Truck], ['New dispatch', 'نئی ڈسپیچ', 'new-dispatch', Truck]],
} as const;

function salesTotals(all: { total_minor: number; credited_minor?: number; paid_minor: number; outstanding_minor: number; status: string; currency: string }[]) {
  const invoices = all.filter(invoice => invoice.status !== 'void');
  const sum = (pick: (invoice: (typeof invoices)[number]) => number) => invoices.reduce((total, invoice) => total + pick(invoice), 0);
  return { currency: all[0]?.currency ?? 'PKR', invoiced: sum(i => i.total_minor - (i.credited_minor ?? 0)), collected: sum(i => i.paid_minor), outstanding: sum(i => i.outstanding_minor) };
}

function MoneyStats() {
  const { t } = useLanguage();
  const sales = useSalesData();
  if (sales.kind !== 'ready' || !sales.data.invoices.some(invoice => invoice.status !== 'void')) return null;
  const totals = salesTotals(sales.data.invoices);
  const figures = [
    totals.invoiced > 0 && <Stat key="invoiced" label={t('Invoiced', 'انوائس کی گئی')} value={money(totals.invoiced, totals.currency)} />,
    totals.collected > 0 && <Stat key="collected" label={t('Collected', 'وصول شدہ')} value={money(totals.collected, totals.currency)} />,
    totals.outstanding > 0 && <Stat key="outstanding" label={t('Outstanding', 'باقی رقم')} value={money(totals.outstanding, totals.currency)} />,
  ].filter(Boolean);
  return figures.length > 0 ? <Section title={t('Today', 'آج')} className="wd-today-stats"><StatRow>{figures}</StatRow></Section> : null;
}

/** Home: the work waiting for this person, their main jobs, then useful live figures. */
export function Dashboard({ member, inbox, reload, state, onChanged }: { member: Member; inbox: Inbox; reload: () => Promise<void>; state: WorkspaceState; onChanged?: () => Promise<void> }) {
  const { t, language } = useLanguage();
  const queue = useAttentionQueue(member);
  const open = useOpen(member, reload);
  const stockGrams = state.balances.reduce((total, balance) => total + balance.grams, 0);
  const reversed = new Set(state.movements.flatMap(movement => movement.reverses ? [movement.reverses] : []));
  const producedGrams = state.movements.reduce((total, movement) => movement.action === 'transfer' && movement.to_stage === 'finished' && !reversed.has(movement.id) ? total + movement.grams : total, 0);
  const finishedGrams = state.balances.filter(balance => balance.stage === 'finished').reduce((total, balance) => total + balance.grams, 0);
  const moneyRole = member.role === 'admin' || member.role === 'sales_manager';
  const waiting = inbox.notifications.filter(notice => notice.status === 'unread');
  const waitingCount = waiting.length + queue.total;
  const now = new Date();
  const [en, ur] = now.getHours() < 12 ? ['Good morning', 'صبح بخیر'] : now.getHours() < 17 ? ['Good afternoon', 'دوپہر بخیر'] : ['Good evening', 'شام بخیر'];
  const date = new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Karachi' }).format(now);
  const personName = member.name.trim().split(/\s+/)[0] ?? '';
  const greeting = `${t(en, ur)}${personName ? `, ${personName}` : ''}`;
  const waitingText = queue.canAct && !queue.hidden && !queue.data
    ? t('Checking what needs you', 'آپ کے کام دیکھے جا رہے ہیں')
    : waitingCount === 0
    ? t('Nothing is waiting for you', 'آپ کے لیے کچھ منتظر نہیں')
    : t(`${waitingCount} ${waitingCount === 1 ? 'thing needs you' : 'things need you'}`, `${waitingCount} چیزیں آپ کی منتظر ہیں`);
  return <div className="wd-home">
    <Banner tone="brand" title={greeting} text={`${date} · ${waitingText}`} className="wd-home-banner" />
    {waiting.length > 0 && <ul className="wd-do-list">{waiting.map(notice => <NoticeRow key={notice.id} notice={notice} onOpen={notice => void open(notice)} />)}</ul>}
    <AttentionWidget member={member} onChanged={onChanged} queue={queue} />
    <Section title={t('Start', 'شروع کریں')} className="wd-start">
      <nav aria-label={t('Main jobs', 'اہم کام')} className="wd-jobs"><ul>{JOBS[member.role].map(([enLabel, urLabel, to, Icon]) => <li key={to}><JobTile className="wd-job" icon={<Icon />} label={t(enLabel, urLabel)} onClick={() => { location.hash = `#/${to}`; }} /></li>)}</ul></nav>
    </Section>
    {moneyRole ? <MoneyStats /> : (stockGrams > 0 || producedGrams > 0 || finishedGrams > 0) && <Section title={t('Today', 'آج')} className="wd-today-stats"><StatRow>
      {stockGrams > 0 && <Stat label={t('Stock on hand', 'موجودہ اسٹاک')} value={weight(stockGrams)} unit="kg" />}
      {producedGrams > 0 && <Stat label={t('In production', 'زیرِ تیاری')} value={weight(producedGrams)} unit="kg" />}
      {finishedGrams > 0 && <Stat label={t('To dispatch', 'ڈسپیچ کے لیے')} value={weight(finishedGrams)} unit="kg" />}
    </StatRow></Section>}
  </div>;
}
