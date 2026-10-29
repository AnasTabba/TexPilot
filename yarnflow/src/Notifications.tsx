import { CheckCheck, ChevronRight } from 'lucide-react';
import { NextStep, StatusTag, portal } from './PortalCommon';
import { when } from './WorkspaceDashboard';
import { useLanguage } from './i18n';
import { eventTitle, INSTALLED_MODULES, objectRoute } from './roles';
import type { Member } from './inventory-client';

export interface Notice { id: string; event: string; object_type: string; object_id: string; label: string; status: 'unread' | 'read'; created_at: number }
export interface Inbox { notifications: Notice[]; unread: number }

/** Opens the notification's item and marks it read; the new hash is chosen before the read finishes. */
function useOpen(member: Member, reload: () => Promise<void>) {
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

/** Every role's dashboard until its own task replaces it: the oldest unread notification as the next step, then the newest five. */
export function Dashboard({ member, inbox, reload }: { member: Member; inbox: Inbox; reload: () => Promise<void> }) {
  const { t } = useLanguage();
  const open = useOpen(member, reload);
  const oldest = [...inbox.notifications].reverse().find(notice => notice.status === 'unread');
  const [en, ur] = oldest ? eventTitle[oldest.event] || [oldest.event, oldest.event] : ['', ''];
  return <div className="yf-home">
    {oldest ? <NextStep tone="warn" title={t(`Next: ${en}`, `اگلا کام: ${ur}`)} reason={oldest.label} action={<button className="button primary" onClick={() => void open(oldest)}>{t('Open', 'کھولیں')}</button>} />
      : <NextStep tone="ok" title={t('Nothing is waiting for you', 'آپ کا کوئی کام باقی نہیں')} reason={t('New items will appear here and in Notifications.', 'نئی چیزیں یہاں اور اطلاعات میں نظر آئیں گی۔')} />}
    <section className="yf-section" aria-labelledby="yf-latest-title">
      <div className="yf-head"><h2 id="yf-latest-title">{t('Latest notifications', 'تازہ اطلاعات')}</h2><button className="live-text-button" onClick={() => { location.hash = '#/notifications'; }}>{t('See all', 'سب دیکھیں')}</button></div>
      {inbox.notifications.length ? <ul className="yf-inbox">{inbox.notifications.slice(0, 5).map(notice => <Row key={notice.id} notice={notice} onOpen={notice => void open(notice)} />)}</ul>
        : <p className="live-muted">{t('No notifications yet', 'ابھی کوئی اطلاع نہیں')}</p>}
    </section>
  </div>;
}
