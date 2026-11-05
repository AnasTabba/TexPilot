import './empty-iso.css';

// Isometric 2:1 scenes for empty states. Scene boxes are listed back to front.
type Box = { x: number; y: number; z: number; w: number; d: number; h: number; pop?: boolean };
type Kind = 'stock' | 'orders' | 'shipments' | 'inbox' | 'people';

const SCENES: Record<Kind, Box[]> = {
  stock: [
    { x: 0, y: 0, z: 0, w: 4, d: 3, h: 2 },
    { x: 1, y: 0.6, z: 2, w: 1.6, d: 1.6, h: 1.2, pop: true },
  ],
  orders: [
    { x: 0, y: 0, z: 0, w: 4, d: 4, h: 0.5 },
    { x: 0.8, y: 0.9, z: 0.5, w: 2.4, d: 0.2, h: 2.6 },
    { x: 1.6, y: 0.9, z: 3.1, w: 0.8, d: 0.2, h: 0.4, pop: true },
  ],
  shipments: [
    { x: 0, y: 0, z: 0, w: 4.4, d: 2, h: 0.6 },
    { x: 0, y: 0, z: 0.6, w: 3.2, d: 2, h: 2 },
    { x: 3.3, y: 0, z: 0.6, w: 1.1, d: 2, h: 1.4, pop: true },
  ],
  inbox: [
    { x: 0, y: 0, z: 0, w: 4, d: 3, h: 0.4 },
    { x: 0, y: 0, z: 0.4, w: 0.4, d: 3, h: 1.4 },
    { x: 0, y: 2.6, z: 0.4, w: 4, d: 0.4, h: 1.4 },
    { x: 1.2, y: 0.8, z: 0.8, w: 1.6, d: 1.2, h: 0.1, pop: true },
  ],
  people: [
    { x: 0.4, y: 0.4, z: 0, w: 1.6, d: 1.6, h: 1.4 },
    { x: 2.4, y: 0.4, z: 0, w: 1.6, d: 1.6, h: 2.6 },
    { x: 2.6, y: 0.6, z: 2.6, w: 1.2, d: 1.2, h: 1, pop: true },
  ],
};

const C = Math.sqrt(3) / 2; // cos 30deg: 2:1 isometric axes
const VIEW_W = 200;
const VIEW_H = 120;

// Visible faces of a box: right (x max), left (y max), top (z max).
function faces(b: Box) {
  const { x, y, z, w, d, h } = b;
  return [
    { cls: 'right', pts: [[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]] },
    { cls: 'left', pts: [[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]] },
    { cls: 'top', pts: [[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]] },
  ];
}

function layout(boxes: Box[]) {
  const flat = boxes.flatMap(b => faces(b).flatMap(f => f.pts)).map(([x, y, z]) => [(x - y) * C, (x + y) / 2 - z]);
  const xs = flat.map(p => p[0]);
  const ys = flat.map(p => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = Math.min(160 / (maxX - minX), 84 / (maxY - minY));
  const ox = VIEW_W / 2 - ((minX + maxX) / 2) * s;
  const oy = VIEW_H / 2 - 4 - ((minY + maxY) / 2) * s;
  const project = (x: number, y: number, z: number) => `${((x - y) * C * s + ox).toFixed(1)},${(((x + y) / 2 - z) * s + oy).toFixed(1)}`;
  return { project, ground: { rx: ((maxX - minX) * s) / 2 + 6, cy: maxY * s + oy + 5 } };
}

export function EmptyIso({ kind }: { kind: Kind }) {
  const boxes = SCENES[kind];
  const { project, ground } = layout(boxes);
  return (
    <svg className="empty-iso" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} aria-hidden="true" focusable="false">
      <ellipse className="eiso-ground" cx={VIEW_W / 2} cy={ground.cy} rx={ground.rx} ry={5} />
      {boxes.map((b, i) =>
        faces(b).map(f => (
          <polygon
            key={`${i}-${f.cls}`}
            className={`eiso-${b.pop ? 'pop-' : ''}${f.cls}`}
            points={f.pts.map(([x, y, z]) => project(x, y, z)).join(' ')}
          />
        )),
      )}
    </svg>
  );
}
