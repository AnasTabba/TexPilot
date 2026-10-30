import type { CSSProperties } from 'react';
import './warehouse-scene.css';

// True 2:1 isometric (30deg axes): world (x, y, z) to screen units. Decorative only, no data.
const S = 40;
const project = (x: number, y: number, z: number): [number, number] => [(x - y) * 0.866 * S, ((x + y) * 0.5 - z) * S];
const pts = (list: [number, number, number][]) => list.map(p => project(...p).map(v => v.toFixed(1)).join(',')).join(' ');

type Solid = { x: number; y: number; z: number; w: number; d: number; h: number; pop?: boolean; cone?: boolean };

// Rack along x, or along y when flip is set (axes swap, so the shape stays a clean isometric box).
function rack(x0: number, y0: number, len: number, dep: number, flip = false): Solid[] {
  // Build in local (lx, ly) then map to world: flip puts lx on world y and ly on world x.
  const place = (lx: number, ly: number, z: number, lw: number, ld: number, h: number): Solid =>
    flip ? { x: ly, y: lx, z, w: ld, d: lw, h } : { x: lx, y: ly, z, w: lw, d: ld, h };
  const carton = (lx: number, z: number, w: number, h: number): Solid => place(lx, y0 + 0.1, z, w, 0.5, h);
  const shelf = (z: number): Solid => place(x0, y0, z, len, dep, 0.08);
  return [
    place(x0, y0, 0, 0.1, 0.1, 2.5),
    place(x0 + len - 0.1, y0, 0, 0.1, 0.1, 2.5),
    shelf(0), carton(x0 + 0.2, 0.08, 0.55, 0.5), carton(x0 + 1.0, 0.08, 0.55, 0.35),
    shelf(0.9), carton(x0 + 0.3, 0.98, 0.6, 0.45), carton(x0 + 1.5, 0.98, 0.5, 0.5),
    shelf(1.8), carton(x0 + 0.2, 1.88, 0.55, 0.4), carton(x0 + 1.1, 1.88, 0.6, 0.5),
    place(x0, y0 + dep - 0.1, 0, 0.1, 0.1, 2.5),
    place(x0 + len - 0.1, y0 + dep - 0.1, 0, 0.1, 0.1, 2.5),
  ];
}

const groups: Solid[][] = [
  rack(0.2, 0.1, 2.6, 0.7),
  rack(3.4, 0.6, 2.4, 0.7, true),
  [
    { x: 1.0, y: 1.8, z: 0, w: 1.4, d: 1.0, h: 0.08 },
    { x: 1.2, y: 1.9, z: 0.08, w: 0.6, d: 0.5, h: 0.45 },
    { x: 1.9, y: 2.1, z: 0.08, w: 0.45, d: 0.45, h: 0.3 },
    { x: 2.5, y: 2.3, z: 0, w: 0.6, d: 0.6, h: 0.5, pop: true },
    { x: 0.35, y: 2.6, z: 0, w: 0.4, d: 0.4, h: 0.6, cone: true },
  ],
];

const faces = (s: Solid) => {
  const { x, y, z, w, d, h } = s;
  const x1 = x + w, y1 = y + d, z1 = z + h;
  if (s.cone) {
    const apex: [number, number, number] = [x + w / 2, y + d / 2, z1];
    return [
      { cls: 'wsc-left', p: [[x, y1, z], [x1, y1, z], apex] },
      { cls: 'wsc-right', p: [[x1, y, z], [x1, y1, z], apex] },
    ];
  }
  return [
    { cls: 'wsc-top', p: [[x, y, z1], [x1, y, z1], [x1, y1, z1], [x, y1, z1]] },
    { cls: 'wsc-left', p: [[x, y1, z], [x1, y1, z], [x1, y1, z1], [x, y1, z1]] },
    { cls: 'wsc-right', p: [[x1, y, z], [x1, y1, z], [x1, y1, z1], [x1, y, z1]] },
  ];
};

/** Isometric corner of a warehouse: two racks, cartons, a cone, one pop box for "needs attention". Static, no numbers. */
export function WarehouseScene({ className = '' }: { className?: string }) {
  return <svg className={`wsc ${className}`.trim()} viewBox="-160 -120 320 250" aria-hidden="true" focusable="false">
    <ellipse className="wsc-ground" cx={project(2.4, 2.4, 0)[0]} cy={project(2.4, 2.4, 0)[1] + 4} rx="150" ry="52" />
    {groups.map((solids, gi) => <g key={gi} className="wsc-group" style={{ '--i': gi } as CSSProperties}>
      {solids.map((s, si) => <g key={si} className={`wsc-solid${s.pop ? ' is-pop' : ''}`}>
        {faces(s).map((f, fi) => <polygon key={fi} className={`wsc-face ${f.cls}`} points={pts(f.p as [number, number, number][])} />)}
      </g>)}
    </g>)}
  </svg>;
}
