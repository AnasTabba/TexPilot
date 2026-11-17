import { useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import { useLanguage } from './i18n';
import { eventTitle } from './roles';
import type { Notice } from './Notifications';
import { when } from './WorkspaceDashboard';
import './notice-toast.css';

const SHOWN_MS = 5000;

/** A small top-right note for a newly arrived notice: it clears itself and opens the inbox when pressed. */
export function NoticeToast({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  const { t, language } = useLanguage();
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(onDismiss, SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [notice, onDismiss]);
  if (!notice) return null;
  const [en, ur] = eventTitle[notice.event] || [notice.event, notice.event];
  return <div className="notice-toast-wrap" role="status" aria-live="polite">
    <div className="notice-toast">
      <Bell size={20} aria-hidden="true" />
      <div className="notice-toast-copy">
        <strong>{t(en, ur)}</strong>
        {notice.label && <span className="notice-toast-detail">{notice.label}</span>}
        <time dateTime={new Date(notice.created_at).toISOString()}>{when.format(notice.created_at, language)}</time>
      </div>
      <button className="notice-toast-open" onClick={() => { location.hash = '#/notifications'; onDismiss(); }}>{t('Open', 'کھولیں')}</button>
      <button className="notice-toast-dismiss" aria-label={t('Dismiss notification', 'اطلاع بند کریں')} onClick={onDismiss}><X size={20} aria-hidden="true" /></button>
    </div>
  </div>;
}
