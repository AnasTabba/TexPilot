import './sign-in-scene.css';

// True isometric (30 degree axes). World units: x and y are floor axes, z is height.
type V = [number, number, number];
type P = [number, number];
type Side = 'top' | 'left' | 'right';
type Face = { side: Side; poly: P[] };
type Part = { faces: Face[]; pop?: boolean; float?: boolean };

const C = Math.cos(Math.PI / 6);
const proj = ([x, y, z]: V): P => [(x - y) * C, (x + y) / 2 - z];
const r2 = (n: number) => Math.round(n * 100) / 100;
const polyD = (ps: P[]) => `M${ps.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}Z`;

/** Convex hull (monotone chain): the silhouette of a cylinder or cone. */
function hull(points: P[]): P[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P[] = [], upper: P[] = [];
  for (const q of p) { while (lower.length > 1 && cross(lower.at(-2)!, lower.at(-1)!, q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length > 1 && cross(upper.at(-2)!, upper.at(-1)!, q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const ring = (cx: number, cy: number, z: number, r: number): P[] =>
  Array.from({ length: 24 }, (_, i) => proj([cx + r * Math.cos((i / 24) * Math.PI * 2), cy + r * Math.sin((i / 24) * Math.PI * 2), z]));

/** Axis-aligned box: top, and the two faces the viewer sees (+y left, +x right). */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Face[] {
  return [
    { side: 'top', poly: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map(v => proj(v as V)) },
    { side: 'left', poly: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]].map(v => proj(v as V)) },
    { side: 'right', poly: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]].map(v => proj(v as V)) },
  ];
}

/** A yarn cone standing on z0: wide base, narrow tip. Left and right halves get their own tones. */
function cone(cx: number, cy: number, z0: number, h: number, r = 0.55, rt = 0.22): Face[] {
  const base = ring(cx, cy, z0, r), top = ring(cx, cy, z0 + h, rt);
  const axisB = proj([cx, cy, z0]), axisT = proj([cx, cy, z0 + h]);
  const all = [...base, ...top];
  return [
    { side: 'left', poly: hull(all) },
    { side: 'right', poly: hull([...all.filter(p => p[0] >= axisB[0]), axisB, axisT]) },
    { side: 'top', poly: top },
  ];
}

// Pallet A on the floor, pallet B stacked on A's cones, a conveyor with one accent cone.
const parts: Part[] = [
  { faces: box(0, 2.4, 0, 2.4, 0, 0.3) },
  { faces: cone(0.6, 0.6, 0.3, 1.7) },
  { faces: cone(1.8, 0.6, 0.3, 1.7) },
  { faces: cone(0.6, 1.8, 0.3, 1.7) },
  { faces: cone(1.8, 1.8, 0.3, 1.7) },
  { faces: box(0, 2.4, 0, 2.4, 2.0, 2.3) },
  { faces: cone(0.6, 0.6, 2.3, 1.4) },
  { faces: cone(1.8, 0.6, 2.3, 1.4) },
  { faces: cone(1.2, 1.8, 2.3, 1.4) },
  { faces: [...box(4.4, 4.6, 0.6, 0.8, 0, 0.85), ...box(7.6, 7.8, 0.6, 0.8, 0, 0.85), ...box(4.4, 4.6, 1.6, 1.8, 0, 0.85), ...box(7.6, 7.8, 1.6, 1.8, 0, 0.85)] },
  { faces: box(4.4, 7.8, 0.6, 1.8, 0.85, 0.95) },
  { faces: cone(6.0, 1.2, 0.95, 1.0, 0.4, 0.16), pop: true, float: true },
];

const shadow = hull([[0, 0], [2.4, 0], [2.4, 2.4], [0, 2.4], [4.4, 0.6], [7.8, 0.6], [7.8, 1.8], [4.4, 1.8]].map(([x, y]) => proj([x, y, 0])));
const all = [...parts.flatMap(p => p.faces.flatMap(f => f.poly)), ...shadow];
const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
const pad = 0.3;
const VIEW = `${r2(minX - pad)} ${r2(minY - pad)} ${r2(Math.max(...xs) - minX + 2 * pad)} ${r2(Math.max(...ys) - minY + 2 * pad)}`;

/** Decorative mill floor: two stacked yarn-cone pallets, a small conveyor, one cone in the accent colour. */
export default function SignInScene() {
  return <svg className="yf-iso-scene" viewBox={VIEW} aria-hidden="true" focusable="false">
    <path className="yf-iso-shadow" d={polyD(shadow)} />
    {parts.map((part, i) => <g key={i} className="yf-iso-part" style={{ animationDelay: `${i * 40}ms` }}>
      <g className={part.float ? 'yf-iso-float' : undefined}>
        <g className={part.pop ? 'yf-iso-pop' : undefined}>
          {part.faces.map((face, j) => <path key={j} className={`yf-iso-${face.side}`} d={polyD(face.poly)} />)}
        </g>
      </g>
    </g>)}
  </svg>;
}
