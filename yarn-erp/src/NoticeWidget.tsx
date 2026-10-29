import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Bell, BellOff, CheckCheck, ClipboardCheck, FileText, ShieldAlert, Truck, type LucideIcon } from 'lucide-react';
import { portal } from './PortalCommon';
import { useOpen, type Inbox, type Notice } from './Notifications';
import { useLanguage } from './i18n';
import { eventTitle } from './roles';
import { when } from './WorkspaceDashboard';
import type { Member } from './inventory-client';
import './notice-widget.css';

const CORAL = '#e4572e';
const LIMIT = 8;

function toneFor(objectType: string): { color: string; fg: string; Icon: LucideIcon } {
  if (['dispatch', 'sales'].includes(objectType)) return { color: '#0f8b8d', fg: '#fff', Icon: Truck };
  if (['rfq', 'bid', 'supplier', 'purchase'].includes(objectType)) return { color: '#4f5bd5', fg: '#fff', Icon: FileText };
  if (['qc', 'inspection'].includes(objectType)) return { color: '#f2a541', fg: '#1d1b19', Icon: ClipboardCheck };
  if (['claim', 'approval'].includes(objectType)) return { color: CORAL, fg: '#fff', Icon: ShieldAlert };
  return { color: '#8e5bb5', fg: '#fff', Icon: Bell };
}

function NoticeRow({ notice, index, onOpen }: { notice: Notice; index: number; onOpen: (notice: Notice) => void }) {
  const { language, t } = useLanguage();
  const [en, ur] = eventTitle[notice.event] || [notice.event, notice.event];
  const { color, fg, Icon } = toneFor(notice.object_type);
  const unread = notice.status === 'unread';
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(notice); }
  };
  return <tr className={`nw-row${unread ? ' is-unread' : ''}`} role="button" tabIndex={0} style={{ '--d': `${index * 60}ms` } as CSSProperties}
    onClick={() => onOpen(notice)} onKeyDown={onKeyDown}>
    <td className="nw-name">
      <span className="nw-chip" style={{ '--c': color, '--fg': fg } as CSSProperties}><Icon size={18} aria-hidden="true" /></span>
      <span className="nw-title">{t(en, ur)}</span>
    </td>
    <td className="nw-detail">{notice.label}</td>
    <td className="nw-time">{when.format(notice.created_at, language)}</td>
    <td><span className={`nw-pill ${unread ? 'is-unread' : 'is-read'}`}>{unread ? t('Unread', 'غیر پڑھی') : t('Read', 'پڑھی')}</span></td>
  </tr>;
}

export function NoticeWidget({ member, inbox, reload }: { member: Member; inbox: Inbox; reload: () => Promise<void> }) {
  const { t } = useLanguage();
  const open = useOpen(member, reload);
  const [busy, setBusy] = useState(false);
  const unread = inbox.notifications.filter(notice => notice.status === 'unread').slice(0, LIMIT);

  const clearAll = async () => {
    setBusy(true);
    try { await portal('/notifications/read', { all: true }); await reload(); } finally { setBusy(false); }
  };

  return <section className="nw-card" aria-label={t('Notifications', 'اطلاعات')}>
    <div className="nw-head">
      <div className="nw-title-wrap">
        <h2>{t('Notifications', 'اطلاعات')}</h2>
        {inbox.unread > 0 && <span className="nw-badge" aria-live="polite">{inbox.unread}</span>}
      </div>
      <div className="nw-actions">
        {inbox.unread > 0 && <button className="nw-text-btn" onClick={() => void clearAll()} disabled={busy}>
          <CheckCheck size={16} aria-hidden="true" />{t('Clear notifications', 'اطلاعات صاف کریں')}
        </button>}
        <button className="nw-text-btn" onClick={() => { location.hash = '#/notifications'; }}>{t('See all', 'سب دیکھیں')}</button>
      </div>
    </div>

    {unread.length
      ? <table className="nw-table">
        <thead><tr>
          <th scope="col">{t('Notification', 'اطلاع')}</th>
          <th scope="col" className="nw-detail">{t('Details', 'تفصیل')}</th>
          <th scope="col">{t('Time', 'وقت')}</th>
          <th scope="col">{t('Status', 'حیثیت')}</th>
        </tr></thead>
        <tbody>{unread.map((notice, i) => <NoticeRow key={notice.id} notice={notice} index={i} onOpen={notice => void open(notice)} />)}</tbody>
      </table>
      : <div className="nw-empty">
        <BellOff size={36} aria-hidden="true" />
        <p>{t('No new notifications', 'کوئی نئی اطلاع نہیں')}</p>
      </div>}
  </section>;
}
