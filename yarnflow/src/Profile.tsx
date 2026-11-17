import { useState } from 'react';
import { Download, UserRound, Languages } from 'lucide-react';
import { errorMessage } from './forms';
import { useLanguage } from './i18n';
import { inventoryRequest, roleLabel, type WorkspaceState } from './inventory-client';
import { ChoiceTiles, Section } from './ui';

/** Admin-only: asks the server whether the optional InvenTree link answers. */
function InventreeCheck() {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false); const [result, setResult] = useState('');
  async function check() {
    setBusy(true);
    try {
      const found = await inventoryRequest<{ connected: boolean; reason?: string }>('/integrations/inventree');
      setResult(found.connected ? 'InvenTree is connected.' : found.reason || 'InvenTree answered, but not with access.');
    } catch (error) { setResult(errorMessage(error)); } finally { setBusy(false); }
  }
  return <Section title={t('InvenTree connection', 'InvenTree کا رابطہ')}>
    <button className="button" onClick={() => void check()} disabled={busy}>{busy ? t('Checking…', 'جانچ ہو رہی ہے…') : t('Check InvenTree', 'InvenTree جانچیں')}</button>
    {result && <p role="status">{t(result)}</p>}
  </Section>;
}

/** What Settings held: language, who you are and what you may record, the admin backup, and the shared record counts. */
export default function Profile({ state, backupBusy, onBackup }: { state: WorkspaceState; backupBusy: boolean; onBackup: () => void }) {
  const { t, language, setLanguage } = useLanguage();
  const me = state.member;
  return <div className="yf-profile">
    <Section title={t('Your profile', 'آپ کی پروفائل')}>
      <div className="yf-profile-identity"><UserRound aria-hidden="true"/><div><strong>{me.name}</strong><span>{t(...roleLabel[me.role])}</span></div></div>
    </Section>
    <Section title={t('Language', 'زبان')}>
      <ChoiceTiles label={t('Choose a language', 'زبان منتخب کریں')} value={language} onChange={v => setLanguage(v as 'en' | 'ur')} options={[{value:'en',title:'English',icon:<Languages/>},{value:'ur',title:'اردو',icon:<Languages/>}]} />
    </Section>
    {me.admin && <Section title={t('Backup', 'بیک اپ')}>
      <button className="button primary" onClick={onBackup} disabled={backupBusy}><Download size={20} aria-hidden="true" />{backupBusy ? t('Preparing backup…', 'بیک اپ تیار ہو رہا ہے…') : t('Download backup', 'بیک اپ ڈاؤن لوڈ کریں')}</button>
    </Section>}
    {me.admin && <InventreeCheck />}
  </div>;
}
