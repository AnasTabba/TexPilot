import { useEffect } from 'react';
import { Bell } from 'lucide-react';
import { useLanguage } from './i18n';
import { eventTitle } from './roles';
import type { Notice } from './Notifications';
import './notice-toast.css';

const SHOWN_MS = 5000;

/** A small top-right note for a newly arrived notice: it clears itself and opens the inbox when pressed. */
export function NoticeToast({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  const { t } = useLanguage();
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(onDismiss, SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [notice, onDismiss]);
  if (!notice) return null;
  const [en, ur] = eventTitle[notice.event] || [notice.event, notice.event];
  return <div className="notice-toast-wrap" role="status" aria-live="polite">
    <button className="notice-toast" onClick={() => { location.hash = '#/notifications'; onDismiss(); }}>
      <Bell size={18} aria-hidden="true" /><span>{t(en, ur)}</span>
    </button>
  </div>;
}
