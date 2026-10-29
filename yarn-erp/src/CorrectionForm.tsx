import { useState, type ReactNode } from 'react';
import { inventoryRequest as api, type Member, type Role } from './inventory-client';
import { AsyncForm, Field } from './forms';
import { InterventionField } from './PortalCommon';
import { useLanguage } from './i18n';

interface CorrectionProps {
  member: Member;
  title: string;
  /** What the correction does, in plain words, shown under the title. */
  effect: string;
  submit: string;
  /** Roles that may make this correction; admins also need an intervention reason when they are not one of them. */
  owners: Role[];
  path: string;
  /** Extra fields for the request. The request ID is added as `requestField`, so a repeated send does nothing twice. */
  payload: () => Record<string, unknown>;
  requestField?: string;
  onSaved: (message?: string) => Promise<void>;
  onCancel: () => void;
  children?: ReactNode;
}

/** A reversal the server records as a new row with a reason. Nothing the user typed is erased. */
export function CorrectionForm({ member, title, effect, submit, owners, path, payload, requestField = 'id', onSaved, onCancel, children }: CorrectionProps) {
  const { t } = useLanguage();
  const [requestId] = useState(() => crypto.randomUUID()), [reason, setReason] = useState(''), [intervention, setIntervention] = useState('');
  return <AsyncForm title={title} detail={effect} submit={submit} onCancel={onCancel}
    note={t('The original record stays in the history with this reason beside it.', 'اصل ریکارڈ اس وجہ کے ساتھ تاریخ میں رہتا ہے۔')}
    onSubmit={async () => {
      await api(path, { [requestField]: requestId, ...payload(), reason, ...(intervention ? { interventionReason: intervention } : {}) });
      await onSaved();
    }}>
    {children}
    <Field>{t('Reason for the correction', 'درستی کی وجہ')}<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={500} required /></Field>
    <InterventionField member={member} owners={owners} value={intervention} onChange={setIntervention} />
  </AsyncForm>;
}

/** A button that opens the correction form in place. */
export function Correction({ label, ...form }: Omit<CorrectionProps, 'onCancel'> & { label: string }) {
  const [shown, setShown] = useState(false);
  if (!shown) return <button className="button" onClick={() => setShown(true)}>{label}</button>;
  return <CorrectionForm {...form} onCancel={() => setShown(false)} />;
}
