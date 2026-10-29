import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowLeft, Camera, ChevronRight, Factory, Package, Search, Send, X, MessageSquarePlus } from 'lucide-react';
import { Avatar } from './SignIn';
import { errorMessage } from './forms';
import { portal } from './PortalCommon';
import { useLanguage } from './i18n';
import { roleLabel, type Member, type Role, type WorkspaceState } from './inventory-client';
import { NAV } from './roles';
import './chat.css';

interface ChatRef { type: 'lot'; id: string; label: string }
interface Message { id: string; thread_id: string; user_id: string; sender_name: string; body: string; photo: boolean; ref: ChatRef | null; created_at: number }
interface Person { id: string; name: string; role: Role }
interface Thread { id: string; kind: 'team' | 'direct'; title: string; other: Person | null; last: Message | null; unread: number }
interface ChatList { threads: Thread[]; people: Person[]; unread: number }

const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' });
const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' });
const shortDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short' });
const stamp = (ms: number) => dayOf.format(ms) === dayOf.format(Date.now()) ? clock.format(ms) : shortDate.format(ms);
const quickReplies: [string, string][] = [['Done', 'ہو گیا'], ['On my way', 'آ رہا ہوں'], ['Need help', 'مدد چاہیے'], ['Stock arrived', 'مال آ گیا'], ['Check this', 'یہ دیکھیں']];
const photoUrl = (id: string) => `/api/erp/chat/photo/${id}`;
type T = (english: string, urdu?: string) => string;

function preview(message: Message | null, t: T) {
  if (!message) return t('No messages yet', 'ابھی کوئی پیغام نہیں');
  if (message.body) return message.body.replace(/\s+/g, ' ');
  if (message.photo) return t('📷 Photo', '📷 تصویر');
  return message.ref?.label ?? '';
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

function PeoplePicker({ people, onPick, onClose }: { people: Person[]; onPick: (threadId: string) => void; onClose: () => void }) {
  const { t, language } = useLanguage();
  const [busy, setBusy] = useState(''), [failure, setFailure] = useState<unknown>(null);
  const start = async (person: Person) => {
    setBusy(person.id); setFailure(null);
    try { const { id } = await portal<{ id: string }>('/chat/direct', { userId: person.id }); onPick(id); }
    catch (caught) { setFailure(caught); setBusy(''); }
  };
  return <Sheet title={t('New message', 'نیا پیغام')} onClose={onClose}>
    <div className="yf-chat-sheet-body">
      {failure !== null && <p className="live-error" role="alert">{errorMessage(failure, language)}</p>}
      {people.length
        ? <ul className="yf-people">{people.map(person => <li key={person.id}>
          <button className="yf-person" disabled={!!busy} onClick={() => void start(person)}>
            <Avatar name={person.name} /><span><strong>{person.name}</strong><small>{t(...roleLabel[person.role])}</small></span><ChevronRight size={20} aria-hidden="true" />
          </button></li>)}</ul>
        : <p className="yf-chat-note">{t('No other staff to message yet.', 'ابھی کسی اور ساتھی کو پیغام بھیجنے کے لیے موجود نہیں۔')}</p>}
    </div>
  </Sheet>;
}

function LotPicker({ state, busy, error, onPick, onClose }: { state: WorkspaceState; busy: boolean; error: string; onPick: (lotId: string) => void; onClose: () => void }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const products = new Map(state.products.map(product => [product.id, product.name]));
  const needle = query.trim().toLowerCase();
  const lots = state.lots.filter(lot => !needle || `${products.get(lot.product_id) ?? ''} ${lot.batch} ${lot.supplier}`.toLowerCase().includes(needle));
  return <Sheet title={t('Share a batch', 'بیچ شیئر کریں')} onClose={onClose}>
    <div className="yf-chat-sheet-body">
      <input className="yf-chat-search" type="search" value={query} onChange={event => setQuery(event.target.value)}
        aria-label={t('Search batches', 'بیچ تلاش کریں')} placeholder={t('Search batch or product', 'بیچ یا پروڈکٹ تلاش کریں')} />
      {error && <p className="live-error" role="alert">{error}</p>}
      {lots.length
        ? <ul className="yf-people">{lots.map(lot => <li key={lot.id}>
          <button className="yf-person" disabled={busy} onClick={() => onPick(lot.id)}>
            <span className="yf-chat-lot-icon"><Package size={20} aria-hidden="true" /></span>
            <span><strong>{products.get(lot.product_id) ?? lot.batch}</strong><small>{lot.batch} · {lot.supplier}</small></span>
            <ChevronRight size={20} aria-hidden="true" />
          </button></li>)}</ul>
        : <p className="yf-chat-note">{t('No batches match.', 'کوئی بیچ نہیں ملا۔')}</p>}
    </div>
  </Sheet>;
}

interface ThreadProps { member: Member; state: WorkspaceState; threadId: string; title: string; navigate: (page: string, id?: string) => void; onBack: () => void }

function Thread({ member, state, threadId, title, navigate, onBack }: ThreadProps) {
  const { t, language } = useLanguage();
  const [messages, setMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<'lot' | null>(null);
  const [viewing, setViewing] = useState<Message | null>(null);
  const after = useRef(0);
  const log = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const merge = useCallback((incoming: Message[]) => {
    if (!incoming.length) return;
    after.current = Math.max(after.current, ...incoming.map(item => item.created_at));
    setMessages(prev => {
      const seen = new Set(prev.map(item => item.id));
      const fresh = incoming.filter(item => !seen.has(item.id));
      return fresh.length ? [...prev, ...fresh].sort((a, b) => a.created_at - b.created_at) : prev;
    });
  }, []);

  // Full load first, then only messages newer than the last one we have, every 3 seconds while the tab is visible.
  useEffect(() => {
    let alive = true;
    after.current = 0; setMessages([]); setReady(false);
    const pull = async () => {
      try {
        const since = after.current ? `&after=${after.current}` : '';
        const page = await portal<{ messages: Message[] }>(`/chat/messages?thread=${encodeURIComponent(threadId)}${since}`);
        if (!alive) return;
        merge(page.messages); setReady(true); setFailure(null);
      } catch (caught) { if (alive) setFailure(caught); }
    };
    void pull();
    const timer = window.setInterval(() => { if (!document.hidden) void pull(); }, 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [threadId, merge]);

  // Scroll the thread's own log, never the page.
  useEffect(() => { const el = log.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length]);

  const send = async (payload: { body?: string; ref?: { type: 'lot'; id: string } }) => {
    setBusy(true); setFailure(null);
    try { merge([await portal<Message>('/chat/send', { threadId, ...payload })]); return true; }
    catch (caught) { setFailure(caught); return false; }
    finally { setBusy(false); }
  };
  const sendDraft = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    if (await send({ body })) setDraft('');
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendDraft(); }
  };
  const onPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    const form = new FormData();
    form.set('threadId', threadId);
    const caption = draft.trim();
    if (caption) form.set('caption', caption);
    form.set('photo', file);
    setBusy(true); setFailure(null);
    try {
      const response = await fetch('/api/erp/chat/photos', { method: 'POST', body: form, credentials: 'same-origin', cache: 'no-store', redirect: 'error' }).catch(() => null);
      if (!response) throw new Error('Could not confirm the photo. Check the connection and try again.');
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'The photo was not sent. Try again.');
      merge([data as Message]); setDraft('');
    } catch (caught) { setFailure(caught); }
    finally { setBusy(false); }
  };
  const shareLot = async (lotId: string) => { if (await send({ ref: { type: 'lot', id: lotId } })) setSheet(null); };
  const failureText = failure === null ? '' : errorMessage(failure, language);

  return <section className="yf-chat-thread" aria-label={title}>
    <header className="yf-chat-bar">
      <button className="live-icon-button yf-chat-back" onClick={onBack} aria-label={t('Back to chats', 'چیٹس پر واپس')}><ArrowLeft size={22} aria-hidden="true" /></button>
      <h2>{title}</h2>
    </header>
    <div className="yf-chat-log" ref={log} role="log" aria-live="polite">
      {!ready && failure === null && <p className="yf-chat-note" role="status">{t('Loading messages…', 'پیغامات لوڈ ہو رہے ہیں…')}</p>}
      {ready && messages.length === 0 && <p className="yf-chat-note">{t('No messages yet. Say hello.', 'ابھی کوئی پیغام نہیں۔ سلام کہیں۔')}</p>}
      {messages.map(message => {
        const mine = message.user_id === member.user_id;
        return <div key={message.id} className={`yf-chat-msg${mine ? ' is-mine' : ''}`}>
          {!mine && <span className="yf-chat-sender">{message.sender_name}</span>}
          <div className="yf-chat-bubble">
            {message.photo && <button className="yf-chat-photo" onClick={() => setViewing(message)} aria-label={t('Open photo', 'تصویر کھولیں')}>
              <img src={photoUrl(message.id)} alt="" loading="lazy" />
            </button>}
            {message.body && <p className="yf-chat-text">{message.body}</p>}
            {message.ref && <div className="yf-chat-batch">
              <Package size={20} aria-hidden="true" />
              <span><small>{t('Batch', 'بیچ')}</small><strong>{message.ref.label}</strong></span>
              {NAV[member.role].some(section => section.id === 'inventory') && <button className="button" onClick={() => navigate('inventory', message.ref?.id)}>{t('Open batch', 'بیچ کھولیں')}</button>}
            </div>}
          </div>
          <time dateTime={new Date(message.created_at).toISOString()}>{stamp(message.created_at)}</time>
        </div>;
      })}
    </div>
    {failureText && sheet === null && <p className="live-error yf-chat-error" role="alert">{failureText}</p>}
    <div className="yf-chat-composer">
      <div className="yf-chat-quick" role="group" aria-label={t('Quick replies', 'فوری جوابات')}>
        {quickReplies.map(([en, ur]) => <button key={en} className="yf-chat-chip" disabled={busy} onClick={() => void send({ body: t(en, ur) })}>{t(en, ur)}</button>)}
      </div>
      <textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={onKey} rows={1} maxLength={2000}
        placeholder={t('Type a message', 'پیغام لکھیں')} aria-label={t('Message', 'پیغام')} />
      <div className="yf-chat-actions">
        <button className="button" disabled={busy} onClick={() => fileInput.current?.click()}><Camera size={18} aria-hidden="true" />{t('Photo', 'تصویر')}</button>
        <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden onChange={event => void onPhoto(event)} />
        <button className="button" disabled={busy} onClick={() => setSheet('lot')}><Package size={18} aria-hidden="true" />{t('Share a batch', 'بیچ شیئر کریں')}</button>
        <button className="button primary yf-chat-send" disabled={busy || !draft.trim()} onClick={() => void sendDraft()}><Send size={18} aria-hidden="true" />{t('Send', 'بھیجیں')}</button>
      </div>
    </div>
    {sheet === 'lot' && <LotPicker state={state} busy={busy} error={failureText} onPick={lotId => void shareLot(lotId)} onClose={() => setSheet(null)} />}
    {viewing && <Sheet title={t('Photo', 'تصویر')} className="is-photo" onClose={() => setViewing(null)}>
      <div className="yf-chat-sheet-body"><img className="yf-chat-full" src={photoUrl(viewing.id)} alt={viewing.body || t('Photo', 'تصویر')} /></div>
    </Sheet>}
  </section>;
}

/** Team chat: a Factory room for everyone plus one-to-one threads. Polls the list every 8s and the open thread every 3s, only while the tab is visible. */
export default function Chat({ member, state, navigate, onUnread }: { member: Member; state: WorkspaceState; navigate: (page: string, id?: string) => void; onUnread?: (n: number) => void }) {
  const { t, language } = useLanguage();
  const [list, setList] = useState<ChatList | null>(null);
  const [listFailure, setListFailure] = useState<unknown>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const unreadRef = useRef(onUnread);
  useEffect(() => { unreadRef.current = onUnread; }, [onUnread]);

  const loadList = useCallback(async () => {
    try {
      const data = await portal<ChatList>('/chat');
      setList(data); setListFailure(null);
      unreadRef.current?.(data.unread);
    } catch (caught) { setListFailure(caught); }
  }, []);

  useEffect(() => {
    void loadList();
    const timer = window.setInterval(() => { if (!document.hidden) void loadList(); }, 8000);
    return () => window.clearInterval(timer);
  }, [loadList]);

  const titleOf = (thread: Thread) => thread.kind === 'team' ? t('Factory room', 'فیکٹری روم') : thread.title;
  const openThread = (id: string) => { setPicking(false); setOpenId(id); void loadList(); };

  if (openId) {
    const current = list?.threads.find(item => item.id === openId);
    return <Thread key={openId} member={member} state={state} threadId={openId} title={current ? titleOf(current) : t('Chat', 'چیٹ')} navigate={navigate}
      onBack={() => { setOpenId(null); void loadList(); }} />;
  }

  const shortcuts = (NAV[member.role] ?? []).filter(section => section.id !== 'dashboard');
  return <section className="yf-chat" aria-label={t('Chat', 'چیٹ')}>
    <div className="yf-chat-head">
      <p className="live-muted">{t('Message the whole factory or one person. Send photos and batches instead of WhatsApp.', 'پوری فیکٹری یا کسی ایک شخص کو پیغام بھیجیں۔ واٹس ایپ کی جگہ تصاویر اور بیچ یہاں بھیجیں۔')}</p>
      <button className="button primary" onClick={() => setPicking(true)}><MessageSquarePlus size={18} aria-hidden="true" />{t('New message', 'نیا پیغام')}</button>
    </div>
    {shortcuts.length > 0 && <nav className="yf-chat-go" aria-label={t('Go to', 'جائیں')}>
      <span>{t('Go to', 'جائیں')}</span>
      {shortcuts.map(section => { const Icon = section.icon; return <button key={section.id} className="button" onClick={() => navigate(section.id)}><Icon size={18} aria-hidden="true" />{t(section.en, section.ur)}</button>; })}
    </nav>}
    {listFailure !== null && <p className="live-error" role="alert">{errorMessage(listFailure, language)}</p>}
    {list
      ? <ul className="yf-chat-list">{list.threads.map(thread => <li key={thread.id}>
        <button className="yf-chat-row" onClick={() => openThread(thread.id)}>
          {thread.kind === 'team'
            ? <span className="yf-chat-team" aria-hidden="true"><Factory size={20} /></span>
            : <Avatar name={thread.other?.name ?? thread.title} />}
          <span className="yf-chat-row-text"><strong>{titleOf(thread)}</strong><small>{preview(thread.last, t)}</small></span>
          <span className="yf-chat-row-meta">
            {thread.last && <time dateTime={new Date(thread.last.created_at).toISOString()}>{stamp(thread.last.created_at)}</time>}
            {thread.unread > 0 && <span className="yf-chat-unread" aria-label={t(`${thread.unread} unread`, `${thread.unread} نئے`)}>{thread.unread}</span>}
          </span>
        </button></li>)}
        {list.threads.length === 0 && <li className="yf-chat-note">{t('No chats yet.', 'ابھی کوئی چیٹ نہیں۔')}</li>}
      </ul>
      : listFailure === null && <p className="yf-chat-note" role="status">{t('Loading chats…', 'چیٹس لوڈ ہو رہی ہیں…')}</p>}
    {picking && <PeoplePicker people={list?.people ?? []} onPick={openThread} onClose={() => setPicking(false)} />}
  </section>;
}
