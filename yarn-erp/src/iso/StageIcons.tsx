import './stage-icons.css';

export type StageIconName = 'rfq' | 'bid' | 'po' | 'incoming' | 'inspect' | 'request' | 'approve' | 'dispatch' | 'deliver';
export type StageState = 'current' | 'done' | 'idle';

type Pt = [number, number, number];
type Face = 'top' | 'left' | 'right';
type Tone = 'brand' | 'accent' | 'paper';
type Item =
  | { kind: 'face'; tone: Tone; face: Face; pts: Pt[] }
  | { kind: 'rule'; accent?: boolean; pts: Pt[] }
  | { kind: 'lens'; pts: Pt[] };

/** Solid box [x0, x1, y0, y1, z0, z1] in world units. Visible faces: top, left (y max), right (x max). mirror -1 flips x. */
function solid(tone: Tone, [x0, x1, y0, y1, z0, z1]: number[], mirror = 1): Item[] {
  const [a, b] = mirror < 0 ? [-x1, -x0] : [x0, x1];
  return [
    { kind: 'face', tone, face: 'left', pts: [[a, y1, z0], [b, y1, z0], [b, y1, z1], [a, y1, z1]] },
    { kind: 'face', tone, face: 'right', pts: [[b, y0, z0], [b, y1, z0], [b, y1, z1], [b, y0, z1]] },
    { kind: 'face', tone, face: 'top', pts: [[a, y0, z1], [b, y0, z1], [b, y1, z1], [a, y1, z1]] },
  ];
}

/** Flat circle lying on the plane z (true iso ellipse once projected). */
function ring(cx: number, cy: number, z: number, r: number): Pt[] {
  return Array.from({ length: 28 }, (_, k) => [cx + r * Math.cos((k / 28) * 2 * Math.PI), cy + r * Math.sin((k / 28) * 2 * Math.PI), z] as Pt);
}

/** Sheet standing on the ground, facing +x: its large face is the right face. */
const sheet = (z: number, rules: number[]): Item[] => [
  ...solid('paper', [-0.4, 0.4, -5, 5, 0, z]),
  ...rules.map((rz): Item => ({ kind: 'rule', pts: [[0.42, -3.2, rz], [0.42, 3.2, rz]] })),
];

const truck = (mirror: number): Item[] => [
  ...solid('brand', [-6, 1, -3.2, 3.2, 2.2, 8], mirror),
  ...solid('brand', [1, 5, -3.2, 3.2, 2.2, 6], mirror),
  ...solid('accent', [-4.6, -2.6, 3.2, 4.2, 0, 1.6], mirror),
  ...solid('accent', [2.4, 4.4, 3.2, 4.2, 0, 1.6], mirror),
];

const ICONS: Record<StageIconName, Item[]> = {
  rfq: sheet(11, [8, 5.5, 3]),
  request: [...sheet(11, [7.5, 4.5]), ...solid('brand', [-1.2, 1.2, -1.6, 1.6, 10.6, 13])],
  bid: [...solid('brand', [-4, 4, -4, 4, 0, 1.6]), ...solid('accent', [-1.6, 1.6, -1.6, 1.6, 1.6, 4.2])],
  po: [...sheet(10, [7, 4]), ...solid('accent', [1.2, 3.6, -2.6, 0, 0, 2.2])],
  incoming: truck(1),
  dispatch: truck(-1),
  inspect: [...solid('brand', [-4, 2, -4, 2, 0, 5]), { kind: 'lens', pts: ring(-1, -1, 5, 2.6) }],
  approve: [...solid('brand', [-5, 5, -5, 5, 0, 10]), { kind: 'rule', accent: true, pts: [[-2.6, 0.4, 10], [-0.6, 2.4, 10], [2.8, -1.8, 10]] }],
  deliver: [...solid('brand', [-4, 4, -4, 4, 0, 7]), ...solid('paper', [-0.3, 0.3, -0.3, 0.3, 7, 15]), ...solid('accent', [-0.2, 0.2, 0.3, 4.6, 10, 14])],
};

const K = 1.3;
const proj = ([x, y, z]: Pt): [number, number] => [(x - y) * 0.866 * K, ((x + y) * 0.5 - z) * K];

type Shape = { tag: 'polygon' | 'polyline'; cls: string; points: string };

/** Projects once at load and centres each icon in its 40-unit viewBox. */
function build(items: Item[]): Shape[] {
  const flat = items.flatMap(i => i.pts.map(proj));
  const xs = flat.map(p => p[0]), ys = flat.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return items.map((item): Shape => {
    const points = item.pts.map(p => { const [x, y] = proj(p); return `${(x - cx).toFixed(2)},${(y - cy).toFixed(2)}`; }).join(' ');
    if (item.kind === 'rule') return { tag: 'polyline', cls: `iso-rule${item.accent ? ' is-accent' : ''}`, points };
    if (item.kind === 'lens') return { tag: 'polygon', cls: 'iso-lens', points };
    return { tag: 'polygon', cls: `iso-face is-${item.tone} iso-${item.face}`, points };
  });
}

const SHAPES = Object.fromEntries(Object.entries(ICONS).map(([name, items]) => [name, build(items)])) as Record<StageIconName, Shape[]>;

/** Small isometric stage glyph. Decorative: always pair with visible text. */
export function StageIcon({ name, state = 'idle' }: { name: StageIconName; state?: StageState }) {
  return <svg className={`iso-stage st-${state}`} viewBox="-20 -20 40 40" aria-hidden="true" focusable="false">
    {SHAPES[name].map((s, i) => s.tag === 'polyline'
      ? <polyline key={i} className={s.cls} points={s.points} />
      : <polygon key={i} className={s.cls} points={s.points} />)}
  </svg>;
}

/** Pipeline state from ordered steps: step at index `active` is current, earlier ones done, the rest idle. */
export function stageState(index: number, active: number): StageState {
  return index === active ? 'current' : index < active ? 'done' : 'idle';
}
