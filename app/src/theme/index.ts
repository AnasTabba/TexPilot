/**
 * Design tokens. Components read from here -- never hard-code a colour or a
 * spacing value in a screen.
 */

export const colors = {
  background: '#F7F9FD',
  surface: '#FFFFFF',
  border: '#E9EDF4',
  text: '#1C2B46',
  textMuted: '#526276',
  primary: '#2860D5',
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

/** Fabric-library identity and responsive mobile preview. */
export const fabricTheme = {
  ink: '#1C2B46',
  muted: '#788397',
  blue: '#2860D5',
  blueDark: '#1E4EB8',
  blueSoft: '#E9F0FF',
  stage: '#EDF2FA',
  white: '#FFFFFF',
  line: '#E9EDF4',
  denim: '#E4EDFB',
  cotton: '#F2F0EB',
  polyester: '#F4E6E5',
  grey: '#EBEDF0',
  red: '#A44844',
  paleInk: '#526276',
  heroCircle: '#487AE0',
  heroLine: '#6892E6',
  onBlueMuted: '#D9E5FF',
  shadow: 'rgba(28, 53, 100, 0.08)',
  transparent: 'transparent',
  phoneWidth: 326,
  phoneHeight: 704,
  phoneRadius: 34,
  cardRadius: 20,
  space: { tiny: 2, xs: 4, sm: 8, md: 12, lg: 20, xl: 28, xxl: 40, stage: 48 },
  type: {
    micro: 10,
    small: 11,
    caption: 12,
    body: 14,
    heading: 18,
    title: 25,
    hero: 32,
    brand: 22,
  },
} as const;
