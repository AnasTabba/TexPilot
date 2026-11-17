import './empty-iso.css';

type Kind = 'stock' | 'orders' | 'shipments' | 'inbox' | 'people';

export function EmptyIso({ kind }: { kind: Kind }) {
  return <svg className="empty-iso" viewBox="0 0 96 72" aria-hidden="true" focusable="false">
    {kind === 'stock' && <>
      <path d="M24 20h48v40H24zM18 25h48v40H18z" />
      <path d="M18 35h48M18 45h48M18 55h48M29 25v10m12-10v10m12-10v10" />
    </>}
    {kind === 'orders' && <>
      <path d="M29 13h30l10 10v38H29zM59 13v11h10M38 34h21M38 43h21M38 52h15" />
      <path d="m23 20-5 5v38h34" />
    </>}
    {kind === 'shipments' && <>
      <path d="M18 25h37v31H18zM55 35h13l9 10v11H55z" />
      <path d="M55 43h18M27 56a6 6 0 1 0 12 0m23 0a6 6 0 1 0 12 0" />
    </>}
    {kind === 'inbox' && <>
      <path d="M16 24h64v40H16zM16 27l32 23 32-23" />
      <path d="M16 62l22-19m42 19L58 43" />
    </>}
    {kind === 'people' && <>
      <circle cx="37" cy="27" r="9" />
      <path d="M19 62v-6a18 18 0 0 1 36 0v6z" />
      <circle cx="64" cy="31" r="7" />
      <path d="M59 47a14 14 0 0 1 19 13v2H61" />
    </>}
  </svg>;
}
