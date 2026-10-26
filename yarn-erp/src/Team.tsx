import { useCallback, useEffect, useState } from 'react';
import { ArrowRightLeft, ChevronDown, ClipboardCheck, KeyRound, Package, PackagePlus, ShieldCheck, Trash2, Truck, Undo2, UserCheck, UserPlus, type LucideIcon } from 'lucide-react';
import { AsyncForm, Field, errorMessage } from './forms';
import { Avatar } from './SignIn';
import { when } from './WorkspaceDashboard';
import { inventoryRequest as api, type Member, type Permission } from './inventory-client';

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
];
const everything = permissionInfo.map(([id]) => id);
// Starting points for the usual jobs on a mill floor; any mix can still be ticked by hand.
const presets: [string, Permission[]][] = [
  ['Stores', ['receive', 'catalog']], ['Production', ['produce', 'waste']], ['Dispatch', ['dispatch']],
  ['Quality', ['inspect', 'qc']], ['Supervisor', everything],
];
const same = (a: Permission[], b: Permission[]) => a.length === b.length && a.every(p => b.includes(p));
const label = (id: Permission) => permissionInfo.find(([p]) => p === id)![1];
export const accessSummary = (admin: boolean, permissions: Permission[]) => admin ? 'Admin · can do everything'
  : presets.find(([, p]) => same(p, permissions))?.[0] ?? (permissions.length ? permissions.map(label).join(', ') : 'View and scan only');

function PermissionPicker({ value, onChange }: { value: Permission[]; onChange: (value: Permission[]) => void }) {
  return <div className="yf-perms">
    <div className="yf-views yf-presets" role="group" aria-label="Quick choice">{presets.map(([name, permissions]) => <button type="button" key={name} aria-pressed={same(permissions, value)} onClick={() => onChange(permissions)}>{name}</button>)}</div>
    <ul className="yf-perm-list">{permissionInfo.map(([id, name, detail, Icon]) => <li key={id}><label>
      <input type="checkbox" checked={value.includes(id)} onChange={event => onChange(event.target.checked ? [...value, id] : value.filter(p => p !== id))} />
      <Icon size={20} aria-hidden="true" /><span><strong>{name}</strong><small>{detail}</small></span>
    </label></li>)}</ul>
    <p className="live-muted">Everyone can view stock and use the scanner.</p>
  </div>;
}

function AdminSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="yf-switch"><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    <span><strong>Admin</strong><small>{disabled ? 'Another admin can change your own access.' : 'Can do everything, approve new people and manage the team.'}</small></span></label>;
}

/** Admins only: who can sign in, and what each person can record. */
export default function Team({ me, onChanged }: { me: Member; onChanged: () => Promise<void> }) {
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
    {error && <p className="live-error" role="alert">{error}<button className="live-text-button" onClick={() => void load()}>Retry</button></p>}
    {!people && !error && <p role="status" className="live-muted">Loading the team…</p>}
    {waiting.length > 0 && <section className="live-panel" aria-labelledby="yf-waiting">
      <div className="yf-head"><h2 id="yf-waiting">Waiting for you</h2><span>{waiting.length === 1 ? '1 request' : `${waiting.length} requests`}</span></div>
      <div className="yf-requests">{waiting.map(person => <Request key={person.id} person={person} onDone={changed} />)}</div>
    </section>}
    {open === 'new' && <AddPerson onDone={async () => { setOpen(''); await changed(); }} onCancel={() => setOpen('')} />}
    {people && <section className="live-panel" aria-labelledby="yf-people">
      <div className="yf-head"><h2 id="yf-people">People</h2>{open !== 'new' && <button className="button" onClick={() => setOpen('new')}><UserPlus size={18} aria-hidden="true" />Add a person</button>}</div>
      <ul className="yf-team">{active.map(person => <Member key={person.id} person={person} self={person.id === me.user_id} open={open === person.id} onToggle={() => setOpen(open === person.id ? '' : person.id)} onDone={changed} />)}</ul>
    </section>}
  </>;
}

function Request({ person, onDone }: { person: Person; onDone: () => Promise<void> }) {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function act(path: string, body: object) {
    setBusy(true); setError('');
    try { await api(path, body); await onDone(); } catch (error) { setError(errorMessage(error)); setBusy(false); }
  }
  return <article className="yf-request" aria-label={`${person.name} wants to join`}>
    <header><Avatar name={person.name} /><div><strong>{person.name}</strong><span>Asked {when.format(person.created_at)}</span></div></header>
    <p className="live-muted">Choose what {person.name} can record, then approve.</p>
    <PermissionPicker value={permissions} onChange={setPermissions} />
    {error && <p className="live-error" role="alert">{error}</p>}
    <div className="live-actions">
      <button className="button primary" disabled={busy} onClick={() => void act('/users/update', { id: person.id, status: 'active', permissions })}><UserCheck size={18} aria-hidden="true" />Approve {person.name}</button>
      <button className="button" disabled={busy} onClick={() => { if (confirm(`Decline ${person.name}'s request? They can ask again.`)) void act('/users/remove', { id: person.id }); }}>Decline</button>
    </div>
  </article>;
}

function Member({ person, self, open, onToggle, onDone }: { person: Person; self: boolean; open: boolean; onToggle: () => void; onDone: () => Promise<void> }) {
  const [admin, setAdmin] = useState(person.role === 'admin'); const [permissions, setPermissions] = useState(person.permissions);
  const [pin, setPin] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const dirty = admin !== (person.role === 'admin') || !same(permissions, person.permissions);
  async function act(path: string, body: object, done: string) {
    setBusy(true); setError(''); setNotice('');
    try { await api(path, body); setNotice(done); await onDone(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <li className={`yf-member${open ? ' is-open' : ''}`}>
    <button className="yf-member-row" aria-expanded={open} onClick={onToggle}>
      <Avatar name={person.name} /><span><strong>{person.name}{self && <small> · you</small>}</strong><span>{accessSummary(person.role === 'admin', person.permissions)}</span></span>
      {person.locked && <span className="live-quality hold">Locked</span>}<ChevronDown size={20} aria-hidden="true" />
    </button>
    {open && <div className="yf-member-body">
      <AdminSwitch checked={admin} disabled={self || busy} onChange={setAdmin} />
      {!admin && <PermissionPicker value={permissions} onChange={setPermissions} />}
      {dirty && <div className="live-actions"><button className="button primary" disabled={busy} onClick={() => void act('/users/update', { id: person.id, role: admin ? 'admin' : 'member', permissions: admin ? [] : permissions }, `${person.name}'s access is saved.`)}>Save access</button><button className="button" disabled={busy} onClick={() => { setAdmin(person.role === 'admin'); setPermissions(person.permissions); }}>Undo changes</button></div>}
      <form className="yf-pin-reset" onSubmit={event => { event.preventDefault(); void act('/users/update', { id: person.id, pin }, `New PIN set. ${self ? 'Sign in again with it.' : `Tell ${person.name} the new PIN.`}`).then(() => setPin('')); }}>
        <Field>{person.locked ? 'Locked after wrong PINs. Set a new PIN to unlock' : 'Set a new PIN'}<input type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="new-password" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, ''))} required /></Field>
        <button className="button" disabled={busy}><KeyRound size={18} aria-hidden="true" />Set PIN</button>
      </form>
      {error && <p className="live-error" role="alert">{error}</p>}
      {notice && <p className="live-success" role="status"><span>{notice}</span></p>}
      {!self && <button className="live-text-button yf-danger" disabled={busy} onClick={() => { if (confirm(`Remove ${person.name}? They can no longer sign in. Their past entries stay in the history.`)) void act('/users/remove', { id: person.id }, ''); }}>Remove {person.name}</button>}
    </div>}
  </li>;
}

function AddPerson({ onDone, onCancel }: { onDone: () => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(''); const [pin, setPin] = useState('');
  const [admin, setAdmin] = useState(false); const [permissions, setPermissions] = useState<Permission[]>([]);
  return <AsyncForm title="Add a person" detail="They sign in with this name and PIN. Tell them the PIN yourself." submit="Add person" note="PINs are stored scrambled. Nobody can read them back, not even an admin." onCancel={onCancel} onSubmit={async () => {
    await api('/users', { name, pin, role: admin ? 'admin' : 'member', permissions: admin ? [] : permissions }); await onDone();
  }}>
    <div className="live-fields yf-pin-fields"><Field>Name<input value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={40} required /></Field><Field>4-digit PIN<input type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="new-password" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} required /></Field></div>
    <AdminSwitch checked={admin} onChange={setAdmin} />
    {!admin && <PermissionPicker value={permissions} onChange={setPermissions} />}
  </AsyncForm>;
}
