import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Camera, ChevronRight, Factory, FileText, Package, Send, Truck, UserRound, ClipboardCheck, X } from 'lucide-react';
import { Avatar } from './SignIn';
import { errorMessage } from './forms';
import { portal } from './PortalCommon';
import { useLanguage } from './i18n';
import { roleLabel, type Member, type Role, type WorkspaceState } from './inventory-client';
import { downloadInvoicePdf, invoiceDocData, type BuyerSource, type InvoiceSource, type SaleLineSource } from './invoice-pdf';
import './chat.css';

type RefType = 'invoice' | 'shipment' | 'sale' | 'buyer' | 'inspection' | 'lot';
interface ChatRef { type: RefType; id: string; label: string; detail?: unknown; capturedAt?: number }
interface Message { id: string; seq: number; thread_id: string; user_id: string; sender_name: string; body: string; photo: boolean; ref: ChatRef | null; created_at: number }
interface Person { id: string; name: string; role: Role }
interface Thread { id: string; kind: 'team' | 'direct'; title: string; other: Person | null; last: Message | null; unread: number }
interface ChatList { threads: Thread[]; people: Person[]; unread: number }
interface ShareOption { id: string; type: RefType; label: string; detail: unknown }
interface SharedInvoiceDocument { invoice: InvoiceSource; lines: SaleLineSource[]; buyer: BuyerSource; factoryName: string }
type SendPayload = { body?: string; ref?: { type: RefType; id: string } };
type Attempt = { id: string; payload: SendPayload };
type PhotoAttempt = { id: string; file: File; caption: string };

const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' });
const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' });
const shortDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short' });
const stamp = (ms: number) => dayOf.format(ms) === dayOf.format(Date.now()) ? clock.format(ms) : shortDate.format(ms);
const quickReplies: [string, string][] = [['Done', 'ہو گیا'], ['On my way', 'آ رہا ہوں'], ['Need help', 'مدد چاہیے'], ['Stock arrived', 'مال آ گیا'], ['Check this', 'یہ دیکھیں']];
const photoUrl = (id: string) => `/api/erp/chat/photo/${id}`;
const shareTypes: { id: RefType; en: string; ur: string; Icon: typeof FileText }[] = [
  { id: 'invoice', en: 'Invoices', ur: 'انوائسز', Icon: FileText },
  { id: 'shipment', en: 'Shipments', ur: 'کھیپ', Icon: Truck },
  { id: 'sale', en: 'Sales orders', ur: 'فروخت کے آرڈر', Icon: Package },
  { id: 'buyer', en: 'Buyers', ur: 'خریدار', Icon: UserRound },
  { id: 'inspection', en: 'Inspections', ur: 'معائنے', Icon: ClipboardCheck },
  { id: 'lot', en: 'Stock batches', ur: 'اسٹاک بیچ', Icon: Factory },
];
type T = (english: string, urdu?: string) => string;

function preview(message: Message | null, t: T) {
  if (!message) return t('No messages yet', 'ابھی کوئی پیغام نہیں');
  if (message.body) return message.body.replace(/\s+/g, ' ');
  if (message.photo) return t('📷 Photo', '📷 تصویر');
  return message.ref?.label ?? '';
}

function draftKey(workspaceId: string, userId: string, threadId: string) {
  return `yf-chat-draft:${workspaceId}:${userId}:${threadId}`;
}
function readDraft(key: string) {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}
function readAttempt(key: string): Attempt | null {
  try {
    const value = JSON.parse(localStorage.getItem(`${key}:pending`) ?? 'null') as Attempt | null;
    return value && typeof value.id === 'string' && typeof value.payload === 'object' ? value : null;
  } catch { return null; }
}
function refDetails(type: RefType, detail: unknown, t: T, language: string) {
  if (!detail || typeof detail !== 'object') return typeof detail === 'string' ? detail : '';
  const row = detail as Record<string, unknown>;
  const value = (key: string) => typeof row[key] === 'string' || typeof row[key] === 'number' ? row[key] as string | number : '';
  const status = (raw: string | number) => {
    const labels: Record<string, [string, string]> = {
      active: ['Active', 'فعال'], pending: ['Pending review', 'جائزہ باقی'], approved: ['Approved', 'منظور شدہ'], rejected: ['Rejected', 'مسترد'],
      suspended: ['Suspended', 'معطل'], issued: ['Issued', 'جاری'], void: ['Voided', 'منسوخ'], confirmed: ['Confirmed', 'تصدیق شدہ'],
      partially_dispatched: ['Partially dispatched', 'جزوی روانگی'], dispatched: ['Dispatched', 'روانہ'], delivered: ['Delivered', 'پہنچایا گیا'],
      on_hold: ['On hold', 'روکی گئی'], in_transit: ['In transit', 'راستے میں'], accepted: ['Accepted', 'قبول شدہ'], held: ['Held', 'روکا گیا'],
      open: ['Open', 'کھلا'], complete: ['Complete', 'مکمل'], pass: ['Passed', 'منظور'], fail: ['Failed', 'ناکام'],
    };
    const label = labels[String(raw).toLowerCase()];
    return label ? t(...label) : String(raw);
  };
  const quantity = (raw: string | number, unit: string | number) => {
    const amount = Number(raw);
    return Number.isFinite(amount) && unit ? `${new Intl.NumberFormat(language === 'ur' ? 'ur-PK' : 'en-PK', { maximumFractionDigits: 3 }).format(amount / 1000)} ${unit}` : '';
  };
  const money = (raw: string | number, currency: string | number) => {
    const amount = Number(raw), code = String(currency);
    if (!Number.isFinite(amount) || !code) return '';
    try { return new Intl.NumberFormat(language === 'ur' ? 'ur-PK' : 'en-PK', { style: 'currency', currency: code }).format(amount / 100); }
    catch { return `${code} ${(amount / 100).toFixed(2)}`; }
  };
  const date = (raw: string | number) => {
    if (!raw) return '';
    const ms = typeof raw === 'number' ? raw : Date.parse(String(raw));
    if (!Number.isFinite(ms)) return String(raw);
    return new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' }).format(ms);
  };
  const values: string[] = [];
  if (type === 'invoice') values.push(String(value('buyer')), money(value('totalMinor'), value('currency')), status(value('status')));
  else if (type === 'shipment') {
    values.push(String(value('supplier')));
    const origin = String(value('origin')), destination = String(value('destination'));
    if (origin || destination) values.push([origin, destination].filter(Boolean).join(' → '));
    if (value('stage')) values.push(status(value('stage')));
    if (value('eta')) values.push(`${t('ETA', 'متوقع')} ${date(value('eta'))}`);
  } else if (type === 'sale') {
    values.push(String(value('buyer')), String(value('product')), quantity(value('quantityMilli'), value('unit')), status(value('status')));
  } else if (type === 'buyer') values.push(status(value('status')));
  else if (type === 'inspection') {
    if (value('reportStatus')) values.push(status(value('reportStatus')));
    else if (value('status')) values.push(status(value('status')));
    if (value('acceptedMilli')) values.push(`${t('Accepted', 'قبول شدہ')} ${quantity(value('acceptedMilli'), value('unit'))}`);
    if (value('rejectedMilli')) values.push(`${t('Rejected', 'مسترد')} ${quantity(value('rejectedMilli'), value('unit'))}`);
  } else {
    if (value('inventoryType')) values.push(status(value('inventoryType')));
    if (value('quality')) values.push(status(value('quality')));
  }
  return values.filter(Boolean).join(' · ');
}
function typeLabel(type: RefType, t: T) {
  const item = shareTypes.find(option => option.id === type);
  return item ? t(item.en, item.ur) : type;
}

function SharedInvoicePdf({ document, t }: { document: SharedInvoiceDocument; t: T }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(false);
  const download = async () => {
    setBusy(true); setFailure(false);
    try { await downloadInvoicePdf(invoiceDocData(document.invoice, document.lines, document.buyer, document.factoryName)); }
    catch { setFailure(true); }
    finally { setBusy(false); }
  };
  return <span className="yf-chat-shared-pdf">
    <button className="button" disabled={busy} onClick={() => void download()}>{busy ? t('Preparing PDF…', 'PDF تیار ہو رہا ہے…') : t('Download PDF', 'PDF ڈاؤن لوڈ کریں')}</button>
    {failure && <small role="alert">{t('The PDF could not be prepared. Try again.', 'PDF تیار نہیں ہو سکی۔ دوبارہ کوشش کریں۔')}</small>}
  </span>;
}

function sharedInvoiceDocument(ref: ChatRef): SharedInvoiceDocument | null {
  if (ref.type !== 'invoice' || !ref.detail || typeof ref.detail !== 'object') return null;
  const document = (ref.detail as Record<string, unknown>).document;
  if (!document || typeof document !== 'object') return null;
  const value = document as Partial<SharedInvoiceDocument>;
  return value.invoice && Array.isArray(value.lines) && value.buyer && typeof value.factoryName === 'string'
    ? value as SharedInvoiceDocument : null;
}

/** Modal sheet built on <dialog>, so Escape and the backdrop close it. */
function Sheet({ title, onClose, className = '', children }: { title: string; onClose: () => void; className?: string; children: ReactNode }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={`yf-chat-sheet ${className}`} aria-label={title} onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="yf-chat-sheet-head"><h3>{title}</h3><button className="live-icon-button" onClick={onClose} aria-label={t('Close', 'بند کریں')}><X size={20} aria-hidden="true" /></button></div>
    {children}
  </dialog>;
}

function SharePicker({ available, onShare, onRetry, retryAvailable, onClose, error, busy }: { available: typeof shareTypes; onShare: (ref: { type: RefType; id: string }) => void; onRetry: () => void; retryAvailable: boolean; onClose: () => void; error: string; busy: boolean }) {
  const { t, language } = useLanguage();
  const [type, setType] = useState<RefType>(available[0]?.id ?? 'lot');
  const [items, setItems] = useState<ShareOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [query, setQuery] = useState('');
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true); setFailure('');
    try {
      const result = await portal<{ items: ShareOption[] }>(`/chat/share-options?type=${type}`);
      if (current === sequence.current) setItems(result.items);
    } catch (caught) { if (current === sequence.current) setFailure(errorMessage(caught, language)); }
    finally { if (current === sequence.current) setLoading(false); }
  }, [language, type]);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = items.filter(item => `${item.label} ${refDetails(type, item.detail, t, language)}`.toLocaleLowerCase().includes(needle));

  return <Sheet title={t('Share a factory record', 'فیکٹری کا ریکارڈ شیئر کریں')} onClose={onClose} className="yf-chat-share-sheet">
    <div className="yf-chat-sheet-body">
      <div className="yf-chat-share-types" role="tablist" aria-label={t('Record type', 'ریکارڈ کی قسم')}>
        {available.map(({ id, en, ur, Icon }) => <button key={id} role="tab" aria-selected={type === id} className={type === id ? 'is-active' : ''} onClick={() => { setType(id); setQuery(''); }}>
          <Icon size={17} aria-hidden="true" />{t(en, ur)}
        </button>)}
      </div>
      <input className="yf-chat-search" type="search" value={query} onChange={event => setQuery(event.target.value)}
        aria-label={t('Search records', 'ریکارڈ تلاش کریں')} placeholder={t('Search records', 'ریکارڈ تلاش کریں')} />
      {failure && <div className="yf-chat-inline-error" role="alert"><p>{failure}</p><button className="button" onClick={() => void load()}>{t('Try again', 'دوبارہ کوشش')}</button></div>}
      {error && <div className="yf-chat-inline-error" role="alert"><p>{error}</p>{retryAvailable && <button className="button" disabled={busy} onClick={onRetry}>{busy ? t('Retrying…', 'دوبارہ بھیج رہے ہیں…') : t('Retry send', 'دوبارہ بھیجیں')}</button>}</div>}
      {loading ? <p className="yf-chat-note" role="status">{t('Loading records…', 'ریکارڈ لوڈ ہو رہے ہیں…')}</p>
        : !failure && (filtered.length ? <ul className="yf-people">{filtered.map(item => <li key={item.id}>
          <button className="yf-person" disabled={busy} onClick={() => onShare({ type: item.type, id: item.id })}>
            <span className="yf-chat-lot-icon"><Package size={20} aria-hidden="true" /></span>
            <span><strong>{item.label}</strong>{refDetails(type, item.detail, t, language) && <small>{refDetails(type, item.detail, t, language)}</small>}</span>
            <ChevronRight size={20} aria-hidden="true" />
          </button></li>)}</ul> : <p className="yf-chat-note">{t('No matching records to share.', 'شیئر کرنے کے لیے کوئی ریکارڈ نہیں ملا۔')}</p>)}
    </div>
  </Sheet>;
}

interface ThreadProps { member: Member; state: WorkspaceState; threadId: string; people: Person[]; title: string }

function Thread({ member, state, threadId, people, title }: ThreadProps) {
  const { t, language } = useLanguage();
  const key = draftKey(state.workspace.id, member.user_id, threadId);
  const attemptKey = `${key}:pending`;
  const [messages, setMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [draft, setDraft] = useState(() => readDraft(key));
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Attempt | null>(() => readAttempt(key));
  const [pendingPhoto, setPendingPhoto] = useState<PhotoAttempt | null>(null);
  const [sheet, setSheet] = useState(false);
  const [viewing, setViewing] = useState<Message | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const afterCursor = useRef(0);
  const beforeCursor = useRef(0);
  const log = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pullActive = useRef(false);
  const preserveScroll = useRef(false);
  const scrollAdjustment = useRef<{ height: number; top: number } | null>(null);

  useEffect(() => {
    try { if (draft) localStorage.setItem(key, draft); else localStorage.removeItem(key); } catch { /* Keep this session's draft if storage is unavailable. */ }
  }, [draft, key]);
  useEffect(() => {
    try { if (pending) localStorage.setItem(attemptKey, JSON.stringify(pending)); else localStorage.removeItem(attemptKey); } catch { /* Retry remains available in this session if storage is unavailable. */ }
  }, [attemptKey, pending]);

  const merge = useCallback((incoming: Message[]) => {
    if (!incoming.length) return;
    const cursors = incoming.map(item => item.seq).filter(Number.isFinite);
    if (cursors.length) {
      afterCursor.current = Math.max(afterCursor.current, ...cursors);
      beforeCursor.current = beforeCursor.current === 0 ? Math.min(...cursors) : beforeCursor.current;
    }
    const el = log.current;
    const atEnd = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setMessages(prev => {
      const seen = new Set(prev.map(item => item.id));
      const fresh = incoming.filter(item => !seen.has(item.id));
      if (!fresh.length) return prev;
      preserveScroll.current = !atEnd;
      return [...prev, ...fresh].sort((a, b) => a.created_at - b.created_at);
    });
  }, []);

  const loadEarlier = async () => {
    if (!hasMore || loadingEarlier || beforeCursor.current === 0) return;
    const el = log.current;
    const anchor = el ? { height: el.scrollHeight, top: el.scrollTop } : null;
    setLoadingEarlier(true);
    try {
      const page = await portal<{ messages: Message[]; hasMore: boolean }>(`/chat/messages?thread=${encodeURIComponent(threadId)}&beforeCursor=${beforeCursor.current}`);
      setHasMore(page.hasMore);
      const existing = new Set(messages.map(item => item.id));
      const older = page.messages.filter(item => !existing.has(item.id));
      if (!older.length) return;
      beforeCursor.current = Math.min(beforeCursor.current, ...older.map(item => item.seq));
      scrollAdjustment.current = anchor;
      setMessages(prev => [...older, ...prev].sort((a, b) => (a.seq ?? a.created_at) - (b.seq ?? b.created_at)));
    } catch (caught) { setFailure(caught); }
    finally { setLoadingEarlier(false); }
  };

  // Load newest messages once, then poll incrementally. A visibility change can wake a poll; overlap is suppressed.
  useEffect(() => {
    let alive = true;
    afterCursor.current = 0; beforeCursor.current = 0; setMessages([]); setHasMore(false); setReady(false); pullActive.current = false;
    const pull = async () => {
      if (!alive || document.hidden || pullActive.current) return;
      pullActive.current = true;
      try {
        const since = afterCursor.current ? `&afterCursor=${afterCursor.current}` : '';
        const page = await portal<{ messages: Message[]; hasMore: boolean }>(`/chat/messages?thread=${encodeURIComponent(threadId)}${since}`);
        if (!alive) return;
        if (!afterCursor.current) { setHasMore(page.hasMore); if (page.messages.length) beforeCursor.current = Math.min(...page.messages.map(item => item.seq)); }
        merge(page.messages); setReady(true); setFailure(null);
      } catch (caught) { if (alive) setFailure(caught); }
      finally { pullActive.current = false; }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 5000);
    const visible = () => { if (!document.hidden) void pull(); };
    document.addEventListener('visibilitychange', visible);
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [threadId, merge]);

  useEffect(() => {
    const el = log.current;
    if (!el) return;
    if (scrollAdjustment.current) {
      const adjustment = scrollAdjustment.current; scrollAdjustment.current = null;
      el.scrollTop = adjustment.top + el.scrollHeight - adjustment.height;
    } else if (preserveScroll.current) preserveScroll.current = false;
    else el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const transmit = async (attempt: Attempt) => {
    setPending(attempt); setBusy(true); setFailure(null);
    try {
      const message = await portal<Message>('/chat/send', { id: attempt.id, threadId, ...attempt.payload });
      merge([message]); setPending(null);
      if (attempt.payload.body && attempt.payload.body === draft.trim()) setDraft('');
      if (attempt.payload.ref) setSheet(false);
      return true;
    } catch (caught) { setFailure(caught); return false; }
    finally { setBusy(false); }
  };
  const sendDraft = async () => {
    const body = draft.trim();
    if (!body || busy || pending || pendingPhoto) return;
    await transmit({ id: crypto.randomUUID(), payload: { body } });
  };
  const retry = async () => { if (pending && !busy) await transmit(pending); };
  const sendShare = async (ref: { type: RefType; id: string }) => {
    if (busy || pending || pendingPhoto) return;
    if (await transmit({ id: crypto.randomUUID(), payload: { ref } })) setSheet(false);
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendDraft(); }
  };
  const uploadPhoto = async (attempt: PhotoAttempt) => {
    setBusy(true); setFailure(null);
    try {
      const form = new FormData(); form.set('id', attempt.id); form.set('threadId', threadId);
      if (attempt.caption) form.set('caption', attempt.caption); form.set('photo', attempt.file);
      const response = await fetch('/api/erp/chat/photos', { method: 'POST', body: form, credentials: 'same-origin', cache: 'no-store', redirect: 'error' }).catch(() => null);
      if (!response) throw new Error(t('Could not confirm the photo. Reopen it and try again.', 'تصویر کی تصدیق نہیں ہو سکی۔ اسے دوبارہ منتخب کر کے بھیجیں۔'));
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || t('The photo was not sent. Try again.', 'تصویر نہیں بھیجی گئی۔ دوبارہ کوشش کریں۔'));
      merge([data as Message]); setDraft(''); setPendingPhoto(null);
    } catch (caught) { setFailure(caught); setPendingPhoto(attempt); }
    finally { setBusy(false); }
  };
  const onPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || busy || pending || pendingPhoto) return;
    const attempt = { id: crypto.randomUUID(), file, caption: draft.trim() };
    await uploadPhoto(attempt);
  };
  const retrySend = async () => {
    if (pending) await retry();
    else if (pendingPhoto && !busy) await uploadPhoto(pendingPhoto);
  };
  const failureText = failure === null ? '' : errorMessage(failure, language);
  const roster = [...people.filter(person => person.id !== member.user_id), { id: member.user_id, name: member.name, role: member.role }]
    .sort((a, b) => a.name.localeCompare(b.name, language));

  return <section className="yf-chat-thread" aria-label={title}>
    <header className="yf-chat-bar">
      <span className="yf-chat-room-icon"><Factory size={20} aria-hidden="true" /></span>
      <div className="yf-chat-room-heading"><h2>{title}</h2><small>{t(`${roster.length} active team members`, `${roster.length} فعال ٹیم ممبران`)}</small></div>
    </header>
    <div className="yf-chat-roster" aria-label={t('Active team members', 'فعال ٹیم ممبران')}>
      {roster.map(person => <span className="yf-chat-roster-person" key={person.id}><Avatar name={person.name} /><span><strong>{person.name}</strong><small>{t(...roleLabel[person.role])}{person.id === member.user_id ? ` · ${t('You', 'آپ')}` : ''}</small></span></span>)}
    </div>
    <div className="yf-chat-log" ref={log} role="log" aria-live="polite">
      {!ready && failure === null && <p className="yf-chat-note" role="status">{t('Loading messages…', 'پیغامات لوڈ ہو رہے ہیں…')}</p>}
      {ready && messages.length === 0 && <p className="yf-chat-note">{t('No messages yet. Say hello.', 'ابھی کوئی پیغام نہیں۔ سلام کہیں۔')}</p>}
      {ready && hasMore && <button className="yf-chat-older" disabled={loadingEarlier} onClick={() => void loadEarlier()}>
        {loadingEarlier ? t('Loading earlier messages…', 'پرانے پیغامات لوڈ ہو رہے ہیں…') : t('Load earlier messages', 'پرانے پیغامات دیکھیں')}
      </button>}
      {messages.map(message => {
        const mine = message.user_id === member.user_id;
        const invoiceDocument = message.ref ? sharedInvoiceDocument(message.ref) : null;
        return <div key={message.id} className={`yf-chat-msg${mine ? ' is-mine' : ''}`}>
          {!mine && <span className="yf-chat-sender">{message.sender_name}</span>}
          <div className="yf-chat-bubble">
            {message.photo && <button className="yf-chat-photo" onClick={() => setViewing(message)} aria-label={t('Open photo', 'تصویر کھولیں')}><img src={photoUrl(message.id)} alt="" loading="lazy" /></button>}
            {message.body && <p className="yf-chat-text">{message.body}</p>}
            {message.ref && <div className="yf-chat-shared-record">
              <span className="yf-chat-lot-icon"><Package size={19} aria-hidden="true" /></span>
              <span><small>{typeLabel(message.ref.type, t)}{message.ref.capturedAt ? ` · ${t('Shared snapshot', 'شیئر کیا گیا خلاصہ')} ${stamp(message.ref.capturedAt)}` : ''}</small><strong>{message.ref.label}</strong>
                {refDetails(message.ref.type, message.ref.detail, t, language) && <small>{refDetails(message.ref.type, message.ref.detail, t, language)}</small>}
                {invoiceDocument && <SharedInvoicePdf document={invoiceDocument} t={t} />}</span>
            </div>}
          </div>
          <time dateTime={new Date(message.created_at).toISOString()}>{stamp(message.created_at)}</time>
        </div>;
      })}
    </div>
    {(failureText || pending || pendingPhoto) && <div className="yf-chat-inline-error" role="alert"><p>{failureText || t('A previous send was not confirmed.', 'پچھلے پیغام کی تصدیق نہیں ہو سکی۔')}</p>
      {(pending || pendingPhoto) && <button className="button" disabled={busy} onClick={() => void retrySend()}>{busy ? t('Retrying…', 'دوبارہ بھیج رہے ہیں…') : t('Retry send', 'دوبارہ بھیجیں')}</button>}
      {!pending && !pendingPhoto && hasMore && <button className="button" disabled={loadingEarlier} onClick={() => void loadEarlier()}>{t('Retry loading history', 'تاریخ دوبارہ لوڈ کریں')}</button>}
    </div>}
    <div className="yf-chat-composer">
      <div className="yf-chat-quick" role="group" aria-label={t('Quick replies', 'فوری جوابات')}>
        {quickReplies.map(([en, ur]) => <button key={en} className="yf-chat-chip" disabled={busy || !!pending || !!pendingPhoto} onClick={() => void transmit({ id: crypto.randomUUID(), payload: { body: t(en, ur) } })}>{t(en, ur)}</button>)}
      </div>
      <textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={onKey} rows={1} maxLength={2000} disabled={busy || !!pending || !!pendingPhoto}
        placeholder={t('Type a message', 'پیغام لکھیں')} aria-label={t('Message', 'پیغام')} />
      <div className="yf-chat-actions">
        <button className="button" disabled={busy || !!pending || !!pendingPhoto} onClick={() => fileInput.current?.click()}><Camera size={18} aria-hidden="true" />{t('Photo', 'تصویر')}</button>
        <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden onChange={event => void onPhoto(event)} />
        <button className="button" disabled={busy || !!pending || !!pendingPhoto} onClick={() => setSheet(true)}><Package size={18} aria-hidden="true" />{t('Share a record', 'ریکارڈ شیئر کریں')}</button>
        <button className="button primary yf-chat-send" disabled={busy || !!pending || !!pendingPhoto || !draft.trim()} onClick={() => void sendDraft()}><Send size={18} aria-hidden="true" />{t('Send', 'بھیجیں')}</button>
      </div>
    </div>
    {sheet && <SharePicker available={shareTypes.filter(option => {
      if (option.id === 'lot') return true;
      if (option.id === 'invoice' || option.id === 'sale' || option.id === 'buyer') return member.role === 'admin' || member.role === 'sales_manager';
      if (option.id === 'shipment') return member.role === 'admin' || member.role === 'purchase_manager';
      return ['admin', 'purchase_manager', 'quality_inspector', 'supervisor'].includes(member.role);
    })} onShare={ref => void sendShare(ref)} onRetry={() => void retrySend()} retryAvailable={!!pending} error={failureText} busy={busy || !!pending || !!pendingPhoto} onClose={() => setSheet(false)} />}
    {viewing && <Sheet title={t('Photo', 'تصویر')} className="is-photo" onClose={() => setViewing(null)}><div className="yf-chat-sheet-body"><img className="yf-chat-full" src={photoUrl(viewing.id)} alt={viewing.body || t('Photo', 'تصویر')} /></div></Sheet>}
  </section>;
}

/** The one permanent Factory room is opened on entry. Inbox refreshes are visibility-aware and never overlap. */
export default function Chat({ member, state, navigate, onUnread }: { member: Member; state: WorkspaceState; navigate: (page: string, id?: string) => void; onUnread?: (n: number) => void }) {
  const { t, language } = useLanguage();
  const [list, setList] = useState<ChatList | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  void navigate;
  const inFlight = useRef(false);
  const unreadRef = useRef(onUnread);
  useEffect(() => { unreadRef.current = onUnread; }, [onUnread]);

  const loadList = useCallback(async () => {
    if (inFlight.current || document.hidden) return;
    inFlight.current = true;
    try {
      const data = await portal<ChatList>('/chat');
      setList(data); setFailure(null); unreadRef.current?.(data.threads.find(thread => thread.kind === 'team')?.unread ?? 0);
    } catch (caught) { setFailure(caught); }
    finally { inFlight.current = false; }
  }, []);
  useEffect(() => {
    void loadList();
    const timer = window.setInterval(() => void loadList(), 15000);
    const visible = () => { if (!document.hidden) void loadList(); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [loadList]);

  const team = list?.threads.find(thread => thread.kind === 'team');
  useEffect(() => { if (team) unreadRef.current?.(0); }, [team?.id]);
  if (failure !== null && !list) return <section className="yf-chat" aria-label={t('Chat', 'چیٹ')}><p className="live-error" role="alert">{errorMessage(failure, language)}</p><button className="button" onClick={() => void loadList()}>{t('Try again', 'دوبارہ کوشش')}</button></section>;
  if (!list || !team) return <section className="yf-chat" aria-label={t('Chat', 'چیٹ')}><p className="yf-chat-note" role="status">{t('Opening the Factory room…', 'فیکٹری روم کھل رہا ہے…')}</p></section>;
  return <Thread key={team.id} member={member} state={state} threadId={team.id} title={t('Factory room', 'فیکٹری روم')} people={list.people} />;
}
