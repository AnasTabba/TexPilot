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

  // Camera screen: drawn over a live preview, so they must read on any image.
  cameraBackground: '#000000',
  scrim: 'rgba(0, 0, 0, 0.55)',
  shutterRing: 'rgba(255, 255, 255, 0.5)',

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
  display: { fontSize: 40, fontWeight: '800', lineHeight: 46 },
  title: { fontSize: 24, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400' },
  caption: { fontSize: 13, fontWeight: '400' },
} as const;

export type TextVariant = keyof typeof typography;

/**
 * Window-width breakpoints, shared by every surface (phone, tablet, desktop web).
 * Read them through useBreakpoint() in src/hooks, not by comparing widths inline.
 */
export const breakpoints = {
  medium: 600,
  expanded: 1024,
} as const;

export const layout = {
  /** Max width of single-column content (scanner screens, forms) on wide screens. */
  contentMaxWidth: 640,
  /** Max width of full-page layouts (landing page, dashboard content). */
  pageMaxWidth: 1200,
  dashboardSidebarWidth: 240,
} as const;
