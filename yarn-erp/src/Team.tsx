import { useCallback, useEffect, useState } from 'react';
import { ArrowRightLeft, ChevronDown, ClipboardCheck, KeyRound, Package, PackagePlus, ShieldCheck, Trash2, Truck, Undo2, UserCheck, UserPlus, type LucideIcon } from 'lucide-react';
import { AsyncForm, Field, errorMessage } from './forms';
import { Avatar } from './SignIn';
import { when } from './WorkspaceDashboard';
import { inventoryRequest as api, type Member, type Permission } from './inventory-client';
import { translate, useLanguage } from './i18n';

interface Person { id: string; name: string; role: 'admin' | 'member'; status: 'active' | 'pending'; permissions: Permission[]; created_at: number; locked: boolean }

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
const everything = permissionInfo.map(([id]) => id);
// Starting points for the usual jobs on a mill floor; any mix can still be ticked by hand.
const presets: [string, Permission[]][] = [
  ['Stores', ['receive', 'catalog']], ['Production', ['produce', 'waste']], ['Dispatch', ['dispatch']],
  ['Quality', ['inspect', 'qc']], ['Supervisor', everything],
  ['Purchase manager', ['suppliers', 'procure']], ['Sales manager', ['sales', 'payments']],
  ['Production manager', ['production', 'produce', 'waste']], ['Inventory manager', ['receive', 'catalog', 'dispatch']],
];
const same = (a: Permission[], b: Permission[]) => a.length === b.length && a.every(p => b.includes(p));
const label = (id: Permission) => permissionInfo.find(([p]) => p === id)![1];
const permissionUrdu: Record<Permission, [string, string]> = {
  receive: ['مال وصول کریں', 'آنے والا مال اسٹاک میں درج کریں'],
  produce: ['مراحل کے درمیان منتقل کریں', 'خام مال سے زیرِ تیاری، پھر تیار مال تک'],
  dispatch: ['ڈسپیچ کریں', 'منظور شدہ مال گاہکوں کو بھیجیں'],
  waste: ['ضائع شدہ مال درج کریں', 'خراب یا گم شدہ مال اسٹاک سے نکالیں'],
  catalog: ['میٹیریل اور بیچ', 'نیا دھاگا اور اس کے بیچ شامل کریں'],
  inspect: ['معائنے', 'کیئر لیبل اور اسکین کے شواہد درج کریں'],
  qc: ['کوالٹی کے فیصلے', 'بیچ منظور کریں یا روک دیں'],
  reverse: ['اندراج واپس کریں', 'وجہ بتا کر محفوظ اندراج درست کریں'],
  suppliers: ['سپلائر ڈائریکٹری', 'سپلائر رابطے اور اقسام سنبھالیں'],
  procure: ['خریداری', 'درخواستیں، بولیاں اور خریداری آرڈر سنبھالیں'],
  sales: ['فروخت کے آرڈر', 'خریدار، قیمتیں اور انوائس سنبھالیں'],
  production: ['پروڈکشن کی منصوبہ بندی', 'مشینوں، شفٹوں اور بیچوں کی منصوبہ بندی کریں'],
  payments: ['خریدار کی ادائیگیاں', 'ادائیگیاں اور وصولیاں درج کریں'],
};
const presetUrdu: Record<string, string> = { Stores: 'اسٹور', Production: 'پروڈکشن', Dispatch: 'ڈسپیچ', Quality: 'کوالٹی', Supervisor: 'سپروائزر', 'Purchase manager': 'خریداری مینیجر', 'Sales manager': 'سیلز مینیجر', 'Production manager': 'پروڈکشن مینیجر', 'Inventory manager': 'انوینٹری مینیجر' };
export const accessSummary = (admin: boolean, permissions: Permission[], language: 'en' | 'ur' = 'en') => {
  if (admin) return translate(language, 'Admin · can do everything', 'ایڈمن · تمام اختیارات');
  const preset = presets.find(([, p]) => same(p, permissions))?.[0];
  return preset ? translate(language, preset, presetUrdu[preset]) : permissions.length
    ? permissions.map(id => translate(language, label(id), permissionUrdu[id][0])).join(language === 'ur' ? '، ' : ', ')
    : translate(language, 'View and scan only', 'صرف دیکھنے اور اسکین کرنے کی اجازت');
};

function PermissionPicker({ value, onChange }: { value: Permission[]; onChange: (value: Permission[]) => void }) {
  const { t } = useLanguage();
  return <div className="yf-perms">
    <div className="yf-views yf-presets" role="group" aria-label={t('Quick choice', 'فوری انتخاب')}>{presets.map(([name, permissions]) => <button type="button" key={name} aria-pressed={same(permissions, value)} onClick={() => onChange(permissions)}>{t(name, presetUrdu[name])}</button>)}</div>
    <ul className="yf-perm-list">{permissionInfo.map(([id, name, detail, Icon]) => <li key={id}><label>
      <input type="checkbox" checked={value.includes(id)} onChange={event => onChange(event.target.checked ? [...value, id] : value.filter(p => p !== id))} />
      <Icon size={20} aria-hidden="true" /><span><strong>{t(name, permissionUrdu[id][0])}</strong><small>{t(detail, permissionUrdu[id][1])}</small></span>
    </label></li>)}</ul>
    <p className="live-muted">{t('Everyone can view stock and use the scanner.', 'سب اسٹاک دیکھ سکتے ہیں اور اسکینر استعمال کر سکتے ہیں۔')}</p>
  </div>;
}

function AdminSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  const { t } = useLanguage();
  return <label className="yf-switch"><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    <span><strong>{t('Admin', 'ایڈمن')}</strong><small>{disabled ? t('Another admin can change your own access.', 'آپ کے اختیارات کوئی دوسرا ایڈمن بدل سکتا ہے۔') : t('Can do everything, approve new people and manage the team.', 'تمام کام کر سکتا ہے، نئے لوگوں کو منظور اور ٹیم کا انتظام کر سکتا ہے۔')}</small></span></label>;
}

/** Admins only: who can sign in, and what each person can record. */
export default function Team({ me, onChanged }: { me: Member; onChanged: () => Promise<void> }) {
  const { t } = useLanguage();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState(''); const [open, setOpen] = useState('');
  const load = useCallback(async () => {
    try { setPeople((await api<{ users: Person[] }>('/users')).users); setError(''); } catch (error) { setError(errorMessage(error)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const changed = async () => { await load(); await onChanged(); };
  const waiting = people?.filter(p => p.status === 'pending') ?? [];
  const active = people?.filter(p => p.status === 'active') ?? [];
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
      <ul className="yf-team">{active.map(person => <Member key={person.id} person={person} self={person.id === me.user_id} open={open === person.id} onToggle={() => setOpen(open === person.id ? '' : person.id)} onDone={changed} />)}</ul>
    </section>}
  </>;
}

function Request({ person, onDone }: { person: Person; onDone: () => Promise<void> }) {
  const { language, t } = useLanguage();
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function act(path: string, body: object) {
    setBusy(true); setError('');
    try { await api(path, body); await onDone(); } catch (error) { setError(errorMessage(error)); setBusy(false); }
  }
  return <article className="yf-request" aria-label={t(`${person.name} wants to join`, `${person.name} شامل ہونا چاہتے ہیں`)}>
    <header><Avatar name={person.name} /><div><strong>{person.name}</strong><span>{t('Asked', 'درخواست دی')} {when.format(person.created_at, language)}</span></div></header>
    <p className="live-muted">{t(`Choose what ${person.name} can record, then approve.`, `${person.name} کے اندراج کے اختیارات چنیں، پھر منظوری دیں۔`)}</p>
    <PermissionPicker value={permissions} onChange={setPermissions} />
    {error && <p className="live-error" role="alert">{t(error)}</p>}
    <div className="live-actions">
      <button className="button primary" disabled={busy} onClick={() => void act('/users/update', { id: person.id, status: 'active', permissions })}><UserCheck size={18} aria-hidden="true" />{t(`Approve ${person.name}`, `${person.name} کو منظور کریں`)}</button>
      <button className="button" disabled={busy} onClick={() => { if (confirm(t(`Decline ${person.name}'s request? They can ask again.`, `${person.name} کی درخواست مسترد کریں؟ وہ دوبارہ درخواست دے سکتے ہیں۔`))) void act('/users/remove', { id: person.id }); }}>{t('Decline', 'مسترد کریں')}</button>
    </div>
  </article>;
}

function Member({ person, self, open, onToggle, onDone }: { person: Person; self: boolean; open: boolean; onToggle: () => void; onDone: () => Promise<void> }) {
  const { language, t } = useLanguage();
  const [admin, setAdmin] = useState(person.role === 'admin'); const [permissions, setPermissions] = useState(person.permissions);
  const [pin, setPin] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState<[string, string?] | null>(null);
  const dirty = admin !== (person.role === 'admin') || !same(permissions, person.permissions);
  async function act(path: string, body: object, done: [string, string?] | null) {
    setBusy(true); setError(''); setNotice(null);
    try { await api(path, body); setNotice(done); await onDone(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <li className={`yf-member${open ? ' is-open' : ''}`}>
    <button className="yf-member-row" aria-expanded={open} onClick={onToggle}>
      <Avatar name={person.name} /><span><strong>{person.name}{self && <small> · {t('you', 'آپ')}</small>}</strong><span>{accessSummary(person.role === 'admin', person.permissions, language)}</span></span>
      {person.locked && <span className="live-quality hold">{t('Locked', 'مقفل')}</span>}<ChevronDown size={20} aria-hidden="true" />
    </button>
    {open && <div className="yf-member-body">
      <AdminSwitch checked={admin} disabled={self || busy} onChange={setAdmin} />
      {!admin && <PermissionPicker value={permissions} onChange={setPermissions} />}
      {dirty && <div className="live-actions"><button className="button primary" disabled={busy} onClick={() => void act('/users/update', { id: person.id, role: admin ? 'admin' : 'member', permissions: admin ? [] : permissions }, [`${person.name}'s access is saved.`, `${person.name} کے اختیارات محفوظ ہو گئے۔`])}>{t('Save access', 'اختیارات محفوظ کریں')}</button><button className="button" disabled={busy} onClick={() => { setAdmin(person.role === 'admin'); setPermissions(person.permissions); }}>{t('Undo changes', 'تبدیلیاں واپس کریں')}</button></div>}
      <form className="yf-pin-reset" onSubmit={event => { event.preventDefault(); void act('/users/update', { id: person.id, pin }, [`New PIN set. ${self ? 'Sign in again with it.' : `Tell ${person.name} the new PIN.`}`, `نیا پن مقرر ہو گیا۔ ${self ? 'اس سے دوبارہ سائن اِن کریں۔' : `${person.name} کو نیا پن بتا دیں۔`}`]).then(() => setPin('')); }}>
        <Field>{person.locked ? t('Locked after wrong PINs. Set a new PIN to unlock', 'غلط پن سے اکاؤنٹ مقفل ہے۔ کھولنے کے لیے نیا پن مقرر کریں') : t('Set a new PIN', 'نیا پن مقرر کریں')}<input type="password" dir="ltr" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="new-password" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, ''))} required /></Field>
        <button className="button" disabled={busy}><KeyRound size={18} aria-hidden="true" />{t('Set PIN', 'پن مقرر کریں')}</button>
      </form>
      {error && <p className="live-error" role="alert">{t(error)}</p>}
      {notice && <p className="live-success" role="status"><span>{t(...notice)}</span></p>}
      {!self && <button className="live-text-button yf-danger" disabled={busy} onClick={() => { if (confirm(t(`Remove ${person.name}? They can no longer sign in. Their past entries stay in the history.`, `${person.name} کو ہٹا دیں؟ وہ سائن اِن نہیں کر سکیں گے۔ ان کے پرانے اندراج ہسٹری میں رہیں گے۔`))) void act('/users/remove', { id: person.id }, null); }}>{t(`Remove ${person.name}`, `${person.name} کو ہٹائیں`)}</button>}
    </div>}
  </li>;
}

function AddPerson({ onDone, onCancel }: { onDone: () => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage();
  const [name, setName] = useState(''); const [pin, setPin] = useState('');
  const [admin, setAdmin] = useState(false); const [permissions, setPermissions] = useState<Permission[]>([]);
  return <AsyncForm title={t('Add a person', 'نیا فرد شامل کریں')} detail={t('They sign in with this name and PIN. Tell them the PIN yourself.', 'وہ اس نام اور پن سے سائن اِن کریں گے۔ پن آپ خود انہیں بتائیں۔')} submit={t('Add person', 'فرد شامل کریں')} note={t('PINs are stored scrambled. Nobody can read them back, not even an admin.', 'پن خفیہ شکل میں محفوظ ہوتے ہیں۔ انہیں ایڈمن بھی نہیں پڑھ سکتا۔')} onCancel={onCancel} onSubmit={async () => {
    await api('/users', { name, pin, role: admin ? 'admin' : 'member', permissions: admin ? [] : permissions }); await onDone();
  }}>
    <div className="live-fields yf-pin-fields"><Field>{t('Name', 'نام')}<input value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={40} required /></Field><Field>{t('4-digit PIN', 'چار ہندسوں کا پن')}<input type="password" dir="ltr" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="new-password" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} required /></Field></div>
    <AdminSwitch checked={admin} onChange={setAdmin} />
    {!admin && <PermissionPicker value={permissions} onChange={setPermissions} />}
  </AsyncForm>;
}
