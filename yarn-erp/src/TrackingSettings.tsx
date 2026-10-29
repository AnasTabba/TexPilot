import { useEffect, useId, useState, type CSSProperties, type FormEvent } from 'react';
import { ChevronDown, CircleAlert, CircleCheck, KeyRound, LoaderCircle, Plug, RefreshCw, Save } from 'lucide-react';
import { InventoryError } from './inventory-client';
import { portal } from './PortalCommon';
import { Field, errorMessage } from './forms';
import { useLanguage } from './i18n';
import { factoryTime } from './erp-client';
import type { TrackingContract, TrackingSettings as SettingsData, TrackingStatus } from './tracking';
import './shipment-tracking.css';

interface Loaded { settings: SettingsData; status: TrackingStatus }

/** Form state: every number and path is a string until it is sent. */
interface Draft {
  enabled: boolean; baseUrl: string; trackPath: string; requestNumber: string; requestType: string; bolValue: string;
  containers: string; containerNumber: string; reference: string; events: string; eventTime: string; eventTitle: string; eventCode: string; eventLocation: string;
  eta: string; origin: string; destination: string; vessel: string; carrier: string; dataTimestamp: string;
  refreshHours: string; dailyBudget: string; verified: boolean;
}
type TextKey = Exclude<keyof Draft, 'enabled' | 'verified'>;
interface Spec { key: TextKey; en: string; ur: string; type?: 'text' | 'url' | 'number'; required?: boolean; min?: number; max?: number; help?: 'path' | 'item' }

const CONNECTION: Spec[] = [
  { key: 'baseUrl', en: 'Base URL', ur: 'بنیادی URL', type: 'url', required: true },
  { key: 'trackPath', en: 'Track path', ur: 'ٹریک کرنے کا راستہ', required: true },
  { key: 'requestNumber', en: 'Request field for the BL number', ur: 'BL نمبر کا request فیلڈ', required: true },
  { key: 'requestType', en: 'Request type field (optional)', ur: 'request قسم کا فیلڈ (اختیاری)' },
  { key: 'bolValue', en: 'Type value for bills of lading (optional)', ur: 'بل آف لیڈنگ کی قسم کی قدر (اختیاری)' },
];
const RESPONSE: Spec[] = [
  { key: 'containers', en: 'Containers', ur: 'کنٹینرز', required: true, help: 'path' },
  { key: 'containerNumber', en: 'Container number', ur: 'کنٹینر نمبر', help: 'item' },
  { key: 'reference', en: 'Reference', ur: 'حوالہ', required: true, help: 'path' },
  { key: 'events', en: 'Events list', ur: 'واقعات کی فہرست', required: true, help: 'path' },
  { key: 'eventTime', en: 'Event time', ur: 'واقعے کا وقت', required: true, help: 'item' },
  { key: 'eventTitle', en: 'Event title', ur: 'واقعے کا عنوان', required: true, help: 'item' },
  { key: 'eventCode', en: 'Event code', ur: 'واقعے کا کوڈ', help: 'item' },
  { key: 'eventLocation', en: 'Event location', ur: 'واقعے کی جگہ', help: 'item' },
  { key: 'eta', en: 'ETA', ur: 'متوقع پہنچ (ETA)', help: 'path' },
  { key: 'origin', en: 'Origin', ur: 'روانگی کی جگہ', help: 'path' },
  { key: 'destination', en: 'Destination', ur: 'منزل', help: 'path' },
  { key: 'vessel', en: 'Vessel', ur: 'جہاز', help: 'path' },
  { key: 'carrier', en: 'Carrier', ur: 'کیریئر', help: 'path' },
  { key: 'dataTimestamp', en: 'Data timestamp', ur: 'ڈیٹا کا وقت', help: 'path' },
];
const REFRESH: Spec[] = [
  { key: 'refreshHours', en: 'Refresh every (hours, 1 to 168)', ur: 'ہر (گھنٹے، 1 سے 168)', type: 'number', required: true, min: 1, max: 168 },
  { key: 'dailyBudget', en: 'Daily call budget (0 to 1000, 0 is off)', ur: 'روزانہ کالز کی حد (0 سے 1000، 0 مطلب بند)', type: 'number', required: true, min: 0, max: 1000 },
];

function toDraft(settings: SettingsData): Draft {
  const req = settings.contract?.request, res = settings.contract?.response;
  return {
    enabled: settings.enabled, baseUrl: settings.baseUrl, trackPath: settings.trackPath,
    requestNumber: req?.number ?? '', requestType: req?.type ?? '', bolValue: req?.types?.bol ?? '',
    containers: res?.containers ?? '', containerNumber: res?.containerNumber ?? '', reference: res?.reference ?? '', events: res?.events ?? '',
    eventTime: res?.event?.time ?? '', eventTitle: res?.event?.title ?? '', eventCode: res?.event?.code ?? '', eventLocation: res?.event?.location ?? '',
    eta: res?.eta ?? '', origin: res?.origin ?? '', destination: res?.destination ?? '', vessel: res?.vessel ?? '', carrier: res?.carrier ?? '', dataTimestamp: res?.dataTimestamp ?? '',
    refreshHours: String(settings.refreshHours), dailyBudget: String(settings.dailyBudget), verified: false,
  };
}

/** Keeps request and response fields this form does not show (carrier, force, extras) from the stored contract. */
function toPayload(d: Draft, prev: TrackingContract | null) {
  const opt = (value: string) => value.trim() || undefined;
  const req = prev?.request, res = prev?.response;
  const contract: TrackingContract = {
    request: { ...req, number: d.requestNumber.trim(), type: opt(d.requestType), types: opt(d.bolValue) ? { ...req?.types, bol: d.bolValue.trim() } : undefined },
    response: {
      ...res, containers: d.containers.trim(), containerNumber: opt(d.containerNumber), reference: d.reference.trim(), events: d.events.trim(),
      event: { ...res?.event, time: d.eventTime.trim(), title: d.eventTitle.trim(), code: opt(d.eventCode), location: opt(d.eventLocation) },
      dataTimestamp: opt(d.dataTimestamp), eta: opt(d.eta), origin: opt(d.origin), destination: opt(d.destination), vessel: opt(d.vessel), carrier: opt(d.carrier),
    },
  };
  return { enabled: d.enabled, baseUrl: d.baseUrl.trim(), trackPath: d.trackPath.trim(), contract, refreshHours: Number(d.refreshHours), dailyBudget: Number(d.dailyBudget), verified: true };
}

function StatusRow({ status }: { status: TrackingStatus }) {
  const { t } = useLanguage();
  const gaps = status.contractGaps;
  const ratio = status.dailyBudget > 0 ? Math.min(1, status.callsToday / status.dailyBudget) : 0;
  const level = ratio >= 1 ? 'full' : ratio >= 0.8 ? 'high' : 'ok';
  return <div className="trk-set-status">
    <ul className="trk-set-chips">
      <li className={`trk-set-chip ${status.keyConfigured ? 'is-ok' : 'is-warn'}`}>
        <KeyRound size={16} aria-hidden="true" /><span>{t('API key', 'API کی')}</span>
        <strong>{status.keyConfigured ? t('set', 'موجود') + (status.keyHint ? ` …${status.keyHint}` : '') : t('not set', 'موجود نہیں')}</strong>
      </li>
      <li className={`trk-set-chip ${gaps.length ? 'is-warn' : 'is-ok'}`}>
        <Plug size={16} aria-hidden="true" /><span>{t('Provider details', 'فراہم کنندہ کی تفصیل')}</span>
        <strong>{gaps.length ? t(`${gaps.length} missing`, `${gaps.length} غائب`) : t('complete', 'مکمل')}</strong>
        {gaps.length > 0 && <ul className="trk-set-gaps">{gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>}
      </li>
      <li className={`trk-set-chip ${status.enabled ? 'is-ok' : ''}`}>
        <RefreshCw size={16} aria-hidden="true" /><span>{t('Auto refresh', 'خودکار تازہ کاری')}</span>
        <strong>{status.enabled ? t(`on every ${status.refreshHours} h`, `ہر ${status.refreshHours} گھنٹے`) : t('off', 'بند')}</strong>
      </li>
    </ul>
    <p className="trk-set-meter-row">{t(`Calls today: ${status.callsToday} of ${status.dailyBudget}`, `آج کی کالز: ${status.callsToday} از ${status.dailyBudget}`)}</p>
    <div className="trk-set-meter" data-level={level} aria-hidden="true"><span style={{ '--p': ratio } as CSSProperties} /></div>
  </div>;
}

function ReadOnly({ settings }: { settings: SettingsData }) {
  const { t } = useLanguage();
  return <>
    <dl className="trk-set-summary">
      <div><dt>{t('Base URL', 'بنیادی URL')}</dt><dd className="trk-mono">{settings.baseUrl || '—'}</dd></div>
      <div><dt>{t('Track path', 'ٹریک کرنے کا راستہ')}</dt><dd className="trk-mono">{settings.trackPath || '—'}</dd></div>
      <div><dt>{t('Auto refresh', 'خودکار تازہ کاری')}</dt><dd>{settings.enabled ? t(`every ${settings.refreshHours} h`, `ہر ${settings.refreshHours} گھنٹے`) : t('off', 'بند')}</dd></div>
      <div><dt>{t('Daily call budget', 'روزانہ کالز کی حد')}</dt><dd>{settings.dailyBudget || t('off', 'بند')}</dd></div>
    </dl>
    <p className="trk-muted">{t('Only an admin can change these settings.', 'یہ ترتیبات صرف ایڈمن بدل سکتا ہے۔')}</p>
  </>;
}

function SettingsForm({ settings, onSaved }: { settings: SettingsData; onSaved: (result: Loaded) => void }) {
  const { t, language } = useLanguage();
  const [draft, setDraft] = useState(() => toDraft(settings));
  const [current, setCurrent] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(prev => ({ ...prev, [key]: value }));

  const input = (spec: Spec) => <div className="trk-set-cell" key={spec.key}>
    <Field>{t(spec.en, spec.ur)}<input type={spec.type ?? 'text'} value={draft[spec.key]} onChange={event => set(spec.key, event.target.value)} required={spec.required} min={spec.min} max={spec.max} /></Field>
    {spec.help && <small className="trk-set-help">{spec.help === 'item' ? t('Path inside each item, like eventTime', 'ہر آئٹم کے اندر راستہ، جیسے eventTime') : t('Dot path inside the JSON, like data.events', 'JSON کے اندر ڈاٹ راستہ، جیسے data.events')}</small>}
  </div>;

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setSaved(false); setSaveError(null);
    try {
      const result = await portal<Loaded>('/tracking/settings', toPayload(draft, current.contract));
      setCurrent(result.settings); setDraft(toDraft(result.settings)); setSaved(true); onSaved(result);
    } catch (failure) {
      setSaveError(failure);
    } finally { setSaving(false); }
  }

  return <form className="trk-set-form" onSubmit={save}>
    <h3 className="trk-set-group">{t('Connection', 'کنکشن')}</h3>
    <div className="trk-set-grid">{CONNECTION.map(input)}</div>
    <h3 className="trk-set-group">{t('Response paths', 'جوابی راستے')}</h3>
    <div className="trk-set-grid">{RESPONSE.map(input)}</div>
    <h3 className="trk-set-group">{t('Refresh', 'تازہ کاری')}</h3>
    <div className="trk-set-grid">
      <label className="trk-set-toggle"><input type="checkbox" role="switch" checked={draft.enabled} onChange={event => set('enabled', event.target.checked)} /><span>{t('Auto refresh is on', 'خودکار تازہ کاری چالو ہے')}</span></label>
      {REFRESH.map(input)}
    </div>
    <label className="trk-set-check"><input type="checkbox" checked={draft.verified} required onChange={event => set('verified', event.target.checked)} /><span>{t('I checked these fields against the provider’s API documentation', 'میں نے یہ خانے فراہم کنندہ کی API دستاویزات سے ملا لیے ہیں')}</span></label>
    <div className="trk-set-actions">
      <button type="submit" className="trk-btn" disabled={saving}>
        {saving ? <LoaderCircle size={16} className="trk-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
        {saving ? t('Saving…', 'محفوظ ہو رہا ہے…') : t('Save settings', 'ترتیبات محفوظ کریں')}
      </button>
      {saved && <span className="trk-set-ok" role="status"><CircleCheck size={16} aria-hidden="true" />{t('Saved. Auto refresh follows these settings.', 'محفوظ ہو گیا۔ خودکار تازہ کاری اب انہی ترتیبات پر ہوگی۔')}</span>}
    </div>
    {saveError ? <p className="live-error" role="alert"><CircleAlert size={18} aria-hidden="true" />{errorMessage(saveError, language)}</p> : null}
    {current.verifiedAt !== null && <p className="trk-muted">{t('Last checked against the docs', 'آخری بار دستاویزات سے ملایا گیا')} {factoryTime(current.verifiedAt)}</p>}
  </form>;
}

/**
 * Connection settings for the shipment tracker. Non-admins see a read-only summary; admins get the form.
 * Never sends or shows the API key: the key lives on the server as a secret and only its hint is shown.
 */
export function TrackingSettings({ isAdmin, onStatus }: { isAdmin: boolean; onStatus?: (status: TrackingStatus) => void }) {
  const { t, language } = useLanguage();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<boolean | null>(null);
  const bodyId = useId();

  useEffect(() => {
    let alive = true;
    portal<Loaded>('/tracking/settings')
      .then(result => { if (alive) setLoaded(result); })
      .catch(failure => {
        if (!alive) return;
        // The endpoint ships with the backend; until then the panel stays out of the way.
        if (failure instanceof InventoryError && failure.status === 404) setMissing(true);
        else setLoadError(failure);
      });
    return () => { alive = false; };
  }, []);

  if (missing) return null;
  const status = loaded?.status ?? null;
  // Collapsed once configured, open while it still needs setting up.
  const expanded = open ?? (status ? !status.configured : false);
  const summary = status ? [
    status.configured ? t('Configured', 'ترتیب شدہ') : t('Not configured yet', 'ابھی ترتیب نہیں دی گئی'),
    status.enabled ? t(`auto refresh every ${status.refreshHours} h`, `ہر ${status.refreshHours} گھنٹے خودکار تازہ کاری`) : t('auto refresh off', 'خودکار تازہ کاری بند'),
  ].join(' · ') : '';

  return <section className="trk-set" aria-label={t('Connection settings', 'کنکشن کی ترتیبات')}>
    <button type="button" className="trk-set-head" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setOpen(!expanded)}>
      <span className="trk-set-title"><Plug size={18} aria-hidden="true" /><strong>{t('Connection settings', 'کنکشن کی ترتیبات')}</strong></span>
      {!expanded && summary && <span className="trk-muted">{summary}</span>}
      <ChevronDown size={18} aria-hidden="true" className={expanded ? 'is-open' : undefined} />
    </button>
    {expanded && <div className="trk-set-body" id={bodyId}>
      {loadError ? <p className="live-error" role="alert">{errorMessage(loadError, language)}</p> : null}
      {!loaded && !loadError && <p className="live-muted" role="status">{t('Loading connection settings…', 'کنکشن کی ترتیبات لوڈ ہو رہی ہیں…')}</p>}
      {loaded && <>
        <StatusRow status={loaded.status} />
        {!loaded.status.keyConfigured && <p className="trk-set-note">{t('The API key is stored as a secure server secret (DATALOOPLABS_API_KEY). Send it to your developer; it never appears in the app.', 'API کی ایک محفوظ سرور سیکرٹ (DATALOOPLABS_API_KEY) کے طور پر رکھی جاتی ہے۔ اسے اپنے ڈویلپر کو بھیجیں؛ یہ ایپ میں کبھی نہیں دکھائی جاتی۔')}</p>}
        {isAdmin
          ? <SettingsForm settings={loaded.settings} onSaved={result => { setLoaded(result); onStatus?.(result.status); }} />
          : <ReadOnly settings={loaded.settings} />}
      </>}
    </div>}
  </section>;
}
