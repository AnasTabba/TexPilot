export type Kind =
  | "production"
  | "receipt"
  | "dispatch"
  | "issue"
  | "waste"
  | "cops"
  | "reversal";
export type Stage = "raw" | "finished" | "wip" | "cops";
export interface Movement {
  lot: string;
  stage: Stage;
  grams: number;
  cartons: number;
  cones: number;
}
export interface Entry {
  id: string;
  serial: string;
  kind: Kind;
  date: string;
  time: string;
  machine: string;
  shift: string;
  lot: string;
  grams: number;
  cartons: number;
  cones: number;
  by: string;
  notes: string;
  movements: Movement[];
  reverses?: string;
  createdAt: number;
  opening?: boolean;
}
export interface Lot {
  id: string;
  spec: string;
  material: string;
  supplier: string;
  received: string;
  status: "active" | "hold";
  color: string;
}
export interface Order {
  id: string;
  customer: string;
  fabric: string;
  spec: string;
  grams: number;
  delivered: number;
  due: string;
  status: "in-progress" | "ready" | "completed";
}
export const lots: Lot[] = [
  {
    id: "1221",
    spec: "30/1 CVC 60/40",
    material: "CVC blend",
    supplier: "Crescent Textiles",
    received: "2026-10-17",
    status: "active",
    color: "#8270d4",
  },
  {
    id: "1219",
    spec: "20/1 Cotton Combed",
    material: "Cotton",
    supplier: "Nishat Mills",
    received: "2026-10-12",
    status: "active",
    color: "#68a99f",
  },
  {
    id: "1224",
    spec: "50D/24F 1244 TPM Z",
    material: "Filament",
    supplier: "Ibrahim Fibres",
    received: "2026-10-20",
    status: "active",
    color: "#b298d1",
  },
  {
    id: "1216",
    spec: "26/1 PC 65/35",
    material: "Poly cotton",
    supplier: "Crescent Textiles",
    received: "2026-10-08",
    status: "hold",
    color: "#c9b18a",
  },
];
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function kgToGrams(value: string): number {
  if (!/^\d+(\.\d{1,3})?$/.test(value.trim())) throw new Error("weight");
  const [whole, fraction = ""] = value.trim().split(".");
  const grams = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  if (!Number.isSafeInteger(grams) || grams <= 0) throw new Error("weight");
  return grams;
}
export function balance(entries: Entry[], lot: string, stage: Stage) {
  return entries
    .flatMap((e) => e.movements)
    .filter((m) => m.lot === lot && m.stage === stage)
    .reduce(
      (a, m) => ({
        grams: a.grams + m.grams,
        cartons: a.cartons + m.cartons,
        cones: a.cones + m.cones,
      }),
      { grams: 0, cartons: 0, cones: 0 },
    );
}
export function total(entries: Entry[], stage: Stage) {
  return lots.reduce(
    (a, l) => {
      const b = balance(entries, l.id, stage);
      return {
        grams: a.grams + b.grams,
        cartons: a.cartons + b.cartons,
        cones: a.cones + b.cones,
      };
    },
    { grams: 0, cartons: 0, cones: 0 },
  );
}
export function appendEntry(entries: Entry[], entry: Entry): Entry[] {
  if (entries.some((e) => e.id === entry.id)) return entries;
  for (const stage of ["raw", "finished", "wip", "cops"] as Stage[])
    for (const lot of lots) {
      const b = balance([...entries, entry], lot.id, stage);
      if (b.grams < 0 || b.cartons < 0 || b.cones < 0) throw new Error("stock");
    }
  return [...entries, entry];
}
export function createEntry(
  input: {
    kind: Kind;
    lot: string;
    grams: number;
    cartons: number;
    cones: number;
    machine: string;
    notes: string;
    shift: string;
    date: string;
  },
  id: string = crypto.randomUUID(),
): Entry {
  const lot = lots.find((l) => l.id === input.lot);
  if (!lot) throw new Error("lot");
  if (input.kind === "dispatch" && lot.status === "hold")
    throw new Error("hold");
  if (input.date > today()) throw new Error("future");
  if (
    ![input.grams, input.cartons, input.cones].every(Number.isSafeInteger) ||
    input.grams <= 0 ||
    input.cartons < 0 ||
    input.cones < 0
  )
    throw new Error("quantity");
  const stage: Stage =
    input.kind === "receipt" || input.kind === "issue"
      ? "raw"
      : input.kind === "waste"
        ? "wip"
        : input.kind === "cops"
          ? "cops"
          : "finished";
  const sign = ["dispatch", "issue", "waste"].includes(input.kind) ? -1 : 1;
  const movement: Movement = {
    lot: input.lot,
    stage,
    grams: sign * input.grams,
    cartons: sign * input.cartons,
    cones: sign * input.cones,
  };
  const movements = [movement];
  if (input.kind === "issue")
    movements.push({
      ...movement,
      stage: "wip",
      grams: input.grams,
      cartons: input.cartons,
      cones: input.cones,
    });
  return {
    ...input,
    id,
    serial: `${{ production: "PRD", receipt: "GRN", dispatch: "DN", issue: "ISS", waste: "WST", cops: "COP", reversal: "REV" }[input.kind]}-26-${id.slice(0, 6).toUpperCase()}`,
    time: new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Karachi",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date()),
    by: "Ahmed Khan",
    createdAt: Date.now(),
    movements,
  };
}
export function reverseEntry(
  entries: Entry[],
  entry: Entry,
  reason: string,
): Entry[] {
  if (entries.some((e) => e.reverses === entry.id)) throw new Error("reversed");
  if (!reason.trim()) throw new Error("reason");
  return appendEntry(entries, {
    ...entry,
    id: crypto.randomUUID(),
    kind: "reversal",
    serial: `REV-${entry.serial}`,
    createdAt: Date.now(),
    notes: reason,
    reverses: entry.id,
    movements: entry.movements.map((m) => ({
      ...m,
      grams: -m.grams,
      cartons: -m.cartons,
      cones: -m.cones,
    })),
  });
}
export function seedEntries(): Entry[] {
  const day = today();
  const entries: Entry[] = [];
  const add = (
    kind: Kind,
    lot: string,
    grams: number,
    cartons: number,
    machine: string,
    time: string,
    opening = false,
    stage?: Stage,
  ) => {
    const id = `seed-${entries.length}`;
    entries.push({
      id,
      kind,
      lot,
      grams,
      cartons,
      cones: cartons * 24,
      machine,
      time,
      shift: "A",
      date: day,
      by: ["Asif Ali", "Muhammad Bilal", "Ahmed Khan"][entries.length % 3],
      notes: "",
      serial: `${kind === "production" ? "PRD" : kind === "receipt" ? "GRN" : "DN"}-26-${String(entries.length + 41).padStart(6, "0")}`,
      createdAt: 0,
      opening,
      movements: [
        {
          lot,
          stage: stage || (kind === "receipt" ? "raw" : "finished"),
          grams: kind === "dispatch" ? -grams : grams,
          cartons: kind === "dispatch" ? -cartons : cartons,
          cones: (kind === "dispatch" ? -1 : 1) * cartons * 24,
        },
      ],
    });
  };
  [4200000, 3000000, 2200000, 1473500].forEach((g, i) =>
    add(
      "production",
      lots[i].id,
      g,
      [196, 140, 100, 68][i],
      "—",
      "00:00",
      true,
    ),
  );
  [7640000, 5200000, 3600000, 2200000].forEach((g, i) =>
    add("receipt", lots[i].id, g, [356, 242, 168, 102][i], "—", "00:00", true),
  );
  add("production", "1221", 498400, 23, "1A", "08:20");
  add("production", "1219", 462800, 22, "1B", "09:05");
  add("production", "1224", 520600, 24, "2A", "10:15");
  add("production", "1221", 485200, 23, "2B", "11:40");
  add("production", "1219", 421100, 20, "3A", "12:10");
  add("production", "1224", 458400, 21, "3B", "13:25");
  add("dispatch", "1221", 740000, 34, "Lahore Knitwear", "13:40");
  add("dispatch", "1219", 500000, 24, "Style Textile", "14:05");
  return entries;
}
export const seedOrders: Order[] = [
  {
    id: "ORD-26-00128",
    customer: "Lahore Knitwear",
    fabric: "Single Jersey · 160 GSM",
    spec: "30/1 CVC 60/40",
    grams: 3000000,
    delivered: 740000,
    due: "2026-10-26",
    status: "in-progress",
  },
  {
    id: "ORD-26-00127",
    customer: "Style Textile",
    fabric: "Fleece · 280 GSM",
    spec: "20/1 Cotton Combed",
    grams: 2500000,
    delivered: 500000,
    due: "2026-10-27",
    status: "in-progress",
  },
  {
    id: "ORD-26-00126",
    customer: "Sapphire Finishing",
    fabric: "Polo PK · 200 GSM",
    spec: "26/1 PC 65/35",
    grams: 1800000,
    delivered: 0,
    due: "2026-10-28",
    status: "ready",
  },
  {
    id: "ORD-26-00125",
    customer: "Masood Textile",
    fabric: "Thermal · 220 GSM",
    spec: "50D/24F 1244 TPM Z",
    grams: 1200000,
    delivered: 1200000,
    due: "2026-10-24",
    status: "completed",
  },
];
export const fmt = (n: number, max = 1) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: max }).format(n);
export function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv =
    "\uFEFF" +
    rows
      .map((row) =>
        row.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(","),
      )
      .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
