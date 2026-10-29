import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Bell, CheckCheck, ClipboardCheck, FileText, ShieldAlert, Truck, type LucideIcon } from 'lucide-react';
import { portal } from './PortalCommon';
import { useOpen, type Inbox, type Notice } from './Notifications';
import { useLanguage, type Language } from './i18n';
import { eventTitle } from './roles';
import { when } from './WorkspaceDashboard';
import type { Member } from './inventory-client';
import './notice-widget.css';

const CORAL = '#e4572e';
const INDIGO = '#4f5bd5';
const DAYS = 7;
const SLOT = 80;
const BAR = 24;
const BASE = 118;
const PLOT = 100;
const WIDTH = SLOT * DAYS;
const HEIGHT = 136;

const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' });

function toneFor(objectType: string): { color: string; fg: string; Icon: LucideIcon } {
  if (['dispatch', 'sales'].includes(objectType)) return { color: '#0f8b8d', fg: '#fff', Icon: Truck };
  if (['rfq', 'bid', 'supplier', 'purchase'].includes(objectType)) return { color: INDIGO, fg: '#fff', Icon: FileText };
  if (['qc', 'inspection'].includes(objectType)) return { color: '#f2a541', fg: '#1d1b19', Icon: ClipboardCheck };
  if (['claim', 'approval'].includes(objectType)) return { color: CORAL, fg: '#fff', Icon: ShieldAlert };
  return { color: '#8e5bb5', fg: '#fff', Icon: Bell };
}

/** Counts up from the previous value over ~600ms with requestAnimationFrame; jumps straight there under reduced motion. */
function useCountUp(target: number, duration = 600) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setValue(target); return; }
    let from = 0;
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = Math.round(from + (target - from) * eased);
      from = next;
      setValue(next);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

/** Notices bucketed per Karachi calendar day for the last seven days, oldest first. */
function buildDays(notices: Notice[], language: Language) {
  const weekday = new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-GB', { weekday: 'short', timeZone: 'Asia/Karachi' });
  const now = Date.now();
  const days = Array.from({ length: DAYS }, (_, i) => {
    const ms = now - (DAYS - 1 - i) * 86_400_000;
    return { key: dayKey.format(ms), label: weekday.format(ms), unread: 0, read: 0 };
  });
  for (const notice of notices) {
    const day = days.find(d => d.key === dayKey.format(notice.created_at));
    if (day) day[notice.status === 'unread' ? 'unread' : 'read'] += 1;
  }
  return days;
}

function ago(ms: number, language: Language, now: number) {
  const seconds = Math.round((ms - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs >= 7 * 86_400) return when.format(ms, language);
  const rtf = new Intl.RelativeTimeFormat(language === 'ur' ? 'ur-PK' : 'en', { numeric: 'auto' });
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86_400), 'day');
}

function NoticeRow({ notice, index, now, onOpen }: { notice: Notice; index: number; now: number; onOpen: (notice: Notice) => void }) {
  const { language, t } = useLanguage();
  const [en, ur] = eventTitle[notice.event] || [notice.event, notice.event];
  const { color, fg, Icon } = toneFor(notice.object_type);
  const unread = notice.status === 'unread';
  return <li style={{ '--d': `${index * 60}ms` } as CSSProperties}>
    <button className={`nw-row${unread ? ' is-unread' : ''}`} onClick={() => onOpen(notice)}>
      <span className="nw-chip" style={{ '--c': color, '--fg': fg } as CSSProperties}><Icon size={20} aria-hidden="true" /></span>
      <span className="nw-text">
        <span className="nw-title">{t(en, ur)}</span>
        <span className="nw-meta">{[notice.label, ago(notice.created_at, language, now)].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="nw-side">{unread && <span className="nw-unread-dot" aria-label={t('Unread', 'غیر پڑھی')} />}</span>
    </button>
  </li>;
}

export function NoticeWidget({ member, inbox, reload }: { member: Member; inbox: Inbox; reload: () => Promise<void> }) {
  const { language, t } = useLanguage();
  const open = useOpen(member, reload);
  const shown = useCountUp(inbox.unread);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const days = useMemo(() => buildDays(inbox.notifications, language), [inbox.notifications, language]);
  const max = Math.max(1, ...days.map(d => d.unread + d.read));
  const latest = inbox.notifications.slice(0, 6);
  const now = Date.now();
  const unreadWord = t('unread', 'غیر پڑھی');
  const readWord = t('read', 'پڑھی');
  const activeDay = active === null ? null : days[active];

  const markAllRead = async () => {
    setBusy(true);
    try { await portal('/notifications/read', { all: true }); await reload(); } finally { setBusy(false); }
  };

  return <section className="nw-card" aria-label={t('Notifications overview', 'اطلاعات کا خلاصہ')}>
    <div className="nw-head">
      <div className="nw-count-wrap">
        {inbox.unread > 0 && <span className="nw-pulse" aria-hidden="true" />}
        <div>
          <div className="nw-count" aria-live="polite">{shown}</div>
          <div className="nw-count-label">{t('Unread', 'غیر پڑھی')}</div>
        </div>
      </div>
      <button className="nw-read-all" onClick={() => void markAllRead()} disabled={inbox.unread === 0 || busy} aria-label={t('Mark all as read', 'سب کو پڑھا ہوا کریں')} title={t('Mark all as read', 'سب کو پڑھا ہوا کریں')}>
        <CheckCheck size={18} aria-hidden="true" />
      </button>
    </div>

    <div className={`nw-chart${active !== null ? ' has-active' : ''}`}>
      {activeDay && <div className="nw-tip" style={{ left: `${Math.min(86, Math.max(14, (active! + 0.5) / DAYS * 100))}%` }} aria-hidden="true">
        <b>{activeDay.label}</b>
        <span><i className="nw-dot" style={{ background: CORAL }} />{activeDay.unread} {unreadWord}</span>
        <span><i className="nw-dot" style={{ background: INDIGO }} />{activeDay.read} {readWord}</span>
      </div>}
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label={t('Notifications per day, last 7 days', 'پچھلے 7 دنوں کی اطلاعات')}>
        <line className="nw-baseline" x1={0} x2={WIDTH} y1={BASE} y2={BASE} />
        {days.map((day, i) => {
          const unreadH = (day.unread / max) * PLOT;
          const readH = (day.read / max) * PLOT;
          const x = i * SLOT + (SLOT - BAR) / 2;
          return <g key={day.key} className={`nw-col${active === i ? ' is-on' : ''}`} tabIndex={0} role="img"
            aria-label={`${day.label}: ${day.unread} ${unreadWord}, ${day.read} ${readWord}`}
            onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)} onBlur={() => setActive(null)}>
            <rect x={i * SLOT} y={0} width={SLOT} height={HEIGHT} fill="transparent" />
            {unreadH > 0 && <rect className="nw-bar" style={{ animationDelay: `${i * 70}ms` }} x={x} y={BASE - unreadH} width={BAR} height={unreadH} rx={5} fill={CORAL} />}
            {readH > 0 && <rect className="nw-bar" style={{ animationDelay: `${i * 70 + 60}ms` }} x={x} y={BASE - unreadH - readH} width={BAR} height={readH} rx={5} fill={INDIGO} />}
            <text x={i * SLOT + SLOT / 2} y={HEIGHT - 2}>{day.label}</text>
          </g>;
        })}
      </svg>
      <div className="nw-legend" aria-hidden="true">
        <span><i className="nw-dot" style={{ background: CORAL }} />{t('Unread', 'غیر پڑھی')}</span>
        <span><i className="nw-dot" style={{ background: INDIGO }} />{t('Read', 'پڑھی')}</span>
      </div>
    </div>

    {latest.length
      ? <ul className="nw-list">{latest.map((notice, i) => <NoticeRow key={notice.id} notice={notice} index={i} now={now} onOpen={notice => void open(notice)} />)}</ul>
      : <p className="nw-empty">{t('Nothing new yet', 'ابھی کچھ نیا نہیں')}</p>}
  </section>;
}
