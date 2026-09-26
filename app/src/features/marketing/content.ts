/**
 * Landing-page copy, kept apart from layout so it can be edited without
 * touching components. Every claim here must hold up in a viva: check it
 * against README.md "What it does / does not do" before changing it.
 */

export const hero = {
  eyebrow: 'Final Year Project · IBA Karachi',
  title: 'Check fabric against its label in seconds.',
  body: 'Point a phone at a fabric and its care label. TexPilot checks that what the fabric looks like is consistent with what the label claims, and flags the mismatches.',
};

export const steps = [
  {
    title: 'Photograph the fabric',
    body: 'A close-up of the surface, 10–20 cm away. Blurry or badly lit shots are rejected before upload.',
  },
  {
    title: 'Read the care label',
    body: 'The stated composition, e.g. 60% cotton / 40% polyester, comes from the label itself.',
  },
  {
    title: 'Get a verdict',
    body: 'The visible evidence is cross-checked against the claim, with the reasons shown.',
  },
];

export const verdicts = [
  {
    verdict: 'PASS',
    body: 'What the fabric looks like is consistent with what its label claims.',
  },
  {
    verdict: 'FLAG',
    body: 'A confident mismatch, e.g. a wool structure labelled 100% polyester. Inspect before accepting.',
  },
  {
    verdict: 'INSUFFICIENT_EVIDENCE',
    body: 'The scanner is not sure, so it says so. A scanner that always answers produces confident wrong answers.',
  },
] as const;

export const limits = {
  title: 'What it does not do',
  body: 'It does not read fibre composition from a photograph. Fibre is a molecular property: cotton, modal and viscose look the same. The scanner predicts only what is visible (fabric structure, surface treatment and fibre family), and takes the exact composition from the label.',
};

export const footer = 'TexPilot · CSE 493/494, School of Mathematics and Computer Science, IBA.';
