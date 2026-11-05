import "./scan-stage.css";

// Isometric scanning stage for the empty capture state only. Decorative: no text, no results.
// True 2:1 projection (30 degree axes). Each solid is drawn as top, left (+y) and right (+x) faces.
const S = 26;
const COS = Math.cos(Math.PI / 6);
const OX = 120;
const OY = 69;

const r = (n: number) => Math.round(n * 10) / 10;
const xy = (x: number, y: number, z: number): [number, number] => [
  r((x - y) * COS * S + OX),
  r((x + y) * 0.5 * S - z * S + OY),
];
const pt = (x: number, y: number, z: number) => xy(x, y, z).join(",");

type Face = { tone: "top" | "left" | "right"; d: string };

// Visible faces of an axis-aligned box in this projection: top, +y face (left), +x face (right).
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Face[] {
  const poly = (...p: [number, number, number][]) => `M${p.map((q) => pt(...q)).join("L")}Z`;
  return [
    { tone: "top", d: poly([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]) },
    { tone: "left", d: poly([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]) },
    { tone: "right", d: poly([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]) },
  ];
}

function Solid({ faces, className }: { faces: Face[]; className: string }) {
  return (
    <g className={className}>
      {faces.map((f) => (
        <path key={f.tone} className={`iso-${f.tone}`} d={f.d} />
      ))}
    </g>
  );
}

const PLATFORM_H = 0.4;
const SWATCH_TOP = PLATFORM_H + 0.12;
const GANTRY_H = 3.2;
// Weave hairlines across the swatch top: [x1, y1, x2, y2] in floor units.
const WEAVE: [number, number, number, number][] = [
  [0.8, 1.6, 3.2, 1.6],
  [0.8, 2.4, 3.2, 2.4],
  [1.6, 0.8, 1.6, 3.2],
  [2.4, 0.8, 2.4, 3.2],
];

export default function ScanStage() {
  return (
    <svg
      className="scan-stage"
      viewBox="0 0 240 180"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse className="scan-stage-ground" cx={120} cy={134} rx={100} ry={26} />
      <Solid className="scan-stage-leg-back" faces={box(0.3, 0.5, 1.8, 2.2, 0, GANTRY_H)} />
      <Solid className="scan-stage-plinth" faces={box(0, 4, 0, 4, 0, PLATFORM_H)} />
      <Solid className="scan-stage-swatch" faces={box(0.8, 3.2, 0.8, 3.2, PLATFORM_H, SWATCH_TOP)} />
      <g className="scan-stage-weave" aria-hidden="true">
        {WEAVE.map(([a, b, c, d], i) => {
          const [x1, y1] = xy(a, b, SWATCH_TOP);
          const [x2, y2] = xy(c, d, SWATCH_TOP);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
      </g>
      <g className="scan-stage-sweep">
        <line
          className="scan-stage-line"
          x1={xy(0.8, 0.8, SWATCH_TOP + 0.02)[0]}
          y1={xy(0.8, 0.8, SWATCH_TOP + 0.02)[1]}
          x2={xy(3.2, 0.8, SWATCH_TOP + 0.02)[0]}
          y2={xy(3.2, 0.8, SWATCH_TOP + 0.02)[1]}
        />
      </g>
      <Solid className="scan-stage-beam" faces={box(0.3, 3.7, 1.8, 2.2, GANTRY_H, GANTRY_H + 0.2)} />
      <Solid className="scan-stage-head" faces={box(1.7, 2.3, 1.7, 2.3, GANTRY_H - 0.6, GANTRY_H)} />
      <Solid className="scan-stage-leg-front" faces={box(3.5, 3.7, 1.8, 2.2, 0, GANTRY_H)} />
    </svg>
  );
}
