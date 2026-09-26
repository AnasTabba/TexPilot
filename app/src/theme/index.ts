/**
 * Design tokens. Components read from here -- never hard-code a colour or a
 * spacing value in a screen.
 */

export const colors = {
  background: '#F7F7F5',
  surface: '#FFFFFF',
  border: '#E3E3DF',
  text: '#1B1B19',
  textMuted: '#62625C',
  primary: '#1F4E8C',
  onPrimary: '#FFFFFF',
  danger: '#B42318',

  // One tone per verdict. INSUFFICIENT_EVIDENCE is deliberately neutral, not
  // red: abstaining is a normal outcome, not an error.
  pass: '#1E7B45',
  passSoft: '#E4F3EA',
  flag: '#B54708',
  flagSoft: '#FDF0E1',
  abstain: '#475467',
  abstainSoft: '#EEF0F3',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
} as const;

export const typography = {
  title: { fontSize: 24, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400' },
  caption: { fontSize: 13, fontWeight: '400' },
} as const;

export type TextVariant = keyof typeof typography;
