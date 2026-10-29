import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { BellOff, Bell, CheckCheck, ClipboardCheck, FileText, Factory, ListChecks, ShieldAlert, Truck, Wallet, type LucideIcon } from 'lucide-react';
import { portal } from './PortalCommon';
import { useOpen, type Inbox, type Notice } from './Notifications';
import { useLanguage } from './i18n';
import { eventTitle } from './roles';
import { when } from './WorkspaceDashboard';
import type { Member } from './inventory-client';
import './notice-widget.css';

const LIMIT = 8;

type Tone = 'kraft' | 'ok' | 'warn' | 'bad' | 'ink';
// Icon and tone follow the event kind, so each row reads at a glance. Tones are theme tokens (see .nw-chip in notice-widget.css).
function kindFor(event: string): { Icon: LucideIcon; tone: Tone } {
  if (/^(qc\.|inspection\.|lot\.|stock\.ready_for_production)/.test(event)) return { Icon: ClipboardCheck, tone: 'ok' };
  if (/^(approval|award\.pending|supplier\.pending|buyer\.pending|dispatch\.(approval_requested|held))/.test(event)) return { Icon: ListChecks, tone: 'warn' };
  if (/^stock(_|\.)/.test(event)) return { Icon: Factory, tone: 'kraft' };
  if (/^(dispatch|shipment)\./.test(event)) return { Icon: Truck, tone: 'ink' };
  if (/^(po\.|rfq|bid|bidding|buyer_rfq|award\.|supplier\.rated)/.test(event)) return { Icon: FileText, tone: 'kraft' };
  if (/^claim\./.test(event) || event === 'payment.overdue') return { Icon: ShieldAlert, tone: 'bad' };
  if (/^payment\./.test(event)) return { Icon: Wallet, tone: 'warn' };
  return { Icon: Bell, tone: 'ink' };
}

function NoticeRow({ notice, index, onOpen }: { notice: Notice; index: number; onOpen: (notice: Notice) => void }) {
  const { language, t } = useLanguage();
  const [en, ur] = eventTitle[notice.event] || [notice.event, notice.event];
  const { Icon, tone } = kindFor(notice.event);
  const unread = notice.status === 'unread';
  const title = t(en, ur);
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(notice); }
  };
  return <tr className={`nw-row${unread ? ' is-unread' : ''}`} role="button" tabIndex={0} style={{ '--d': `${index * 60}ms` } as CSSProperties}
    onClick={() => onOpen(notice)} onKeyDown={onKeyDown}>
    <td>
      <div className="nw-name">
        <span className={`nw-chip is-${tone}`}><Icon size={18} aria-hidden="true" /></span>
        <span className="nw-text">
          <span className="nw-title" title={title}>{title}</span>
          <span className="nw-detail" title={notice.label}>{notice.label}</span>
        </span>
      </div>
    </td>
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
      ? <div className="nw-scroll"><table className="nw-table">
        <thead><tr>
          <th scope="col">{t('Notification', 'اطلاع')}</th>
          <th scope="col">{t('Time', 'وقت')}</th>
          <th scope="col">{t('Status', 'حیثیت')}</th>
        </tr></thead>
        <tbody>{unread.map((notice, i) => <NoticeRow key={notice.id} notice={notice} index={i} onOpen={notice => void open(notice)} />)}</tbody>
      </table></div>
      : <div className="nw-empty">
        <BellOff size={36} aria-hidden="true" />
        <p>{t('No new notifications', 'کوئی نئی اطلاع نہیں')}</p>
      </div>}
  </section>;
}
