import { CheckCheck, Download } from 'lucide-react';
import { LanguageSelect, useLanguage } from './i18n';
import { can, roleLabel, type WorkspaceState } from './inventory-client';
import { accessSummary, permissionInfo } from './Team';

/** What Settings held: language, who you are and what you may record, the admin backup, and the shared record counts. */
export default function Profile({ state, backupBusy, onBackup }: { state: WorkspaceState; backupBusy: boolean; onBackup: () => void }) {
  const { t, language } = useLanguage();
  const me = state.member;
  return <div className="yf-settings">
    <section className="live-panel yf-language-settings"><h2>{t('Language', 'زبان')}</h2><LanguageSelect /></section>
    <section className="live-panel"><h2>{t('Your role', 'آپ کا کردار')}</h2><p><strong>{me.name}</strong> · {t(...roleLabel[me.role])}</p>
      <p>{accessSummary(me.role, language)}{t('. Everyone can view stock and use the scanner.')}</p>
      <ul className="yf-access">{permissionInfo.map(([id, label, , Icon]) => <li key={id} className={can(me, id) ? 'is-on' : ''}><Icon size={20} aria-hidden="true" /><span>{t(label)}</span>{can(me, id) ? <CheckCheck size={18} aria-label={t('Allowed')} /> : <span className="live-muted">{t('Ask an admin')}</span>}</li>)}</ul>
      {me.admin && <><h3 className="live-subheading">{t('Backup')}</h3><p>{t("Everyone's entries live in one shared database. Download a copy for your records.")}</p><div className="live-actions"><button className="button primary" onClick={onBackup} disabled={backupBusy}><Download size={20} aria-hidden="true" />{backupBusy ? t('Preparing backup…') : t('Download backup')}</button></div></>}
    </section>
    <section className="live-panel yf-records"><h2>{t('Shared records')}</h2><dl className="yf-counts">{([[t('Materials'), state.products.length], [t('Batches'), state.lots.length], [t('Stock movements'), state.movements.length], [t('Inspections'), state.inspections.length], [t('QC decisions'), state.qualityEvents.length], [t('People'), state.members.length]] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl></section>
  </div>;
}
