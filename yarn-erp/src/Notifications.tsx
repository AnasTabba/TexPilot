import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { CheckCheck, ChevronDown, ChevronRight, GripVertical, Minus } from 'lucide-react';
import { NextStep, StatusTag, portal } from './PortalCommon';
import { when } from './WorkspaceDashboard';
import { useLanguage } from './i18n';
import { eventTitle, INSTALLED_MODULES, objectRoute } from './roles';
import type { Member, WorkspaceState } from './inventory-client';
import { SalesWidget } from './SalesWidget';
import { InventoryWidget, ProductionWidget } from './StockWidgets';
import { NoticeWidget } from './NoticeWidget';
import { ShipmentsWidget } from './ShipmentTracking';
import { AttentionWidget } from './AttentionWidget';

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
/** Dashboard cards sit on a 12-column grid. Each card has a toolbar strip above it (move, width, minimise); the layout persists per browser. */
type DashKey = 'attention' | 'sales' | 'production' | 'notices' | 'inventory' | 'shipments';
type DashWidth = 4 | 6 | 8 | 12;
interface DashSlot { key: DashKey; width: DashWidth; min: boolean }
interface DashDrop { key: DashKey; axis: 'x' | 'y'; side: 'before' | 'after' }
const LAYOUT_KEY = 'yf-dash-layout-v2';
const WIDTHS: DashWidth[] = [4, 6, 8, 12];
const WIDTH_LABEL: Record<DashWidth, string> = { 4: 'S', 6: 'M', 8: 'L', 12: 'Full' };
const DASH_TITLE: Record<DashKey, [string, string]> = {
  sales: ['Total sales', 'کل فروخت'],
  production: ['Production', 'پیداوار'],
  notices: ['Notifications', 'اطلاعات'],
  inventory: ['Inventory', 'اسٹاک'],
  shipments: ['Shipments on route', 'راستے میں شپمنٹس'],
  attention: ['Needs attention', 'توجہ طلب'],
};
const DEFAULT_LAYOUT: DashSlot[] = [
  { key: 'attention', width: 6, min: false },
  { key: 'sales', width: 12, min: false },
  { key: 'production', width: 6, min: false },
  { key: 'notices', width: 6, min: false },
  { key: 'inventory', width: 8, min: false },
  { key: 'shipments', width: 4, min: false },
];
const KEY_MOVE: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

/** Saved order, widths and minimised flags. Invalid entries fall back per card; unknown keys are dropped; missing cards append with defaults. */
function loadLayout(): DashSlot[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
    if (!Array.isArray(saved)) return DEFAULT_LAYOUT;
    const out: DashSlot[] = [];
    for (const row of saved as Record<string, unknown>[]) {
      const def = DEFAULT_LAYOUT.find(d => d.key === row?.key);
      if (!def || out.some(s => s.key === def.key)) continue;
      const width = WIDTHS.find(w => w === row.width) ?? def.width;
      out.push({ key: def.key, width, min: row.min === true });
    }
    // A card new to this layout takes its default position (e.g. Needs attention goes first), not the end.
    DEFAULT_LAYOUT.forEach((def, index) => { if (!out.some(s => s.key === def.key)) out.splice(Math.min(index, out.length), 0, { ...def }); });
    return out;
  } catch { return DEFAULT_LAYOUT; }
}

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Card positions before a layout change; the change then slides each card from its old spot (FLIP). */
function measureCards(grid: HTMLElement | null) {
  const rects = new Map<DashKey, DOMRect>();
  grid?.querySelectorAll<HTMLElement>('.yf-dash-item').forEach(el => {
    el.getAnimations().forEach(animation => animation.cancel());
    rects.set(el.dataset.key as DashKey, el.getBoundingClientRect());
  });
  return rects;
}

interface DashItemProps {
  slot: DashSlot; index: number; total: number; title: string;
  dragging: boolean; drop: DashDrop | null; draggable: boolean;
  onMove: (delta: number) => void; onWidth: () => void; onToggle: () => void; onArm: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void; onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void; onDragLeave: (e: DragEvent<HTMLDivElement>) => void; onDrop: (e: DragEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

function DashItem({ slot, index, total, title, dragging, drop, draggable, onMove, onWidth, onToggle, onArm, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, children }: DashItemProps) {
  const { t } = useLanguage();
  const widthLabel = WIDTH_LABEL[slot.width];
  const position = index + 1;
  const moveLabel = t(`Move ${title}, position ${position} of ${total}`, `${title} منتقل کریں، پوزیشن ${position} از ${total}`);
  const minLabel = slot.min ? t(`Restore ${title}`, `${title} بحال کریں`) : t(`Minimise ${title}`, `${title} چھوٹا کریں`);
  const widthTitle = t(`Width ${widthLabel}, change width`, `چوڑائی ${widthLabel}، تبدیل کریں`);
  const cls = ['yf-dash-item', slot.min && 'is-min', dragging && 'is-dragging', drop && `is-drop-${drop.axis}-${drop.side}`].filter(Boolean).join(' ');
  return <div className={cls} data-key={slot.key} data-w={slot.width} draggable={draggable}
    onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    <div className="yf-dash-bar">
      <button type="button" className="yf-dash-grip" aria-label={moveLabel} title={moveLabel} onPointerDown={onArm}
        onKeyDown={e => { const delta = KEY_MOVE[e.key]; if (!delta) return; e.preventDefault(); onMove(delta); }}>
        <GripVertical size={16} aria-hidden="true" />
      </button>
      <span className="yf-dash-title">{title}</span>
      <div className="yf-dash-tools">
        <button type="button" className="yf-dash-width" onClick={onWidth} aria-label={widthTitle} title={widthTitle}>{widthLabel}</button>
        <button type="button" className="yf-dash-min" onClick={onToggle} aria-expanded={!slot.min} aria-label={minLabel} title={minLabel}>
          {slot.min ? <ChevronDown size={16} aria-hidden="true" /> : <Minus size={16} aria-hidden="true" />}
        </button>
      </div>
    </div>
    <div className="yf-dash-collapse"><div className="yf-dash-body">{children}</div></div>
  </div>;
}

/** Every role's dashboard: the oldest unread notification as the next step, then sales, production, stock and notification widgets. */
export function Dashboard({ member, inbox, reload, state, onChanged }: { member: Member; inbox: Inbox; reload: () => Promise<void>; state: WorkspaceState; onChanged?: () => Promise<void> }) {
  const { t } = useLanguage();
  const open = useOpen(member, reload);
  const oldest = [...inbox.notifications].reverse().find(notice => notice.status === 'unread');
  const [en, ur] = oldest ? eventTitle[oldest.event] || [oldest.event, oldest.event] : ['', ''];
  const [layout, setLayout] = useState(loadLayout);
  const [armed, setArmed] = useState<DashKey | null>(null);
  const [dragKey, setDragKey] = useState<DashKey | null>(null);
  const [drop, setDrop] = useState<DashDrop | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const before = useRef(new Map<DashKey, DOMRect>());
  const resizedKey = useRef<DashKey | null>(null);
  const focusKey = useRef<DashKey | null>(null);

  useEffect(() => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* storage blocked: layout resets on reload */ }
  }, [layout]);
  // A drag handle is armed on pointer down, so only a grip press (not a text selection in a card) starts a drag.
  useEffect(() => {
    if (!armed) return;
    const release = () => setArmed(null);
    window.addEventListener('pointerup', release);
    return () => window.removeEventListener('pointerup', release);
  }, [armed]);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (focusKey.current) {
      grid?.querySelector<HTMLButtonElement>(`[data-key="${focusKey.current}"] .yf-dash-grip`)?.focus();
      focusKey.current = null;
    }
    const from = before.current;
    before.current = new Map();
    const resized = resizedKey.current;
    resizedKey.current = null;
    if (!grid || !from.size || reduceMotion()) return;
    grid.querySelectorAll<HTMLElement>('.yf-dash-item').forEach(el => {
      const key = el.dataset.key as DashKey;
      const was = from.get(key);
      if (!was) return;
      const now = el.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      const isResized = resized === key;
      if (!dx && !dy && !isResized) return;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)`, opacity: isResized ? 0.55 : 1 }, { transform: 'none', opacity: 1 }],
        { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    });
  }, [layout]);

  const change = (next: (prev: DashSlot[]) => DashSlot[], resized?: DashKey) => {
    before.current = measureCards(gridRef.current);
    resizedKey.current = resized ?? null;
    setLayout(next);
  };
  const move = (key: DashKey, delta: number) => {
    const from = layout.findIndex(s => s.key === key);
    const to = from + delta;
    if (to < 0 || to >= layout.length) return;
    focusKey.current = key;
    change(prev => {
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  };
  const onDragStart = (e: DragEvent<HTMLDivElement>, key: DashKey) => {
    if (armed !== key) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
    setDragKey(key);
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>, key: DashKey) => {
    if (!dragKey || dragKey === key) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = e.currentTarget.getBoundingClientRect();
    const src = gridRef.current?.querySelector<HTMLElement>(`[data-key="${dragKey}"]`)?.getBoundingClientRect();
    // Same row: insert left or right. Otherwise: insert above or below.
    const axis: DashDrop['axis'] = src && Math.abs(src.top - r.top) < 4 ? 'x' : 'y';
    const side: DashDrop['side'] = axis === 'x'
      ? (e.clientX < r.left + r.width / 2 ? 'before' : 'after')
      : (e.clientY < r.top + r.height / 2 ? 'before' : 'after');
    setDrop(prev => (prev?.key === key && prev.axis === axis && prev.side === side ? prev : { key, axis, side }));
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>, key: DashKey) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(prev => (prev?.key === key ? null : prev));
  };
  const onDrop = (e: DragEvent<HTMLDivElement>, key: DashKey) => {
    e.preventDefault();
    if (dragKey && drop && drop.key === key) {
      const side = drop.side;
      change(prev => {
        const item = prev.find(s => s.key === dragKey);
        if (!item) return prev;
        const rest = prev.filter(s => s.key !== dragKey);
        const at = rest.findIndex(s => s.key === key) + (side === 'after' ? 1 : 0);
        return [...rest.slice(0, at), item, ...rest.slice(at)];
      });
    }
    setDrop(null);
    setDragKey(null);
  };
  const onDragEnd = () => { setDragKey(null); setDrop(null); setArmed(null); };

  const body: Record<DashKey, ReactNode> = {
    attention: <AttentionWidget member={member} onChanged={onChanged} />,
    sales: <SalesWidget />,
    production: <ProductionWidget state={state} />,
    notices: <NoticeWidget member={member} inbox={inbox} reload={reload} />,
    inventory: <InventoryWidget state={state} />,
    shipments: <ShipmentsWidget />,
  };
  return <div className="yf-home">
    {oldest && <NextStep tone="warn" title={t(`Next: ${en}`, `اگلا کام: ${ur}`)} reason={oldest.label} action={<button className="button primary" onClick={() => void open(oldest)}>{t('Open', 'کھولیں')}</button>} />}
    <div className="yf-dash-grid" ref={gridRef}>
      {layout.map((slot, index) => <DashItem key={slot.key} slot={slot} index={index} total={layout.length}
        title={t(...DASH_TITLE[slot.key])} dragging={dragKey === slot.key} drop={drop?.key === slot.key ? drop : null}
        draggable={armed === slot.key}
        onMove={delta => move(slot.key, delta)}
        onWidth={() => change(prev => prev.map(s => (s.key === slot.key ? { ...s, width: WIDTHS[(WIDTHS.indexOf(s.width) + 1) % WIDTHS.length] } : s)), slot.key)}
        onToggle={() => change(prev => prev.map(s => (s.key === slot.key ? { ...s, min: !s.min } : s)))}
        onArm={() => setArmed(slot.key)}
        onDragStart={e => onDragStart(e, slot.key)} onDragEnd={onDragEnd}
        onDragOver={e => onDragOver(e, slot.key)} onDragLeave={e => onDragLeave(e, slot.key)} onDrop={e => onDrop(e, slot.key)}>
        {body[slot.key]}
      </DashItem>)}
    </div>
    <div className="yf-dash-foot">
      <button type="button" className="yf-dash-reset" onClick={() => change(() => DEFAULT_LAYOUT.map(s => ({ ...s })))}>{t('Reset layout', 'ترتیب ری سیٹ کریں')}</button>
    </div>
  </div>;
}
