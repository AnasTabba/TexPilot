import { useCallback, useEffect, useState } from 'react';
import { ArrowRightLeft, ChevronDown, ClipboardCheck, KeyRound, Package, PackagePlus, ShieldCheck, Trash2, Truck, Undo2, UserCheck, UserPlus, type LucideIcon } from 'lucide-react';
import { AsyncForm, Field, errorMessage } from './forms';
import { Avatar } from './SignIn';
import { when } from './WorkspaceDashboard';
import { inventoryRequest as api, roleLabel, type Role, type Member, type Permission } from './inventory-client';
import { translate, useLanguage } from './i18n';

interface Person { id: string; name: string; role: Role | null; status: 'active' | 'pending' | 'deactivated'; created_at: number; locked: boolean }

// The same icons as the batch actions they unlock.
export const permissionInfo: [Permission, string, string, LucideIcon][] = [
  ['receive', 'Receive deliveries', 'Book stock in when it arrives', PackagePlus],
  ['produce', 'Move between stages', 'Raw to work in progress to finished', ArrowRightLeft],
  ['dispatch', 'Dispatch', 'Send approved stock to customers', Truck],
  ['waste', 'Record waste', 'Write off damaged or lost stock', Trash2],
  ['catalog', 'Materials and batches', 'Add new yarns and their batches', Package],
  ['inspect', 'Inspections', 'Record care labels and scan evidence', ClipboardCheck],
  ['qc', 'QC decisions', 'Approve a batch or put it on hold', ShieldCheck],
  ['reverse', 'Reverse entries', 'Correct a saved entry, with a reason', Undo2],
  ['suppliers', 'Supplier directory', 'Maintain supplier contacts and categories', UserCheck],
  ['procure', 'Procurement', 'Create RFQs, review bids and accept purchase orders', PackagePlus],
  ['sales', 'Sales orders', 'Manage buyers, quotations and invoices', Truck],
  ['production', 'Production planning', 'Plan machines, shifts and production batches', ArrowRightLeft],
  ['payments', 'Customer payments', 'Record payments and manage receivables', ClipboardCheck],
];
export const accessSummary = (role: Role, language: 'en' | 'ur' = 'en') => translate(language, ...roleLabel[role]);
function RolePicker({ value, onChange, disabled = false }: { value: Role; onChange: (value: Role) => void; disabled?: boolean }) {
  const { t } = useLanguage();
  return <Field>{t('Role', 'کردار')}<select value={value} disabled={disabled} onChange={e => onChange(e.target.value as Role)}>{(Object.keys(roleLabel) as Role[]).map(role => <option key={role} value={role}>{t(...roleLabel[role])}</option>)}</select></Field>;
}

/** Admins only: who can sign in, and what each person can record. */
export default function Team({ me, onChanged }: { me: Member; onChanged: () => Promise<void> }) {
  const { t } = useLanguage();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState(''); const [open, setOpen] = useState('');
  const load = useCallback(async () => {
    try { setPeople((await api<{ users: Person[] }>('/erp/admin/users')).users); setError(''); } catch (error) { setError(errorMessage(error)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const changed = async () => { await load(); await onChanged(); };
  const waiting = people?.filter(p => p.status === 'pending') ?? [];
  const listed = people?.filter(p => p.status !== 'pending') ?? [];
  return <>
    {error && <p className="live-error" role="alert">{t(error)}<button className="live-text-button" onClick={() => void load()}>{t('Retry', 'دوبارہ کوشش کریں')}</button></p>}
    {!people && !error && <p role="status" className="live-muted">{t('Loading the team…', 'ٹیم لوڈ ہو رہی ہے…')}</p>}
    {waiting.length > 0 && <section className="live-panel" aria-labelledby="yf-waiting">
      <div className="yf-head"><h2 id="yf-waiting">{t('Waiting for you', 'آپ کی منظوری کا انتظار')}</h2><span>{t(waiting.length === 1 ? '1 request' : `${waiting.length} requests`, `${waiting.length} درخواست${waiting.length === 1 ? '' : 'یں'}`)}</span></div>
      <div className="yf-requests">{waiting.map(person => <Request key={person.id} person={person} onDone={changed} />)}</div>
    </section>}
    {open === 'new' && <AddPerson onDone={async () => { setOpen(''); await changed(); }} onCancel={() => setOpen('')} />}
    {people && <section className="live-panel" aria-labelledby="yf-people">
      <div className="yf-head"><h2 id="yf-people">{t('People', 'ٹیم کے لوگ')}</h2>{open !== 'new' && <button className="button" onClick={() => setOpen('new')}><UserPlus size={18} aria-hidden="true" />{t('Add a person', 'نیا فرد شامل کریں')}</button>}</div>
      <ul className="yf-team">{listed.map(person => <Member key={person.id} person={person} self={person.id === me.user_id} open={open === person.id} onToggle={() => setOpen(open === person.id ? '' : person.id)} onDone={changed} />)}</ul>
    </section>}
  </>;
}

function Request({ person, onDone }: { person: Person; onDone: () => Promise<void> }) {
  const { language, t } = useLanguage();
  const [role, setRole] = useState<Role>(person.role ?? 'quality_inspector');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function act(path: string, body: object) {
    setBusy(true); setError('');
    try { await api(path, body); await onDone(); } catch (error) { setError(errorMessage(error)); setBusy(false); }
  }
  return <article className="yf-request" aria-label={t(`${person.name} wants to join`, `${person.name} شامل ہونا چاہتے ہیں`)}>
    <header><Avatar name={person.name} /><div><strong>{person.name}</strong><span>{t('Asked', 'درخواست دی')} {when.format(person.created_at, language)}</span></div></header>
    <p className="live-muted">{t(`Choose a role for ${person.name}, then approve.`, `${person.name} کا کردار چنیں، پھر منظوری دیں۔`)}</p>
    <RolePicker value={role} onChange={setRole} disabled={busy} />
    {error && <p className="live-error" role="alert">{t(error)}</p>}
    <div className="live-actions">
      <button className="button primary" disabled={busy} onClick={() => void act('/erp/admin/users/update', { id: person.id, active: true, role })}><UserCheck size={18} aria-hidden="true" />{t(`Approve ${person.name}`, `${person.name} کو منظور کریں`)}</button>
    </div>
  </article>;
}

function Member({ person, self, open, onToggle, onDone }: { person: Person; self: boolean; open: boolean; onToggle: () => void; onDone: () => Promise<void> }) {
  const { language, t } = useLanguage();
  const [role, setRole] = useState<Role>(person.role ?? 'quality_inspector');
  useEffect(() => setRole(person.role ?? 'quality_inspector'), [person.role]);
  const [pin, setPin] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState<[string, string?] | null>(null);
  const dirty = role !== person.role;
  async function act(path: string, body: object, done: [string, string?] | null) {
    setBusy(true); setError(''); setNotice(null);
    try { await api(path, body); setNotice(done); await onDone(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <li className={`yf-member${open ? ' is-open' : ''}`}>
    <button className="yf-member-row" aria-expanded={open} onClick={onToggle}>
      <Avatar name={person.name} /><span><strong>{person.name}{self && <small> · {t('you', 'آپ')}</small>}</strong><span>{person.role ? accessSummary(person.role, language) : t('Role not assigned', 'کردار مقرر نہیں')}</span></span>
      {person.status === 'deactivated' && <span className="live-quality hold"><ShieldCheck size={16} aria-hidden="true" />{t('Deactivated', 'غیر فعال')}</span>}{person.locked && <span className="live-quality hold">{t('Locked', 'مقفل')}</span>}<ChevronDown size={20} aria-hidden="true" />
    </button>
    {open && <div className="yf-member-body">
      <RolePicker value={role} onChange={setRole} disabled={busy} />
      {dirty && <div className="live-actions"><button className="button primary" disabled={busy} onClick={() => void act('/erp/admin/users/update', { id: person.id, role }, [`${person.name}'s access is saved.`, `${person.name} کے اختیارات محفوظ ہو گئے۔`])}>{t('Save access', 'اختیارات محفوظ کریں')}</button><button className="button" disabled={busy} onClick={() => { setRole(person.role ?? 'quality_inspector'); }}>{t('Undo changes', 'تبدیلیاں واپس کریں')}</button></div>}
      <form className="yf-pin-reset" onSubmit={event => { event.preventDefault(); void act('/erp/admin/users/update', { id: person.id, pin }, [`New PIN set. ${self ? 'Sign in again with it.' : `Tell ${person.name} the new PIN.`}`, `نیا پن مقرر ہو گیا۔ ${self ? 'اس سے دوبارہ سائن اِن کریں۔' : `${person.name} کو نیا پن بتا دیں۔`}`]).then(() => setPin('')); }}>
        <Field>{person.locked ? t('Locked after wrong PINs. Set a new PIN to unlock', 'غلط پن سے اکاؤنٹ مقفل ہے۔ کھولنے کے لیے نیا پن مقرر کریں') : t('Set a new PIN', 'نیا پن مقرر کریں')}<input type="password" dir="ltr" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="new-password" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, ''))} required /></Field>
        <button className="button" disabled={busy}><KeyRound size={18} aria-hidden="true" />{t('Set PIN', 'پن مقرر کریں')}</button>
      </form>
      {error && <p className="live-error" role="alert">{t(error)}</p>}
      {notice && <p className="live-success" role="status"><span>{t(...notice)}</span></p>}
      {!self && <button className="live-text-button yf-danger" disabled={busy} onClick={() => void act('/erp/admin/users/update', { id: person.id, active: person.status === 'deactivated' }, null)}>{person.status === 'deactivated' ? t('Reactivate', 'دوبارہ فعال کریں') : t('Deactivate', 'غیر فعال کریں')}</button>}
      {!self && person.role !== 'admin' && <button className="yf-remove" disabled={busy} onClick={() => { if (window.confirm(t(`Remove ${person.name} from the team? They will be signed out and cannot sign in again.`, `${person.name} کو ٹیم سے ہٹائیں؟ وہ سائن آؤٹ ہو جائیں گے اور دوبارہ سائن اِن نہیں کر سکیں گے۔`))) void act('/erp/admin/users/remove', { userId: person.id }, null); }}><Trash2 size={16} aria-hidden="true" />{t('Remove', 'ہٹائیں')}</button>}
    </div>}
  </li>;
}

function AddPerson({ onDone, onCancel }: { onDone: () => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage();
  const [name, setName] = useState(''); const [pin, setPin] = useState('');
  const [role, setRole] = useState<Role>('supervisor'); const [again, setAgain] = useState('');
  return <AsyncForm title={t('Add a person', 'نیا فرد شامل کریں')} detail={t('They sign in with this name and PIN. Tell them the PIN yourself.', 'وہ اس نام اور پن سے سائن اِن کریں گے۔ پن آپ خود انہیں بتائیں۔')} submit={t('Add person', 'فرد شامل کریں')} note={t('PINs are stored scrambled. Nobody can read them back, not even an admin.', 'پن خفیہ شکل میں محفوظ ہوتے ہیں۔ انہیں ایڈمن بھی نہیں پڑھ سکتا۔')} onCancel={onCancel} onSubmit={async () => {
    if (pin !== again) throw new Error(t('The two PINs are different. Type the same 4 digits twice.', 'دونوں پن مختلف ہیں۔ ایک ہی چار ہندسے دو بار درج کریں۔'));
    await api('/erp/admin/users', { name, pin, role }); await onDone();
  }}>
    <div className="live-fields yf-pin-fields"><Field>{t('Name', 'نام')}<input value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={40} required /></Field><Field>{t('4-digit PIN', 'چار ہندسوں کا پن')}<input type="password" dir="ltr" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="new-password" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} required /></Field></div>
    <Field>{t('Type it again', 'دوبارہ درج کریں')}<input type="password" dir="ltr" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value.replace(/\D/g, ''))} required /></Field>
    <RolePicker value={role} onChange={setRole} />
  </AsyncForm>;
}
