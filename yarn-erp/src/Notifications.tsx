import { useEffect, useState, type ReactNode } from 'react';
import { CheckCheck, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import { NextStep, StatusTag, portal } from './PortalCommon';
import { when } from './WorkspaceDashboard';
import { useLanguage } from './i18n';
import { eventTitle, INSTALLED_MODULES, objectRoute } from './roles';
import type { Member, WorkspaceState } from './inventory-client';
import { SalesWidget } from './SalesWidget';
import { InventoryWidget, ProductionWidget } from './StockWidgets';
import { NoticeWidget } from './NoticeWidget';

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

export function Notifications({ member, inbox, reload }: { member: Member; inbox: Inbox; reload: () => Promise<void> }) {
  const { t } = useLanguage();
  const open = useOpen(member, reload);
  return <section className="yf-inbox" aria-label={t('Notifications', 'اطلاعات')}>
    {inbox.unread > 0 && <div className="live-actions"><button className="button" onClick={async () => { await portal('/notifications/read', { all: true }); await reload(); }}><CheckCheck size={18} aria-hidden="true" />{t('Mark all as read', 'سب کو پڑھا ہوا کریں')}</button></div>}
    {inbox.notifications.length ? <ul>{inbox.notifications.map(notice => <Row key={notice.id} notice={notice} onOpen={notice => void open(notice)} />)}</ul>
      : <div className="live-empty"><h3>{t('No notifications yet', 'ابھی کوئی اطلاع نہیں')}</h3><p>{t('Items that need you will appear here.', 'جن چیزوں پر آپ کی توجہ چاہیے وہ یہاں نظر آئیں گی۔')}</p></div>}
  </section>;
}

/** Dashboard widgets the user can make half or full width; the choice persists per browser. */
type DashKey = 'sales' | 'production' | 'notices' | 'inventory';
type DashSize = 'half' | 'full';
const SIZE_KEY = 'yf-dash-sizes';
const DEFAULT_SIZES: Record<DashKey, DashSize> = { sales: 'full', production: 'half', notices: 'half', inventory: 'full' };

function loadSizes(): Record<DashKey, DashSize> {
  try {
    const saved = JSON.parse(localStorage.getItem(SIZE_KEY) || '{}');
    return Object.fromEntries(Object.entries(DEFAULT_SIZES).map(([key, fallback]) => [key, saved[key] === 'half' || saved[key] === 'full' ? saved[key] : fallback])) as Record<DashKey, DashSize>;
  } catch { return DEFAULT_SIZES; }
}

function DashItem({ size, moving, onToggle, children }: { size: DashSize; moving: boolean; onToggle: () => void; children: ReactNode }) {
  const { t } = useLanguage();
  const wide = size === 'full';
  const label = wide ? t('Make smaller', 'چھوٹا کریں') : t('Make wider', 'چوڑا کریں');
  return <div className={`yf-dash-item${moving ? ' is-resizing' : ''}`} data-size={size}>
    {children}
    <button type="button" className="yf-dash-size" onClick={onToggle} aria-pressed={wide} aria-label={label} title={label}>
      {wide ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
    </button>
  </div>;
}

/** Every role's dashboard: the oldest unread notification as the next step, then sales, production, stock and notification widgets. */
export function Dashboard({ member, inbox, reload, state }: { member: Member; inbox: Inbox; reload: () => Promise<void>; state: WorkspaceState }) {
  const { t } = useLanguage();
  const open = useOpen(member, reload);
  const oldest = [...inbox.notifications].reverse().find(notice => notice.status === 'unread');
  const [en, ur] = oldest ? eventTitle[oldest.event] || [oldest.event, oldest.event] : ['', ''];
  const [sizes, setSizes] = useState(loadSizes);
  const [moving, setMoving] = useState<DashKey | null>(null);
  useEffect(() => {
    try { localStorage.setItem(SIZE_KEY, JSON.stringify(sizes)); } catch { /* storage blocked: sizes reset on reload */ }
  }, [sizes]);
  useEffect(() => {
    if (!moving) return;
    const id = window.setTimeout(() => setMoving(null), 320);
    return () => window.clearTimeout(id);
  }, [moving]);
  const resize = (key: DashKey) => {
    setSizes(prev => ({ ...prev, [key]: prev[key] === 'full' ? 'half' : 'full' }));
    setMoving(key);
  };
  return <div className="yf-home">
    {oldest && <NextStep tone="warn" title={t(`Next: ${en}`, `اگلا کام: ${ur}`)} reason={oldest.label} action={<button className="button primary" onClick={() => void open(oldest)}>{t('Open', 'کھولیں')}</button>} />}
    <div className="yf-dash-grid">
      <DashItem size={sizes.sales} moving={moving === 'sales'} onToggle={() => resize('sales')}><SalesWidget /></DashItem>
      <DashItem size={sizes.production} moving={moving === 'production'} onToggle={() => resize('production')}><ProductionWidget state={state} /></DashItem>
      <DashItem size={sizes.notices} moving={moving === 'notices'} onToggle={() => resize('notices')}><NoticeWidget member={member} inbox={inbox} reload={reload} /></DashItem>
      <DashItem size={sizes.inventory} moving={moving === 'inventory'} onToggle={() => resize('inventory')}><InventoryWidget state={state} /></DashItem>
    </div>
  </div>;
}
