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

/** Factory inventory: soft surfaces, restrained colour and readable mobile controls. */
export const inventoryTheme = {
  color: {
    background: '#F5F5F7',
    surface: '#FFFFFF',
    ink: '#151419',
    muted: '#6D6B76',
    line: '#E9E8EE',
    accent: '#6253D5',
    accentStrong: '#5142B5',
    accentSoft: '#ECE8FC',
    violet: '#AA9BEB',
    violetInk: '#292046',
    lilac: '#DDD6FA',
    purple: '#6253D5',
    purpleSoft: '#EFECFC',
    mint: '#CBE3DC',
    peach: '#F4E6BA',
    pink: '#E8B2C4',
    roseSoft: '#FAEBF0',
    roseInk: '#9C3D5B',
    green: '#32725A',
    greenSoft: '#EAF3ED',
    amber: '#91651C',
    amberSoft: '#FBF3E4',
    danger: '#B42318',
    transparent: 'transparent',
    scrim: 'rgba(20, 27, 36, 0.34)',
    shadow: 'rgba(24, 37, 52, 0.035)',
    denim: '#596D88',
    cotton: '#D7D2C6',
    polyester: '#9BABB5',
    jersey: '#9CAFA4',
    linen: '#C9B99F',
    rose: '#C6A4AA',
    charcoal: '#656870',
    satin: '#DED6D7',
    weave: 'rgba(255,255,255,0.22)',
    weaveDark: 'rgba(33,41,56,0.10)',
  },
  space: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, section: 22, page: 20 },
  radius: { sm: 12, md: 18, lg: 24, xl: 30, pill: 999 },
  type: {
    micro: 10,
    small: 12,
    brand: 23,
    hero: 32,
    total: 44,
    metric: 30,
    caption: 13,
    body: 14,
    label: 15,
    heading: 19,
    title: 28,
    display: 40,
  },
  size: { touch: 48, nav: 70, max: 540, icon: 20, smallIcon: 16, swatch: 54, chart: 86 },
} as const;
