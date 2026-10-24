import {
  useState,
  useEffect,
  useRef,
  createContext,
  useContext,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  ScanLine,
  LayoutDashboard,
  Factory,
  Boxes,
  ShoppingBag,
  Truck,
  BookOpen,
  BarChart3,
  Settings2,
  CircleHelp,
  Search,
  Bell,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Download,
  CalendarDays,
  ArrowRight,
  Check,
  CheckCheck,
  Clock3,
  AlertTriangle,
  X,
  MoreHorizontal,
  ArrowLeft,
  RefreshCw,
  Globe2,
  LogOut,
  Menu,
  WifiOff,
  ShieldCheck,
  LockKeyhole,
  Delete,
  Sparkles,
  PackagePlus,
  Layers3,
  FileText,
  SlidersHorizontal,
  Sun,
  Moon,
  Monitor,
  Users,
  Database,
  Upload,
  CircleCheck,
  Scale,
  Minus,
  Eye,
  Printer,
  type LucideIcon,
} from "lucide-react";
import {
  lots,
  seedEntries,
  seedOrders,
  balance,
  total,
  createEntry,
  appendEntry,
  reverseEntry,
  fmt,
  today,
  kgToGrams,
  downloadCsv,
  type Entry,
  type Order,
  type Kind,
  type Stage,
} from "./domain";
import Scanner from "./Scanner";
const Language = createContext(false);
const LedgerContext = createContext<Entry[]>([]);
function useT() {
  const ur = useContext(Language);
  return (en: string, urdu?: string) => (ur ? urdu || en : en);
}
function useStored<T>(
  key: string,
  initial: T,
): [T, (next: T | ((value: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : initial;
    } catch {
      return initial;
    }
  });
  return [
    value,
    (next) =>
      setValue((previous) => {
        const updated =
          typeof next === "function" ? (next as (v: T) => T)(previous) : next;
        localStorage.setItem(key, JSON.stringify(updated));
        return updated;
      }),
  ];
}
function Icon({ icon: I, size = 20 }: { icon: LucideIcon; size?: number }) {
  return <I size={size} strokeWidth={1.7} aria-hidden="true" />;
}
function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <img src="/icon.svg" alt="" />
      <span>
        yarnflow<span className="brand-dot">.</span>
      </span>
      {!compact && <span className="brand-sub">FACTORY WORKSPACE</span>}
    </div>
  );
}
function Button({
  children,
  onClick,
  icon,
  variant = "",
  disabled = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  icon?: LucideIcon;
  variant?: string;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      className={`button ${variant}`}
      onClick={onClick}
      disabled={disabled}
      type={type}
    >
      {icon && <Icon icon={icon} size={18} />}
      <span>{children}</span>
    </button>
  );
}
function Status({
  tone = "green",
  children,
}: {
  tone?: string;
  children: ReactNode;
}) {
  return (
    <span className={`status ${tone}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}
function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Search size={28} />
      </span>
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
      {action}
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const element = panel.current;
    const focusables = () =>
      Array.from(
        element?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input,select,textarea,[tabindex="0"]',
        ) || [],
      );
    focusables()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const els = focusables();
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  const t = useT();
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal glass ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label={t("Close", "بند کریں")}
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function YarnArt({ large = false }: { large?: boolean }) {
  return (
    <svg
      className={`yarn-art ${large ? "large" : ""}`}
      viewBox="0 0 500 400"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="spool"
          x1="140"
          y1="70"
          x2="360"
          y2="350"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#e4d9ff" />
          <stop offset=".45" stopColor="#b1a0e9" />
          <stop offset="1" stopColor="#7156bb" />
        </linearGradient>
        <linearGradient id="glass" x1="100" y1="0" x2="400" y2="350">
          <stop stopColor="white" stopOpacity=".7" />
          <stop offset="1" stopColor="white" stopOpacity=".06" />
        </linearGradient>
        <filter id="shadow">
          <feGaussianBlur stdDeviation="15" />
        </filter>
      </defs>
      <ellipse
        cx="262"
        cy="345"
        rx="140"
        ry="19"
        fill="#493274"
        opacity=".2"
        filter="url(#shadow)"
      />
      <path
        d="M80 300C-35 220 180 60 371 102S487 293 326 315 123 250 211 223"
        stroke="white"
        strokeOpacity=".45"
        strokeWidth="2"
      />
      <g transform="rotate(-18 260 200)">
        <path d="M177 70h154l45 248c0 35-243 35-243 0z" fill="url(#spool)" />
        <ellipse cx="254" cy="70" rx="77" ry="25" fill="#e4d9ff" />
        <ellipse cx="254" cy="70" rx="30" ry="12" fill="#8d76c5" />
        <ellipse cx="254" cy="68" rx="18" ry="7" fill="#6a51a4" />
        {Array.from({ length: 27 }, (_, i) => (
          <path
            key={i}
            d={`M${175 - i * 1.5} ${88 + i * 8.5} Q254 ${122 + i * 8.5} ${333 + i * 1.5} ${88 + i * 8.5}`}
            stroke={i % 3 === 0 ? "#f3ebff" : "#9980d4"}
            strokeOpacity={i % 3 === 0 ? ".65" : ".4"}
            strokeWidth="2"
          />
        ))}
        <path
          d="M178 78c-5 10-29 204-34 237 25 18 47 22 65 23l17-241z"
          fill="url(#glass)"
        />
      </g>
      <path
        d="M330 320c70-6 94 55 12 48s-90-25-119-10"
        stroke="#c3afe9"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="100" cy="180" r="8" fill="#e4d9ff" />
      <circle cx="413" cy="243" r="5" fill="white" fillOpacity=".65" />
      <path
        d="m385 73 4 11 11 4-11 4-4 11-4-11-11-4 11-4z"
        fill="white"
        fillOpacity=".8"
      />
    </svg>
  );
}
const navItems: [string, string, string, LucideIcon][] = [
  ["overview", "Overview", "جائزہ", LayoutDashboard],
  ["scanner", "Material scanner", "کپڑے کا اسکینر", ScanLine],
  ["production", "Production", "پیداوار", Factory],
  ["inventory", "Inventory", "اسٹاک", Boxes],
  ["orders", "Orders", "آرڈرز", ShoppingBag],
  ["dispatch", "Dispatch", "ترسیل", Truck],
  ["register", "Register view", "رجسٹر", BookOpen],
  ["reports", "Reports", "رپورٹس", BarChart3],
];
const kindNames: Record<Kind, [string, string]> = {
  production: ["Production", "پیداوار"],
  receipt: ["Yarn receipt", "یارن کی وصولی"],
  dispatch: ["Dispatch", "ترسیل"],
  issue: ["Machine issue", "مشین کو اجرا"],
  waste: ["Waste", "ضائع شدہ"],
  cops: ["Cops produced", "کاپس کی پیداوار"],
  reversal: ["Reversal", "واپسی اندراج"],
};
function EntryTable({
  entries,
  onDetail,
  compact = false,
}: {
  entries: Entry[];
  onDetail: (e: Entry) => void;
  compact?: boolean;
}) {
  const t = useT();
  const ledger = useContext(LedgerContext);
  const isReversed = (e: Entry) =>
    e.kind === "reversal" || ledger.some((r) => r.reverses === e.id);
  return entries.length ? (
    <div
      className="table-scroll"
      tabIndex={0}
      role="region"
      aria-label={t("Scrollable table", "اسکرول جدول")}
    >
      <table>
        <thead>
          <tr>
            <th>{t("Entry / material", "اندراج / یارن")}</th>
            <th>{t("Machine / customer", "مشین / کسٹمر")}</th>
            <th>{t("Quantity", "مقدار")}</th>
            {!compact && <th>{t("Recorded by", "درج کرنے والا")}</th>}
            <th>{t("Status", "حالت")}</th>
            <th>
              <span className="sr-only">{t("Details", "تفصیل")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>
                <button className="table-link" onClick={() => onDetail(e)}>
                  <span
                    className={`row-icon ${e.kind === "dispatch" ? "mint" : "lavender"}`}
                  >
                    <Icon
                      icon={
                        e.kind === "dispatch"
                          ? Truck
                          : e.kind === "receipt"
                            ? PackagePlus
                            : e.kind === "reversal"
                              ? RefreshCw
                              : Factory
                      }
                      size={18}
                    />
                  </span>
                  <span>
                    <strong>{lots.find((l) => l.id === e.lot)?.spec}</strong>
                    <small>
                      <bdi>{e.serial}</bdi> · {t("Lot", "لاٹ")}{" "}
                      <bdi>{e.lot}</bdi>
                    </small>
                  </span>
                </button>
              </td>
              <td>
                <span className="cell-main">
                  <bdi>{e.machine}</bdi>
                </span>
                <small>
                  {t("Shift", "شفٹ")} <bdi>{e.shift}</bdi> · <bdi>{e.time}</bdi>
                </small>
              </td>
              <td>
                <strong className="number">
                  <bdi>{fmt(e.grams / 1000, 3)} kg</bdi>
                </strong>
                <small>
                  <bdi>{e.cartons}</bdi> {t("cartons", "کارٹن")}
                </small>
              </td>
              {!compact && (
                <td>
                  <span className="person">
                    <span className="mini-avatar">
                      {e.by
                        .split(" ")
                        .map((s) => s[0])
                        .join("")}
                    </span>
                    {e.by}
                  </span>
                </td>
              )}
              <td>
                <Status tone={isReversed(e) ? "gray" : "green"}>
                  {t(
                    isReversed(e) ? "Reversed" : "Saved locally",
                    isReversed(e) ? "واپس کیا گیا" : "ڈیوائس پر محفوظ",
                  )}
                </Status>
              </td>
              <td>
                <button
                  className="icon-button"
                  aria-label={t("View entry", "اندراج دیکھیں")}
                  onClick={() => onDetail(e)}
                >
                  <ChevronRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title={t("No entries yet", "ابھی کوئی اندراج نہیں")}
      detail={t(
        "Your saved entries will appear here.",
        "محفوظ اندراجات یہاں نظر آئیں گے۔",
      )}
    />
  );
}
function ProductionChart({
  period,
  onTable,
  entries,
}: {
  period: string;
  onTable: () => void;
  entries: Entry[];
}) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const weekly = period !== "Today";
  const labels = weekly
    ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    : ["06:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00"];
  const produced = entries.reduce((sum, e) => sum + e.grams / 1000, 0);
  const values = weekly
    ? [2180, 2510, 2250, 3180, 2820, 3100, produced]
    : labels.map((time) =>
        entries
          .filter((e) => e.time <= time)
          .reduce((sum, e) => sum + e.grams / 1000, 0),
      );
  const max = Math.max(4000, Math.ceil(Math.max(...values) / 1000) * 1000);
  const points = values.map((value, i) => ({
    x: i * 120,
    y: 195 - (value / max) * 180,
  }));
  const path = points.reduce(
    (path, p, i) =>
      i === 0
        ? `M${p.x} ${p.y}`
        : path +
          ` C${points[i - 1].x + 60} ${points[i - 1].y} ${p.x - 60} ${p.y} ${p.x} ${p.y}`,
    "",
  );
  return (
    <div className="chart-wrap" dir="ltr">
      <div className="chart-y">
        {[max, max * 0.75, max * 0.5, max * 0.25, 0].map((value) => (
          <span key={value}>{fmt(value, 0)}</span>
        ))}
      </div>
      <div className="chart-main">
        <svg
          viewBox="0 0 720 215"
          preserveAspectRatio="none"
          role="img"
          aria-label={t(
            "Production trend in kilograms",
            "کلوگرام میں پیداوار کا رجحان",
          )}
        >
          <defs>
            <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="#a38bdd" stopOpacity=".28" />
              <stop offset="1" stopColor="#a38bdd" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[15, 60, 105, 150, 195].map((y) => (
            <line
              key={y}
              x1="0"
              x2="720"
              y1={y}
              y2={y}
              stroke="#e8e7f0"
              strokeDasharray="4 5"
            />
          ))}
          <line
            x1="0"
            x2="720"
            y1={195 - (3000 / max) * 180}
            y2={195 - (3000 / max) * 180}
            stroke="#beb5d3"
            strokeWidth="2"
            strokeDasharray="6 6"
          />
          <path d={path + " L720 215 L0 215Z"} fill="url(#chartFill)" />
          <path d={path} stroke="#8c72cc" strokeWidth="3" fill="none" />
          {points.map((point, i) => (
            <rect
              key={i}
              x={Math.max(0, point.x - 50)}
              y="0"
              width="100"
              height="215"
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        {hover !== null && (
          <div
            className="chart-tooltip"
            style={{ insetInlineStart: `${Math.min(hover * 14, 75)}%` }}
          >
            {labels[hover]} · {fmt(values[hover])} kg
          </div>
        )}
        <div className="chart-x">
          {labels.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      </div>
      <button className="sr-only focus-show" onClick={onTable}>
        {t("View chart data as a table", "چارٹ کا ڈیٹا جدول میں دیکھیں")}
      </button>
    </div>
  );
}
function EntryForm({
  kind: initialKind,
  entries,
  onSave,
  onClose,
  closed,
  user,
}: {
  kind: Kind;
  entries: Entry[];
  onSave: (entry: Entry) => void;
  onClose: () => void;
  closed: boolean;
  user: string;
}) {
  const t = useT();
  type Draft = {
    kind: Kind;
    machine: string;
    lot: string;
    cartons: string;
    cones: string;
    weight: string;
    notes: string;
    date: string;
    shift: string;
    id: string;
  };
  const [draft, setDraft] = useStored<Draft>(
    `yf-draft-v1-${user}-${initialKind}`,
    {
      kind: initialKind,
      machine: "1A",
      lot: "1221",
      cartons: "12",
      cones: "288",
      weight: "258.660",
      notes: "",
      date: today(),
      shift: "A",
      id: crypto.randomUUID(),
    },
  );
  const [review, setReview] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(
    () => !!localStorage.getItem(`yf-draft-v1-${user}-${initialKind}`),
  );
  const allowedMachines =
    initialKind === "dispatch"
      ? ["Lahore Knitwear", "Style Textile", "Sapphire Finishing"]
      : initialKind === "receipt"
        ? ["Crescent Textiles", "Nishat Mills", "Ibrahim Fibres"]
        : ["1A", "1B", "2A", "2B", "3A", "3B"];
  const d = {
    ...draft,
    kind: initialKind,
    machine: allowedMachines.includes(draft.machine)
      ? draft.machine
      : allowedMachines[0],
  };
  const set = (key: keyof Draft, value: string) => {
    setDraft({ ...d, [key]: value });
    setError("");
  };
  const available = balance(
    entries,
    d.lot,
    ["dispatch", "production"].includes(d.kind) ? "finished" : "raw",
  );
  const selectedLot = lots.find((l) => l.id === d.lot)!;
  function validate() {
    if (closed && d.date === today()) throw new Error("closed");
    return appendEntry(
      entries,
      createEntry(
        {
          kind: d.kind,
          lot: d.lot,
          grams: kgToGrams(d.weight),
          cartons: Number(d.cartons),
          cones: Number(d.cones),
          machine:
            d.kind === "dispatch"
              ? d.machine.includes(" ")
                ? d.machine
                : "Lahore Knitwear"
              : d.machine,
          notes: d.notes,
          shift: d.shift,
          date: d.date,
        },
        d.id,
      ),
    ).at(-1)!;
  }
  const errors: Record<string, string> = {
    weight: t(
      "Enter a positive weight with up to 3 decimal places, for example 258.660.",
      "مثبت وزن درج کریں، اعشاریہ کے بعد زیادہ سے زیادہ ۳ ہندسے۔",
    ),
    stock: t(
      `Only ${fmt(available.grams / 1000)} kg and ${available.cartons} cartons are available in this lot. Reduce the quantity.`,
      `اس لاٹ میں صرف ${fmt(available.grams / 1000)} کلو اور ${available.cartons} کارٹن دستیاب ہیں۔ مقدار کم کریں۔`,
    ),
    hold: t(
      "This lot is on QC hold. Select a released lot before dispatch.",
      "اس لاٹ کی کوالٹی جانچ باقی ہے۔ دوسری لاٹ منتخب کریں۔",
    ),
    future: t(
      "Choose today or an earlier business date.",
      "آج یا پہلے کی تاریخ منتخب کریں۔",
    ),
    quantity: t(
      "Use whole, positive quantities for cartons and cones.",
      "کارٹن اور کونز کی درست مثبت تعداد درج کریں۔",
    ),
    closed: t(
      "This day is closed. Ask the manager to reopen it before recording an entry.",
      "یہ دن بند ہے۔ اندراج سے پہلے مینیجر سے دن کھلوائیں۔",
    ),
  };
  function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const entry = validate();
      if (!review) {
        setReview(true);
        return;
      }
      setBusy(true);
      onSave(entry);
      localStorage.removeItem(`yf-draft-v1-${user}-${initialKind}`);
    } catch (e) {
      setError(
        errors[e instanceof Error ? e.message : ""] ||
          t(
            "Could not save. Check the fields and try again.",
            "محفوظ نہیں ہوا۔ معلومات چیک کر کے دوبارہ کوشش کریں۔",
          ),
      );
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="entry-form">
      {restored && !review && (
        <div className="info-banner">
          <FileText size={18} />
          {t(
            "Your unfinished entry is saved on this device.",
            "آپ کا نامکمل اندراج اس ڈیوائس پر محفوظ ہے۔",
          )}
          <button
            type="button"
            className="text-button"
            onClick={() => setRestored(false)}
          >
            {t("Continue", "جاری رکھیں")}
          </button>
        </div>
      )}
      <div className="step-indicator">
        <span className={!review ? "current" : "done"}>
          {review ? <Check size={14} /> : "1"}
        </span>
        <b>{t("Entry details", "اندراج کی تفصیل")}</b>
        <div />
        <span className={review ? "current" : ""}>2</span>
        <b>{t("Review & save", "جائزہ اور محفوظ")}</b>
      </div>
      {review ? (
        <>
          <div className="review-card">
            <span className="feature-icon">
              <Icon icon={Factory} size={28} />
            </span>
            <h3>{t("Everything look right?", "کیا معلومات درست ہیں؟")}</h3>
            <p>
              {t("You are recording", "آپ درج کر رہے ہیں")}{" "}
              <strong>
                <bdi>{d.cartons}</bdi> {t("cartons", "کارٹن")} ·{" "}
                <bdi>{fmt(Number(d.weight), 3)} kg</bdi>
              </strong>{" "}
              {t("of", "کی")} <strong>{selectedLot.spec}</strong> ·{" "}
              {t("Lot", "لاٹ")} <bdi>{d.lot}</bdi>.
            </p>
            <dl>
              <div>
                <dt>{t("Entry type", "اندراج کی قسم")}</dt>
                <dd>{t(...kindNames[d.kind])}</dd>
              </div>
              <div>
                <dt>{t("Machine / customer", "مشین / کسٹمر")}</dt>
                <dd>
                  <bdi>{d.machine}</bdi>
                </dd>
              </div>
              <div>
                <dt>{t("Date / shift", "تاریخ / شفٹ")}</dt>
                <dd>
                  <bdi>{d.date}</bdi> · {d.shift}
                </dd>
              </div>
              <div>
                <dt>{t("Cones", "کونز")}</dt>
                <dd>
                  <bdi>{d.cones}</bdi>
                </dd>
              </div>
            </dl>
            <div className="info-banner">
              <ShieldCheck size={18} />
              {t(
                "Practice entry. Saved locally, never sent to a factory server.",
                "مشق کا اندراج۔ صرف اس ڈیوائس پر محفوظ ہوگا۔",
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="form-grid">
            <label>
              {t("Business date", "کاروباری تاریخ")}
              <input
                required
                type="date"
                max={today()}
                value={d.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </label>
            <label>
              {t("Shift", "شفٹ")}
              <select
                value={d.shift}
                onChange={(e) => set("shift", e.target.value)}
              >
                <option value="A">A · 07:00–15:00</option>
                <option value="B">B · 15:00–23:00</option>
                <option value="C">C · 23:00–07:00</option>
              </select>
            </label>
            <label>
              {t(
                d.kind === "dispatch"
                  ? "Customer"
                  : d.kind === "receipt"
                    ? "Supplier"
                    : "Machine",
                d.kind === "dispatch"
                  ? "کسٹمر"
                  : d.kind === "receipt"
                    ? "سپلائر"
                    : "مشین",
              )}
              <select
                value={d.machine}
                onChange={(e) => set("machine", e.target.value)}
              >
                {(d.kind === "dispatch"
                  ? ["Lahore Knitwear", "Style Textile", "Sapphire Finishing"]
                  : d.kind === "receipt"
                    ? ["Crescent Textiles", "Nishat Mills", "Ibrahim Fibres"]
                    : ["1A", "1B", "2A", "2B", "3A", "3B"]
                ).map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label>
              {t("Yarn & lot", "یارن اور لاٹ")}
              <select
                value={d.lot}
                onChange={(e) => set("lot", e.target.value)}
              >
                {lots.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.id} · {l.spec}
                    {l.status === "hold" ? " · QC HOLD" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="lot-context">
            <span className="row-icon lavender">
              <Boxes size={20} />
            </span>
            <div>
              <strong>{selectedLot.spec}</strong>
              <small>
                {t("Available", "دستیاب")}:{" "}
                <bdi>{fmt(available.grams / 1000, 3)} kg</bdi> ·{" "}
                <bdi>{available.cartons}</bdi> {t("cartons", "کارٹن")}
              </small>
            </div>
            <Status tone={selectedLot.status === "hold" ? "amber" : "green"}>
              {selectedLot.status === "hold"
                ? t("QC hold", "جانچ باقی")
                : t("Active lot", "فعال لاٹ")}
            </Status>
          </div>
          <div className="form-grid three">
            <label>
              {t("Cartons", "کارٹن")}
              <div className="stepper">
                <button
                  type="button"
                  aria-label={t("Fewer cartons", "کارٹن کم کریں")}
                  onClick={() =>
                    set("cartons", String(Math.max(0, Number(d.cartons) - 1)))
                  }
                >
                  <Minus size={16} />
                </button>
                <input
                  aria-label={t("Cartons", "کارٹن")}
                  required
                  type="number"
                  min="0"
                  step="1"
                  value={d.cartons}
                  onChange={(e) => {
                    setDraft({
                      ...d,
                      cartons: e.target.value,
                      cones: String(Number(e.target.value) * 24),
                    });
                  }}
                />
                <button
                  type="button"
                  aria-label={t("More cartons", "کارٹن بڑھائیں")}
                  onClick={() => set("cartons", String(Number(d.cartons) + 1))}
                >
                  <Plus size={16} />
                </button>
              </div>
            </label>
            <label>
              {t("Cones", "کونز")}
              <input
                required
                type="number"
                min="1"
                step="1"
                value={d.cones}
                onChange={(e) => set("cones", e.target.value)}
              />
            </label>
            <label>
              {t("Net weight (kg)", "خالص وزن (کلو)")}
              <input
                required
                inputMode="decimal"
                value={d.weight}
                onChange={(e) => set("weight", e.target.value)}
              />
            </label>
          </div>
          <label>
            {t("Notes", "نوٹس")}{" "}
            <span className="optional">{t("(optional)", "(اختیاری)")}</span>
            <textarea
              maxLength={500}
              rows={2}
              placeholder={t(
                "Anything the next shift should know?",
                "اگلی شفٹ کے لیے کوئی ضروری بات؟",
              )}
              value={d.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </label>
          <small className="form-footnote">
            {t(
              "Draft saves automatically. Quantities update your practice stock.",
              "مسودہ خود محفوظ ہوتا ہے۔ مقدار مشق کے اسٹاک میں شامل ہوگی۔",
            )}
          </small>
        </>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <AlertTriangle size={20} />
          {error}
        </div>
      )}
      <div className="modal-actions">
        <Button onClick={review ? () => setReview(false) : onClose}>
          {review
            ? t("Back to edit", "واپس ترمیم کریں")
            : t("Save draft & close", "مسودہ رکھیں اور بند کریں")}
        </Button>
        <Button
          type="submit"
          variant="primary"
          icon={review ? Check : ArrowRight}
          disabled={busy}
        >
          {busy
            ? t("Saving…", "محفوظ ہو رہا ہے…")
            : review
              ? t("Confirm & save", "تصدیق اور محفوظ")
              : t("Review entry", "اندراج کا جائزہ")}
        </Button>
      </div>
    </form>
  );
}
function Login({
  onEnter,
  onLanguage,
  ur,
}: {
  onEnter: (name: string) => void;
  onLanguage: () => void;
  ur: boolean;
}) {
  const t = useT();
  const [pin, setPin] = useState("");
  const [profile, setProfile] = useState("Ahmed Khan");
  const [error, setError] = useState(false);
  function enter(e?: FormEvent) {
    e?.preventDefault();
    if (pin === "1234") onEnter(profile);
    else {
      setError(true);
      setPin("");
    }
  }
  return (
    <div className="login-page">
      <section className="login-story">
        <Logo />
        <div className="login-story-text">
          <span className="eyebrow">
            {t(
              "A LITTLE CLARITY. A LOT OF POSSIBILITIES.",
              "ہر قدم پر وضاحت، ہر دن نئی کامیابی۔",
            )}
          </span>
          <h1>
            {t("Good things", "بہتر کام")}
            <br />
            {t("come together.", "ایک ساتھ۔")}
          </h1>
          <p>
            {t(
              "From the first cone to the final delivery. Keep your people, production, and possibilities in flow.",
              "پہلے کون سے آخری ترسیل تک۔ آپ کی ٹیم، پیداوار اور اسٹاک ایک جگہ۔",
            )}
          </p>
        </div>
        <YarnArt large />
        <div className="login-story-bottom">
          <span>
            <ShieldCheck size={18} />
            {t("Built for your factory floor", "آپ کی فیکٹری کے لیے بنایا گیا")}
          </span>
          <span>01 — 03</span>
        </div>
      </section>
      <section className="login-side">
        <button className="language-button" onClick={onLanguage}>
          <Globe2 size={17} />
          {ur ? "English" : "اردو"}
          <ChevronDown size={14} />
        </button>
        <form className="login-card glass" onSubmit={enter}>
          <span className="welcome-icon">
            <Sparkles size={27} />
          </span>
          <span className="eyebrow">
            {t("YOUR WORKSPACE IS READY", "آپ کا ورک اسپیس تیار ہے")}
          </span>
          <h2>{t("Welcome back.", "خوش آمدید۔")}</h2>
          <p>
            {t(
              "Pick your profile and enter your PIN to get started.",
              "اپنا پروفائل منتخب کریں اور پن درج کریں۔",
            )}
          </p>
          <label>
            {t("Continue as", "اس نام سے جاری رکھیں")}
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
            >
              <option>Ahmed Khan</option>
              <option>Asif Ali</option>
              <option>Muhammad Bilal</option>
            </select>
          </label>
          <div className="profile-preview">
            <span className="avatar">
              {profile
                .split(" ")
                .map((s) => s[0])
                .join("")}
            </span>
            <div>
              <strong>{profile}</strong>
              <small>{t("Practice profile", "مشق کا پروفائل")}</small>
            </div>
            <Status tone="purple">{t("Demo", "ڈیمو")}</Status>
          </div>
          <label>
            {t("Your 4-digit PIN", "آپ کا ۴ ہندسوں کا پن")}
            <input
              className="pin-input"
              type="password"
              autoComplete="off"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ""));
                setError(false);
              }}
              aria-label={t("Your 4-digit PIN", "آپ کا پن")}
              required
              placeholder="• • • •"
            />
          </label>
          <div className="pin-pad">
            {[
              "1",
              "2",
              "3",
              "4",
              "5",
              "6",
              "7",
              "8",
              "9",
              "clear",
              "0",
              "delete",
            ].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={
                  n === "delete"
                    ? t("Delete digit", "ہندسہ مٹائیں")
                    : n === "clear"
                      ? t("Clear PIN", "پن صاف کریں")
                      : n
                }
                onClick={() => {
                  setPin(
                    n === "clear"
                      ? ""
                      : n === "delete"
                        ? pin.slice(0, -1)
                        : (pin + n).slice(0, 4),
                  );
                  setError(false);
                }}
              >
                {n === "delete" ? (
                  <Delete size={20} />
                ) : n === "clear" ? (
                  t("Clear", "صاف")
                ) : (
                  n
                )}
              </button>
            ))}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {t(
                "Use 1234 to enter this practice workspace.",
                "مشق کے لیے پن 1234 استعمال کریں۔",
              )}
            </div>
          )}
          <Button type="submit" variant="primary full" icon={ArrowRight}>
            {t("Enter workspace", "ورک اسپیس کھولیں")}
          </Button>
          <div className="demo-pin">
            <LockKeyhole size={14} />
            {t(
              "Practice workspace · Demo PIN: 1234",
              "مشق کا ورک اسپیس · ڈیمو پن: 1234",
            )}
          </div>
          <button
            type="button"
            className="text-button forgot"
            onClick={() => setError(true)}
          >
            {t("Forgot your PIN?", "پن بھول گئے؟")}{" "}
            <strong>{t("Ask your supervisor", "سپروائزر سے پوچھیں")}</strong>
          </button>
        </form>
        <p className="login-footer">
          {t(
            "Less paperwork. More peace of mind.",
            "کم کاغذی کام۔ زیادہ اطمینان۔",
          )}
          <br />
          <span>Yarnflow © 2026</span>
        </p>
      </section>
    </div>
  );
}
export default function App() {
  const [ur, setUr] = useStored("yf-language", false);
  return (
    <Language.Provider value={ur}>
      <Workspace ur={ur} setUr={setUr} />
    </Language.Provider>
  );
}
function Workspace({
  ur,
  setUr,
}: {
  ur: boolean;
  setUr: (v: boolean) => void;
}) {
  const t = useT();
  const [user, setUser] = useStored("yf-user", "Ahmed Khan");
  const initials = user
    .split(" ")
    .map((word) => word[0])
    .join("");
  const [route, setRoute] = useState(
    () => location.hash.replace("#/", "") || "overview",
  );
  const [mobileNav, setMobileNav] = useState(false);
  const [entries, setEntries] = useStored<Entry[]>(
    "yf-entries-v1",
    seedEntries(),
  );
  const [orders, setOrders] = useStored<Order[]>("yf-orders-v1", seedOrders);
  const [theme, setTheme] = useStored("yf-theme", "light");
  const [factoryName, setFactoryName] = useStored(
    "yf-factory",
    "Crescent Yarn Mills",
  );
  const [closed, setClosed] = useStored("yf-closed-v1", "");
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("This week");
  const [stage, setStage] = useState<Stage>("finished");
  const [filter, setFilter] = useState("all");
  const [registerTab, setRegisterTab] = useState("production");
  const [modal, setModal] = useState<{
    type: string;
    entry?: Entry;
    lot?: string;
    kind?: Kind;
    report?: string;
  } | null>(null);
  const [toast, setToast] = useState<{ text: string; entry?: Entry } | null>(
    null,
  );
  const [offline, setOffline] = useState(!navigator.onLine);
  const [orderTab, setOrderTab] = useState("all");
  const [checks, setChecks] = useState<boolean[]>([false, false, false]);
  const [remarks, setRemarks] = useState("");
  const [showChartTable, setShowChartTable] = useState(false);
  const [viewMatrix, setViewMatrix] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general");
  const [previewState, setPreviewState] = useState("ready");
  function navigate(page: string) {
    location.hash = "/" + page;
    setRoute(page);
    setMobileNav(false);
    setFilter("all");
    setPreviewState("ready");
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    const change = () =>
      setRoute(location.hash.replace("#/", "") || "overview");
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    document.documentElement.dir = ur ? "rtl" : "ltr";
    document.documentElement.lang = ur ? "ur" : "en";
    document.documentElement.dataset.theme = theme;
  }, [ur, theme]);
  useEffect(() => {
    const online = () => setOffline(!navigator.onLine);
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(id);
  }, [toast]);
  function notify(text: string, entry?: Entry) {
    setToast({ text, entry });
  }
  const visible = entries
    .filter((e) => !e.opening)
    .slice()
    .reverse();
  const active = visible.filter(
    (e) => e.kind !== "reversal" && !entries.some((r) => r.reverses === e.id),
  );
  const dayProduction = active.filter(
    (e) => e.kind === "production" && e.date === today(),
  );
  const produced = dayProduction.reduce((s, e) => s + e.grams, 0);
  const dispatched = active
    .filter((e) => e.kind === "dispatch")
    .reduce((s, e) => s + e.grams, 0);
  const finished = total(entries, "finished");
  const raw = total(entries, "raw");
  const pending = orders.reduce((s, o) => s + o.grams - o.delivered, 0);
  const savedLocal = entries.filter((e) => e.createdAt > 0).length;
  function save(entry: Entry) {
    try {
      const next = appendEntry(entries, { ...entry, by: user });
      setEntries(next);
      setModal(null);
      notify(
        t(
          "Entry saved. Your practice stock is up to date.",
          "اندراج محفوظ ہوگیا۔ مشق کا اسٹاک تازہ ہے۔",
        ),
        entry,
      );
    } catch {
      throw new Error("stock");
    }
  }
  function undo(entry: Entry, reason = "Undone by creator") {
    try {
      setEntries(reverseEntry(entries, entry, reason));
      setModal(null);
      notify(
        t(
          "Entry reversed. The original stays in your history.",
          "اندراج واپس ہوگیا۔ اصل اندراج تاریخ میں محفوظ ہے۔",
        ),
      );
    } catch {
      notify(
        t(
          "This entry cannot be reversed because its stock has already been used.",
          "اس اندراج کا اسٹاک استعمال ہو چکا ہے، اس لیے واپسی ممکن نہیں۔",
        ),
      );
    }
  }
  function exportEntries(list = visible) {
    downloadCsv("yarnflow-entries.csv", [
      [
        t("Serial", "سیریل"),
        t("Date", "تاریخ"),
        t("Type", "قسم"),
        t("Lot", "لاٹ"),
        t("Machine", "مشین"),
        t("Cartons", "کارٹن"),
        t("Cones", "کونز"),
        t("Weight kg", "وزن کلو"),
        t("Recorded by", "درج کرنے والا"),
      ],
      ...list.map((e) => [
        e.serial,
        e.date,
        t(...kindNames[e.kind]),
        e.lot,
        e.machine,
        e.cartons,
        e.cones,
        (e.grams / 1000).toFixed(3),
        e.by,
      ]),
    ]);
    notify(t("Your CSV export is ready.", "آپ کی CSV فائل تیار ہے۔"));
  }
  const dateLabel = new Intl.DateTimeFormat(ur ? "ur-PK" : "en-GB", {
    timeZone: "Asia/Karachi",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date());
  const titles: Record<string, [string, string, string, string]> = {
    scanner: [
      "Material scanner",
      "کپڑے کا اسکینر",
      "From a closer look to a clearer decision.",
      "قریب سے دیکھیں، بہتر فیصلہ کریں۔",
    ],
    overview: [
      "Overview",
      "جائزہ",
      "A clear view of your factory.",
      "آپ کی فیکٹری کا واضح جائزہ۔",
    ],
    production: [
      "Production",
      "پیداوار",
      "Every cone. Every shift. All together.",
      "ہر کون، ہر شفٹ، ایک جگہ۔",
    ],
    inventory: [
      "Inventory",
      "اسٹاک",
      "Know what you have. Plan what comes next.",
      "اسٹاک جانیں اور اگلا قدم طے کریں۔",
    ],
    orders: [
      "Customer orders",
      "کسٹمر آرڈرز",
      "Keep your promises in view.",
      "ہر آرڈر پر نظر رکھیں۔",
    ],
    dispatch: [
      "Dispatch",
      "ترسیل",
      "From your floor to their door.",
      "آپ کی فیکٹری سے کسٹمر تک۔",
    ],
    register: [
      "Register view",
      "رجسٹر",
      "Your familiar register, with a little less paperwork.",
      "آپ کا مانوس رجسٹر، کم کاغذی کام کے ساتھ۔",
    ],
    reports: [
      "Reports & insights",
      "رپورٹس",
      "Good decisions start with a clear picture.",
      "واضح معلومات سے بہتر فیصلے۔",
    ],
    sync: [
      "Sync center",
      "سنک سینٹر",
      "A little peace of mind for every entry.",
      "ہر اندراج کے محفوظ ہونے کا اطمینان۔",
    ],
    settings: [
      "Workspace settings",
      "ورک اسپیس کی ترتیبات",
      "Make Yarnflow work your way.",
      "یارن فلو کو اپنی ضرورت کے مطابق بنائیں۔",
    ],
    help: [
      "A little help, right here.",
      "مدد یہیں موجود ہے۔",
      "Simple answers for your everyday work.",
      "روزمرہ کام کے آسان جواب۔",
    ],
    search: [
      "Search your workspace",
      "ورک اسپیس میں تلاش",
      "Find an entry, a lot, or a customer.",
      "اندراج، لاٹ یا کسٹمر تلاش کریں۔",
    ],
    close: [
      "Day close",
      "دن بند کریں",
      "Finish the day with everything accounted for.",
      "دن کا اختتام مکمل حساب کے ساتھ۔",
    ],
    masters: [
      "Your master data",
      "بنیادی معلومات",
      "The building blocks of your factory.",
      "آپ کی فیکٹری کی بنیادی معلومات۔",
    ],
    users: [
      "People & devices",
      "افراد اور ڈیوائسز",
      "The people who keep things moving.",
      "آپ کے کام کو آگے بڑھانے والی ٹیم۔",
    ],
    import: [
      "Import your registers",
      "رجسٹر درآمد کریں",
      "Bring your existing records along.",
      "اپنے پرانے ریکارڈ ساتھ لائیں۔",
    ],
    home: [
      "Your daily workspace",
      "آپ کا روزمرہ ورک اسپیس",
      "What would you like to record?",
      "آپ کیا درج کرنا چاہتے ہیں؟",
    ],
    components: [
      "Component gallery",
      "کمپوننٹ گیلری",
      "The details that bring it all together.",
      "وہ تفصیلات جو سب کو جوڑتی ہیں۔",
    ],
  };
  const title = titles[route] || titles.overview;
  if (route === "login")
    return (
      <Login
        ur={ur}
        onLanguage={() => setUr(!ur)}
        onEnter={(name) => {
          setUser(name);
          navigate("overview");
        }}
      />
    );
  function headerAction() {
    if (route === "scanner")
      return (
        <Button icon={ShieldCheck} onClick={() => navigate("inventory")}>
          {t("Open inventory", "اسٹاک کھولیں")}
        </Button>
      );
    if (route === "overview")
      return (
        <>
          <Button icon={ScanLine} onClick={() => navigate("scanner")}>
            {t("Scan material", "کپڑا اسکین کریں")}
          </Button>
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => setModal({ type: "new" })}
          >
            {t("New entry", "نیا اندراج")}
          </Button>
        </>
      );
    if (route === "production")
      return (
        <Button
          variant="primary"
          icon={Plus}
          onClick={() => setModal({ type: "entry", kind: "production" })}
        >
          {t("Record production", "پیداوار درج کریں")}
        </Button>
      );
    if (route === "dispatch")
      return (
        <Button
          variant="primary"
          icon={Plus}
          onClick={() => setModal({ type: "entry", kind: "dispatch" })}
        >
          {t("New dispatch", "نئی ترسیل")}
        </Button>
      );
    if (route === "orders")
      return (
        <Button
          variant="primary"
          icon={Plus}
          onClick={() => setModal({ type: "order" })}
        >
          {t("New order", "نیا آرڈر")}
        </Button>
      );
    if (route === "inventory")
      return (
        <Button
          variant="primary"
          icon={PackagePlus}
          onClick={() => setModal({ type: "entry", kind: "receipt" })}
        >
          {t("Receive yarn", "یارن وصول کریں")}
        </Button>
      );
    if (
      route === "settings" ||
      route === "help" ||
      route === "users" ||
      route === "masters" ||
      route === "import" ||
      route === "components"
    )
      return null;
    return (
      <>
        <Button icon={CalendarDays} onClick={() => setModal({ type: "date" })}>
          {dateLabel}
          <ChevronDown size={14} />
        </Button>
        <Button
          variant="primary"
          icon={Plus}
          onClick={() => setModal({ type: "new" })}
        >
          {t("New entry", "نیا اندراج")}
        </Button>
      </>
    );
  }
  function overview() {
    const cards: [
      string,
      string,
      number,
      string,
      string,
      string,
      LucideIcon,
      string,
    ][] = [
      [
        "Production today",
        "آج کی پیداوار",
        produced / 1000,
        "kg",
        "12.8%",
        "vs. 7-day average",
        Factory,
        "production",
      ],
      [
        "Finished stock",
        "تیار اسٹاک",
        finished.grams / 1000,
        "kg",
        "8.2%",
        "vs. last week",
        Boxes,
        "inventory",
      ],
      [
        "Dispatched today",
        "آج کی ترسیل",
        dispatched / 1000,
        "kg",
        "6.4%",
        "vs. 7-day average",
        Truck,
        "dispatch",
      ],
      [
        "Pending orders",
        "باقی آرڈرز",
        pending / 1000,
        "kg",
        `${orders.filter((o) => o.status !== "completed").length} ${t("orders", "آرڈرز")}`,
        "awaiting fulfillment",
        ShoppingBag,
        "orders",
      ],
    ];
    return (
      <>
        <div className="welcome-row">
          <div>
            <span className="eyebrow">
              {t("SATURDAY, LET’S MAKE IT A GOOD ONE", "آج کا دن، بہتر بنائیں")}
            </span>
            <h2>
              {t(
                `Good afternoon, ${user.split(" ")[0]}`,
                `آداب، ${user === "Ahmed Khan" ? "احمد" : user === "Asif Ali" ? "آصف" : "بلال"}`,
              )}{" "}
              <span className="greeting-spark">✳</span>
            </h2>
            <p>
              {t(
                "Here’s how things are coming together today.",
                "آج آپ کی فیکٹری کا کام کچھ یوں چل رہا ہے۔",
              )}
            </p>
          </div>
          <div className="shift-pill">
            <span className="live-dot" />
            {t("Shift A in progress", "شفٹ A جاری ہے")}
            <span>07:00 – 15:00</span>
          </div>
        </div>
        <div className="attention-bar">
          <span className="attention-icon">
            <AlertTriangle size={19} />
          </span>
          <strong>
            {t(
              "A little attention goes a long way.",
              "تھوڑی توجہ، بہتر نتائج۔",
            )}
          </strong>
          <span>
            {t(
              "1 lot on QC hold · 2 orders due this week",
              "۱ لاٹ کی جانچ باقی · ۲ آرڈر اس ہفتے واجب",
            )}
          </span>
          <button
            onClick={() => {
              setStage("finished");
              setFilter("hold");
              navigate("inventory");
              setFilter("hold");
            }}
          >
            {t("Take a look", "تفصیل دیکھیں")}
            <ArrowRight size={16} />
          </button>
        </div>
        <div className="kpi-grid">
          {cards.map(
            ([en, urdu, value, unit, change, comparison, I, to], i) => (
              <button
                key={en}
                className="kpi-card glass"
                onClick={() => navigate(to)}
              >
                <div className="kpi-top">
                  <span>{t(en, urdu)}</span>
                  <span className={`kpi-icon kpi-${i}`}>
                    <Icon icon={I} size={19} />
                  </span>
                </div>
                <div className="kpi-value">
                  <bdi>{fmt(value)}</bdi>
                  <span>{unit}</span>
                </div>
                <div className="kpi-bottom">
                  <span
                    className={i === 3 ? "neutral-trend" : "positive-trend"}
                  >
                    {i < 3 && <ArrowUpRight size={14} />}
                    <bdi>{change}</bdi>
                  </span>
                  <span>
                    {t(
                      comparison,
                      i === 3
                        ? "تکمیل کے منتظر"
                        : i === 1
                          ? "گزشتہ ہفتے کے مقابلے"
                          : "۷ دن کی اوسط کے مقابلے",
                    )}
                  </span>
                  <svg
                    className={`sparkline spark-${i}`}
                    viewBox="0 0 80 24"
                    aria-hidden="true"
                  >
                    <path
                      d={
                        [
                          "M1 21 10 17 19 19 28 10 37 12 46 8 55 11 64 3 79 5",
                          "M1 20 11 19 20 12 30 14 40 8 50 12 60 5 70 8 79 2",
                          "M1 22 11 16 22 18 32 10 42 13 52 5 62 9 72 2 79 4",
                          "M1 9 12 9 22 15 32 12 42 17 52 10 62 14 72 7 79 9",
                        ][i]
                      }
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                  </svg>
                </div>
              </button>
            ),
          )}
        </div>
        <div className="chart-grid">
          <section className="panel glass production-panel">
            <div className="panel-heading">
              <div>
                <h3>
                  {t("Production at a glance", "پیداوار پر ایک نظر")}
                  <span className="muted unit">kg</span>
                </h3>
                <p>
                  {t(
                    "A steady flow, shift after shift.",
                    "ہر شفٹ میں پیداوار کا تسلسل۔",
                  )}
                </p>
              </div>
              <select
                className="compact-select"
                aria-label={t("Chart period", "چارٹ کی مدت")}
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              >
                <option value="This week">
                  {t("Last 7 days", "گزشتہ ۷ دن")}
                </option>
                <option value="Today">{t("Today", "آج")}</option>
              </select>
            </div>
            <div className="chart-summary">
              <strong>
                <bdi>
                  {fmt(produced / 1000 + (period === "Today" ? 0 : 16040))}
                </bdi>
                <span> kg</span>
              </strong>
              <span className="positive-trend">
                <ArrowUpRight size={14} />
                12.8%{" "}
                <span>{t("vs. previous period", "پچھلی مدت کے مقابلے")}</span>
              </span>
              <div className="chart-legend">
                <span>
                  <i />
                  {t("Production", "پیداوار")}
                </span>
                <span>
                  <i />
                  {t("Target", "ہدف")}
                </span>
              </div>
            </div>
            {showChartTable ? (
              <div className="chart-data">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Day", "دن")}</th>
                      <th>kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(period === "Today"
                      ? [
                          "06:00",
                          "08:00",
                          "10:00",
                          "12:00",
                          "14:00",
                          "16:00",
                          "18:00",
                        ]
                      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
                    ).map((day, i) => (
                      <tr key={day}>
                        <td>{day}</td>
                        <td>
                          {
                            (period === "Today"
                              ? [
                                  "06:00",
                                  "08:00",
                                  "10:00",
                                  "12:00",
                                  "14:00",
                                  "16:00",
                                  "18:00",
                                ].map((time) =>
                                  dayProduction
                                    .filter((e) => e.time <= time)
                                    .reduce(
                                      (sum, e) => sum + e.grams / 1000,
                                      0,
                                    ),
                                )
                              : [
                                  2180,
                                  2510,
                                  2250,
                                  3180,
                                  2820,
                                  3100,
                                  produced / 1000,
                                ])[i]
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ProductionChart
                entries={dayProduction}
                period={period}
                onTable={() => setShowChartTable(true)}
              />
            )}
            <div className="chart-footer">
              <span>
                <span className="live-dot" />
                {t(
                  "Today’s production is shown so far",
                  "آج کی اب تک کی پیداوار",
                )}
              </span>
              <button
                className="text-button"
                onClick={() => setShowChartTable(!showChartTable)}
              >
                {showChartTable
                  ? t("View chart", "چارٹ دیکھیں")
                  : t("View as table", "جدول دیکھیں")}
                <ArrowUpRight size={13} />
              </button>
            </div>
          </section>
          <section className="panel glass machine-panel">
            <div className="panel-heading">
              <div>
                <h3>{t("On the factory floor", "فیکٹری فلور پر")}</h3>
                <p>
                  {t(
                    "Production by machine · today",
                    "آج مشین کے لحاظ سے پیداوار",
                  )}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label={t("View all machines", "تمام مشینیں دیکھیں")}
                onClick={() => navigate("production")}
              >
                <ArrowUpRight size={19} />
              </button>
            </div>
            <div className="machine-list">
              {["1A", "1B", "2A", "2B", "3A", "3B"].map((m, i) => {
                const value = dayProduction
                  .filter((e) => e.machine === m)
                  .reduce((s, e) => s + e.grams / 1000, 0);
                return (
                  <button
                    className="machine-row"
                    key={m}
                    onClick={() => {
                      navigate("production");
                      setQuery(m);
                    }}
                  >
                    <span className="machine-name">
                      <span className="machine-box">
                        <Factory size={17} />
                      </span>
                      <strong>{m}</strong>
                      <span className="live-dot" />
                    </span>
                    <span className="machine-bar">
                      <i
                        style={{
                          width: `${Math.min(value / 6, 100)}%`,
                          opacity: 1 - i * 0.075,
                        }}
                      />
                    </span>
                    <bdi>
                      {fmt(value)} <span>kg</span>
                    </bdi>
                  </button>
                );
              })}
            </div>
            <div className="machine-footer">
              <span>
                <span className="live-dot" />{" "}
                {t("6 machines running", "۶ مشینیں چل رہی ہیں")}
              </span>
              <span>
                {t("All looking good", "سب بہتر چل رہا ہے")}
                <CheckCheck size={15} />
              </span>
            </div>
          </section>
        </div>
        <div className="bottom-grid">
          <section className="panel glass recent-panel">
            <div className="panel-heading">
              <div>
                <h3>{t("Fresh from the floor", "تازہ اندراجات")}</h3>
                <p>
                  {t(
                    "The latest entries from your team.",
                    "آپ کی ٹیم کے حالیہ اندراجات۔",
                  )}
                </p>
              </div>
              <button
                className="text-button"
                onClick={() => navigate("register")}
              >
                {t("View all entries", "تمام اندراجات")}
                <ArrowUpRight size={15} />
              </button>
            </div>
            <EntryTable
              entries={visible.slice(0, 4)}
              onDetail={(entry) => setModal({ type: "detail", entry })}
              compact
            />
          </section>
          <section className="panel glass stock-panel">
            <div className="panel-heading">
              <div>
                <h3>{t("A healthy stockroom", "اسٹاک کی صورتِ حال")}</h3>
                <p>
                  {t("Finished yarn by material", "تیار یارن، مواد کے لحاظ سے")}
                </p>
              </div>
              <Boxes size={20} />
            </div>
            <div className="stock-total">
              <strong>
                <bdi>{fmt(finished.grams / 1000)}</bdi>
              </strong>
              <span>kg {t("in stock", "اسٹاک میں")}</span>
            </div>
            <div className="composition-bar">
              {lots.map((l) => (
                <span
                  key={l.id}
                  style={{
                    background: l.color,
                    width: `${(balance(entries, l.id, "finished").grams / finished.grams) * 100}%`,
                  }}
                />
              ))}
            </div>
            <div className="composition-list">
              {lots.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setModal({ type: "lot", lot: l.id })}
                >
                  <span>
                    <i style={{ background: l.color }} />
                    {l.material}
                  </span>
                  <bdi>
                    {fmt(balance(entries, l.id, "finished").grams / 1000)}{" "}
                    <span>kg</span>
                  </bdi>
                </button>
              ))}
            </div>
            <button
              className="stock-link"
              onClick={() => navigate("inventory")}
            >
              {t("Explore inventory", "اسٹاک کی تفصیل")}
              <ArrowRight size={15} />
            </button>
          </section>
        </div>
        <div className="flow-banner">
          <div className="flow-icon">
            <Layers3 size={24} />
          </div>
          <div>
            <h3>
              {t(
                "Your next shift starts with a clear handover.",
                "اگلی شفٹ کی شروعات واضح حساب کے ساتھ۔",
              )}
            </h3>
            <p>
              {t(
                "Review today’s numbers and close the day in a few easy steps.",
                "آج کے اعداد دیکھیں اور آسانی سے دن بند کریں۔",
              )}
            </p>
          </div>
          <button onClick={() => navigate("close")}>
            {t("Go to day close", "دن بند کریں")}
            <ArrowRight size={17} />
          </button>
          <span className="banner-orbit" />
        </div>
      </>
    );
  }
  function listPage() {
    const list = visible.filter(
      (e) =>
        (route === "dispatch"
          ? e.kind === "dispatch"
          : e.kind !== "dispatch") &&
        (filter === "all" || e.shift === filter) &&
        (!query ||
          `${e.machine} ${e.serial} ${e.lot} ${e.by}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    );
    return (
      <>
        {route === "production" && (
          <div className="summary-strip glass">
            <div>
              <span className="feature-icon">
                <Factory size={22} />
              </span>
              <span>
                {t("Produced today", "آج کی پیداوار")}
                <strong>
                  <bdi>{fmt(produced / 1000)} kg</bdi>
                </strong>
              </span>
            </div>
            <div>
              <span>
                {t("Cartons packed", "پیک شدہ کارٹن")}
                <strong>
                  <bdi>{dayProduction.reduce((s, e) => s + e.cartons, 0)}</bdi>
                </strong>
              </span>
            </div>
            <div>
              <span>
                {t("Machines running", "چلتی مشینیں")}
                <strong>
                  6 <small>/ 6</small>
                </strong>
              </span>
            </div>
            <div>
              <span>
                {t("Current shift", "موجودہ شفٹ")}
                <strong>
                  A <small>07:00 – 15:00</small>
                </strong>
              </span>
            </div>
          </div>
        )}
        {route === "dispatch" && (
          <div className="info-banner">
            <Truck size={20} />
            {t(
              "Dispatch only from released lots. Stock is checked again before every save.",
              "صرف منظور شدہ لاٹ سے ترسیل کریں۔ محفوظ کرنے سے پہلے اسٹاک چیک ہوتا ہے۔",
            )}
          </div>
        )}
        <section className="panel glass">
          <div className="list-toolbar">
            <div className="tabs">
              {["all", "A", "B", "C"].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={filter === f ? "active" : ""}
                >
                  {f === "all"
                    ? t("All entries", "تمام اندراجات")
                    : `${t("Shift", "شفٹ")} ${f}`}
                </button>
              ))}
            </div>
            <div className="toolbar-actions">
              <label className="inline-search">
                <Search size={17} />
                <input
                  aria-label={t("Search entries", "اندراج تلاش کریں")}
                  placeholder={t("Search entries…", "اندراج تلاش کریں…")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <button
                className="icon-button"
                aria-label={t("Export entries", "اندراج برآمد کریں")}
                onClick={() => exportEntries(list)}
              >
                <Download size={18} />
              </button>
            </div>
          </div>
          <EntryTable
            entries={previewState === "empty" ? [] : list}
            onDetail={(entry) => setModal({ type: "detail", entry })}
          />
          <div className="table-footer">
            {t("Showing", "دکھائے گئے")} <bdi>{list.length}</bdi>{" "}
            {t(
              "entries · Asia/Karachi business date",
              "اندراج · کراچی کی کاروباری تاریخ",
            )}
            <Status tone="gray">{t("Practice data", "مشق کا ڈیٹا")}</Status>
          </div>
        </section>
      </>
    );
  }
  function inventory() {
    const list = lots.filter(
      (l) =>
        (filter !== "hold" || l.status === "hold") &&
        (!query ||
          `${l.id} ${l.spec} ${l.supplier}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    );
    return (
      <>
        <div className="inventory-summary">
          <div className="panel glass">
            <span>{t("Total finished stock", "کل تیار اسٹاک")}</span>
            <h2>
              <bdi>{fmt(finished.grams / 1000)}</bdi>
              <small> kg</small>
            </h2>
            <p>
              {finished.cartons}{" "}
              {t("cartons across 4 lots", "کارٹن، ۴ لاٹ میں")}
            </p>
          </div>
          <div className="panel glass">
            <span>{t("Raw yarn available", "دستیاب خام یارن")}</span>
            <h2>
              <bdi>{fmt(raw.grams / 1000)}</bdi>
              <small> kg</small>
            </h2>
            <p>
              {t(
                "Ready for the next production run",
                "اگلی پیداوار کے لیے تیار",
              )}
            </p>
          </div>
          <div className="panel glass">
            <span>{t("Quality hold", "کوالٹی جانچ")}</span>
            <h2>
              1<small> {t("lot", "لاٹ")}</small>
            </h2>
            <p>
              {t(
                "Lot 1216 · awaiting lab release",
                "لاٹ 1216 · لیب کی منظوری باقی",
              )}
            </p>
          </div>
        </div>
        <section className="panel glass">
          <div className="list-toolbar">
            <div className="tabs">
              {(["finished", "raw", "wip", "cops"] as Stage[]).map((s, i) => (
                <button
                  key={s}
                  className={stage === s ? "active" : ""}
                  onClick={() => setStage(s)}
                >
                  {t(
                    ["Finished yarn", "Raw yarn", "Machine WIP", "Cops WIP"][i],
                    ["تیار یارن", "خام یارن", "مشین میں", "کاپس"][i],
                  )}
                </button>
              ))}
            </div>
            <div className="toolbar-actions">
              <button
                className={`icon-button ${filter === "hold" ? "selected" : ""}`}
                aria-label={t("Filter QC hold lots", "جانچ والی لاٹ دکھائیں")}
                aria-pressed={filter === "hold"}
                onClick={() => setFilter(filter === "hold" ? "all" : "hold")}
              >
                <SlidersHorizontal size={19} />
              </button>
              <button
                className={`icon-button ${viewMatrix ? "selected" : ""}`}
                aria-label={t("Toggle matrix view", "جدولی منظر بدلیں")}
                aria-pressed={viewMatrix}
                onClick={() => setViewMatrix(!viewMatrix)}
              >
                <LayoutDashboard size={18} />
              </button>
              <button
                className="icon-button"
                aria-label={t("Export stock", "اسٹاک برآمد کریں")}
                onClick={() =>
                  downloadCsv("yarnflow-stock.csv", [
                    ["Lot", "Spec", "Stage", "kg", "Cartons", "Cones"],
                    ...list.map((l) => {
                      const b = balance(entries, l.id, stage);
                      return [
                        l.id,
                        l.spec,
                        stage,
                        b.grams / 1000,
                        b.cartons,
                        b.cones,
                      ];
                    }),
                  ])
                }
              >
                <Download size={18} />
              </button>
            </div>
          </div>
          {filter === "hold" && (
            <div className="active-filter">
              {t("QC hold lots", "جانچ والی لاٹ")}
              <button
                onClick={() => setFilter("all")}
                aria-label={t("Clear filter", "فلٹر ہٹائیں")}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {["wip", "cops"].includes(stage) &&
          total(entries, stage).grams === 0 ? (
            <Empty
              title={t(
                "Nothing in progress just yet",
                "ابھی کوئی کام جاری نہیں",
              )}
              detail={t(
                "Issue yarn to a machine to start tracking work in progress.",
                "مشین میں جاری کام دیکھنے کے لیے یارن کا اجرا کریں۔",
              )}
              action={
                <Button
                  icon={Plus}
                  onClick={() => setModal({ type: "entry", kind: "issue" })}
                >
                  {t("Issue to machine", "مشین کو اجرا")}
                </Button>
              }
            />
          ) : viewMatrix ? (
            <div className="matrix-grid">
              {list.map((l) => (
                <button
                  className="matrix-card"
                  key={l.id}
                  onClick={() => setModal({ type: "lot", lot: l.id })}
                >
                  <span
                    className="material-swatch"
                    style={{ background: l.color }}
                  >
                    <Layers3 size={25} />
                  </span>
                  <strong>{l.spec}</strong>
                  <span>
                    {t("Lot", "لاٹ")} {l.id}
                  </span>
                  <h3>
                    <bdi>
                      {fmt(balance(entries, l.id, stage).grams / 1000)} kg
                    </bdi>
                  </h3>
                  <Status tone={l.status === "hold" ? "amber" : "green"}>
                    {l.status === "hold"
                      ? t("QC hold", "جانچ باقی")
                      : t("Available", "دستیاب")}
                  </Status>
                </button>
              ))}
            </div>
          ) : (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label={t("Scrollable table", "اسکرول جدول")}
            >
              <table>
                <thead>
                  <tr>
                    <th>{t("Yarn specification", "یارن کی تفصیل")}</th>
                    <th>{t("Lot / supplier", "لاٹ / سپلائر")}</th>
                    <th>{t("Available stock", "دستیاب اسٹاک")}</th>
                    <th>{t("Cartons / cones", "کارٹن / کونز")}</th>
                    <th>{t("Status", "حالت")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((l) => {
                    const b = balance(entries, l.id, stage);
                    return (
                      <tr key={l.id}>
                        <td>
                          <button
                            className="table-link"
                            onClick={() => setModal({ type: "lot", lot: l.id })}
                          >
                            <span
                              className="material-swatch"
                              style={{ background: l.color }}
                            >
                              <Layers3 size={20} />
                            </span>
                            <span>
                              <strong>{l.spec}</strong>
                              <small>{l.material}</small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <strong>
                            <bdi>{l.id}</bdi>
                          </strong>
                          <small>{l.supplier}</small>
                        </td>
                        <td>
                          <strong className="number">
                            <bdi>{fmt(b.grams / 1000, 3)} kg</bdi>
                          </strong>
                          <small>
                            {t(
                              "Calculated from entries",
                              "اندراجات سے حساب شدہ",
                            )}
                          </small>
                        </td>
                        <td>
                          <bdi>
                            {b.cartons} / {fmt(b.cones, 0)}
                          </bdi>
                        </td>
                        <td>
                          <Status
                            tone={l.status === "hold" ? "amber" : "green"}
                          >
                            {l.status === "hold"
                              ? t("QC hold", "جانچ باقی")
                              : t("Available", "دستیاب")}
                          </Status>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`${t("View lot", "لاٹ دیکھیں")} ${l.id}`}
                            onClick={() => setModal({ type: "lot", lot: l.id })}
                          >
                            <ChevronRight size={18} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="table-footer">
            {t(
              "Balances are calculated from your immutable practice ledger.",
              "بیلنس مشق کے محفوظ اندراجات سے حساب ہوتا ہے۔",
            )}
            <span>{t("4 active lots", "۴ فعال لاٹ")}</span>
          </div>
        </section>
      </>
    );
  }
  function ordersPage() {
    const list = orders.filter(
      (o) =>
        orderTab === "all" ||
        (orderTab === "active"
          ? o.status !== "completed"
          : o.status === "completed"),
    );
    return (
      <>
        <div className="order-insight glass">
          <div className="feature-icon">
            <ShoppingBag size={26} />
          </div>
          <div>
            <strong>
              <bdi>{fmt(pending / 1000)} kg</bdi>{" "}
              {t("to make good on", "کے آرڈر مکمل کرنے ہیں")}
            </strong>
            <p>
              {t(
                "3 customers are counting on your next production run.",
                "۳ کسٹمر آپ کی اگلی پیداوار کے منتظر ہیں۔",
              )}
            </p>
          </div>
          <Button onClick={() => navigate("inventory")} icon={ArrowUpRight}>
            {t("Check available stock", "دستیاب اسٹاک دیکھیں")}
          </Button>
        </div>
        <section className="panel glass">
          <div className="list-toolbar">
            <div className="tabs">
              {["all", "active", "completed"].map((v, i) => (
                <button
                  key={v}
                  onClick={() => setOrderTab(v)}
                  className={orderTab === v ? "active" : ""}
                >
                  {t(
                    ["All orders", "In progress", "Completed"][i],
                    ["تمام آرڈرز", "جاری", "مکمل"][i],
                  )}
                  <span className="tab-count">
                    {v === "all"
                      ? orders.length
                      : orders.filter((o) =>
                          v === "active"
                            ? o.status !== "completed"
                            : o.status === "completed",
                        ).length}
                  </span>
                </button>
              ))}
            </div>
            <button
              className="icon-button"
              aria-label={t("Export orders", "آرڈر برآمد کریں")}
              onClick={() =>
                downloadCsv("yarnflow-orders.csv", [
                  [
                    "Order",
                    "Customer",
                    "Spec",
                    "Ordered kg",
                    "Delivered kg",
                    "Due",
                  ],
                  ...list.map((o) => [
                    o.id,
                    o.customer,
                    o.spec,
                    o.grams / 1000,
                    o.delivered / 1000,
                    o.due,
                  ]),
                ])
              }
            >
              <Download size={18} />
            </button>
          </div>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label={t("Scrollable table", "اسکرول جدول")}
          >
            <table>
              <thead>
                <tr>
                  <th>{t("Customer / order", "کسٹمر / آرڈر")}</th>
                  <th>{t("Yarn & fabric", "یارن اور کپڑا")}</th>
                  <th>{t("Fulfillment", "تکمیل")}</th>
                  <th>{t("Due date", "آخری تاریخ")}</th>
                  <th>{t("Status", "حالت")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <strong>{o.customer}</strong>
                      <small>
                        <bdi>{o.id}</bdi>
                      </small>
                    </td>
                    <td>
                      <strong>{o.spec}</strong>
                      <small>{o.fabric}</small>
                    </td>
                    <td>
                      <strong>
                        <bdi>
                          {fmt(o.delivered / 1000)} / {fmt(o.grams / 1000)} kg
                        </bdi>
                      </strong>
                      <div className="progress-track">
                        <i
                          style={{ width: `${(o.delivered / o.grams) * 100}%` }}
                        />
                      </div>
                    </td>
                    <td>
                      <bdi>{o.due.split("-").reverse().join("/")}</bdi>
                    </td>
                    <td>
                      <Status
                        tone={
                          o.status === "completed"
                            ? "green"
                            : o.status === "ready"
                              ? "purple"
                              : "amber"
                        }
                      >
                        {o.status === "completed"
                          ? t("Completed", "مکمل")
                          : o.status === "ready"
                            ? t("Ready to plan", "منصوبہ بندی تیار")
                            : t("In progress", "جاری")}
                      </Status>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={t("View order", "آرڈر دیکھیں")}
                        onClick={() =>
                          setModal({ type: "order-detail", report: o.id })
                        }
                      >
                        <ArrowUpRight size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!list.length && (
            <Empty title={t("No orders here yet", "ابھی کوئی آرڈر نہیں")} />
          )}
        </section>
      </>
    );
  }
  function register() {
    return (
      <section className="panel glass register-panel">
        <div className="list-toolbar">
          <div className="tabs">
            {["lot", "production", "daily"].map((tab, i) => (
              <button
                key={tab}
                onClick={() => setRegisterTab(tab)}
                className={registerTab === tab ? "active" : ""}
              >
                {t(
                  ["Lot sheet", "Production", "Daily summary"][i],
                  ["لاٹ شیٹ", "پیداوار", "روزانہ خلاصہ"][i],
                )}
              </button>
            ))}
          </div>
          <div className="toolbar-actions">
            <Button icon={Download} onClick={() => exportEntries()}>
              {t("Export CSV", "CSV برآمد کریں")}
            </Button>
            <Button icon={Printer} onClick={() => window.print()}>
              {t("Print", "پرنٹ")}
            </Button>
          </div>
        </div>
        <div className="register-caption">
          <BookOpen size={17} />
          {t(
            "Same columns as your paper register. Every saved row keeps its history.",
            "کاغذی رجسٹر جیسے کالم۔ ہر محفوظ سطر کی تاریخ برقرار۔",
          )}
          <span>{dateLabel}</span>
        </div>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label={t("Scrollable table", "اسکرول جدول")}
        >
          <table className="paper-table">
            <thead>
              <tr>
                {(registerTab === "production"
                  ? [
                      "Date",
                      "Machine",
                      "Yarn spec",
                      "Lot no.",
                      "Cartons",
                      "Cones",
                      "Weight (kg)",
                    ]
                  : registerTab === "lot"
                    ? [
                        "Lot no.",
                        "Date received",
                        "Cartons received",
                        "Cartons issued",
                        "Cartons in stock",
                        "Cones in stock",
                      ]
                    : [
                        "Date",
                        "Production (kg)",
                        "Delivery (kg)",
                        "Stock balance (kg)",
                        "Entries",
                      ]
                ).map((h, i) => (
                  <th key={h}>
                    {t(
                      h,
                      (registerTab === "production"
                        ? [
                            "تاریخ",
                            "مشین",
                            "یارن",
                            "لاٹ نمبر",
                            "کارٹن",
                            "کونز",
                            "وزن کلو",
                          ]
                        : registerTab === "lot"
                          ? [
                              "لاٹ نمبر",
                              "وصولی کی تاریخ",
                              "وصول کارٹن",
                              "جاری کارٹن",
                              "اسٹاک کارٹن",
                              "اسٹاک کونز",
                            ]
                          : [
                              "تاریخ",
                              "پیداوار کلو",
                              "ترسیل کلو",
                              "اسٹاک کلو",
                              "اندراجات",
                            ])[i],
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {registerTab === "production" ? (
                active
                  .filter((e) => e.kind === "production")
                  .map((e) => (
                    <tr
                      key={e.id}
                      onClick={() => setModal({ type: "detail", entry: e })}
                    >
                      <td>
                        <bdi>{e.date.split("-").reverse().join("/")}</bdi>
                      </td>
                      <td>
                        <bdi>{e.machine}</bdi>
                      </td>
                      <td>{lots.find((l) => l.id === e.lot)?.spec}</td>
                      <td>{e.lot}</td>
                      <td>{e.cartons}</td>
                      <td>{e.cones}</td>
                      <td>{fmt(e.grams / 1000, 3)}</td>
                    </tr>
                  ))
              ) : registerTab === "lot" ? (
                lots.map((l) => {
                  const receipts = entries
                    .filter((e) => e.kind === "receipt" && e.lot === l.id)
                    .reduce((s, e) => s + e.cartons, 0);
                  const b = balance(entries, l.id, "raw");
                  return (
                    <tr key={l.id}>
                      <td>{l.id}</td>
                      <td>{l.received.split("-").reverse().join("/")}</td>
                      <td>{receipts}</td>
                      <td>{receipts - b.cartons}</td>
                      <td>{b.cartons}</td>
                      <td>{b.cones}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td>{dateLabel}</td>
                  <td>{fmt(produced / 1000, 3)}</td>
                  <td>{fmt(dispatched / 1000, 3)}</td>
                  <td>{fmt(finished.grams / 1000, 3)}</td>
                  <td>{visible.length}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td
                  colSpan={
                    registerTab === "production"
                      ? 4
                      : registerTab === "lot"
                        ? 4
                        : 1
                  }
                >
                  {t("Total", "کل")}
                </td>
                {registerTab === "production" ? (
                  <>
                    <td>{dayProduction.reduce((s, e) => s + e.cartons, 0)}</td>
                    <td>{dayProduction.reduce((s, e) => s + e.cones, 0)}</td>
                    <td>{fmt(produced / 1000, 3)}</td>
                  </>
                ) : registerTab === "lot" ? (
                  <>
                    <td>{raw.cartons}</td>
                    <td>{raw.cones}</td>
                  </>
                ) : (
                  <>
                    <td>{fmt(produced / 1000)}</td>
                    <td>{fmt(dispatched / 1000)}</td>
                    <td>{fmt(finished.grams / 1000)}</td>
                    <td>{visible.length}</td>
                  </>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="register-add">
          <Button
            icon={Plus}
            onClick={() =>
              setModal({
                type: "entry",
                kind: registerTab === "lot" ? "receipt" : "production",
              })
            }
          >
            {t("Add a register entry", "رجسٹر میں اندراج کریں")}
          </Button>
          <small>
            {t(
              "Review first. Save once. Keep every original.",
              "پہلے جائزہ، پھر محفوظ۔ ہر اصل اندراج برقرار۔",
            )}
          </small>
        </div>
      </section>
    );
  }
  const reportNames: [string, string, string, string, LucideIcon][] = [
    [
      "Daily summary",
      "روزانہ خلاصہ",
      "Production, deliveries, and closing stock in one place.",
      "پیداوار، ترسیل اور اختتامی اسٹاک ایک جگہ۔",
      CalendarDays,
    ],
    [
      "Production register",
      "پیداوار رجسٹر",
      "Every machine, lot, and shift — clearly accounted for.",
      "ہر مشین، لاٹ اور شفٹ کا مکمل حساب۔",
      Factory,
    ],
    [
      "Lot ledger",
      "لاٹ کھاتہ",
      "Follow a lot from receipt to its final delivery.",
      "وصولی سے آخری ترسیل تک لاٹ کی تفصیل۔",
      Layers3,
    ],
    [
      "Stock report",
      "اسٹاک رپورٹ",
      "See exactly what’s available across your stockroom.",
      "گودام میں دستیاب تمام اسٹاک دیکھیں۔",
      Boxes,
    ],
    [
      "Order status",
      "آرڈر کی حالت",
      "What’s promised, what’s delivered, and what’s next.",
      "آرڈر، ترسیل اور باقی کام کی تفصیل۔",
      ShoppingBag,
    ],
    [
      "Paper-match report",
      "کاغذی رجسٹر رپورٹ",
      "A familiar layout for your paper and app parallel run.",
      "کاغذ اور ایپ کے تقابلی جائزے کے لیے مانوس ترتیب۔",
      BookOpen,
    ],
  ];
  function reports() {
    return (
      <>
        <div className="section-label">
          {t("YOUR EVERYDAY REPORTS", "روزمرہ کی رپورٹس")}
          <span>
            {t("6 reports · ready when you are", "۶ رپورٹس · ہر وقت تیار")}
          </span>
        </div>
        <div className="report-grid">
          {reportNames.map(([name, urdu, description, urDesc, I], i) => (
            <button
              key={name}
              className="report-card panel glass"
              onClick={() => setModal({ type: "report", report: name })}
            >
              <div className={`report-icon report-${i}`}>
                <Icon icon={I} size={24} />
              </div>
              <h3>{t(name, urdu)}</h3>
              <p>{t(description, urDesc)}</p>
              <div>
                <span>CSV · {t("Print / PDF", "پرنٹ / پی ڈی ایف")}</span>
                <ArrowUpRight size={18} />
              </div>
            </button>
          ))}
        </div>
        <div className="info-banner">
          <FileText size={20} />
          {t(
            "Exports use your practice data. Use your browser’s Print → Save as PDF for a PDF copy.",
            "برآمد میں مشق کا ڈیٹا شامل ہے۔ پی ڈی ایف کے لیے براؤزر میں پرنٹ ← پی ڈی ایف محفوظ کریں استعمال کریں۔",
          )}
        </div>
      </>
    );
  }
  function sync() {
    return (
      <>
        <div className="sync-hero panel glass">
          <span className="sync-illustration">
            <ShieldCheck size={40} />
          </span>
          <div>
            <h2>
              {t(
                "Your practice entries are safe here.",
                "آپ کے مشق کے اندراجات یہاں محفوظ ہیں۔",
              )}
            </h2>
            <p>
              {t(
                "Saved in this browser. A factory server is not connected to this preview.",
                "اس براؤزر میں محفوظ ہیں۔ یہ پیش نظارہ فیکٹری سرور سے منسلک نہیں۔",
              )}
            </p>
            <Status tone={offline ? "amber" : "green"}>
              {offline
                ? t(
                    "Offline · local saves available",
                    "آف لائن · مقامی محفوظ دستیاب",
                  )
                : t(
                    "Online · practice workspace",
                    "آن لائن · مشق کا ورک اسپیس",
                  )}
            </Status>
          </div>
        </div>
        <div className="inventory-summary">
          <div className="panel glass">
            <span>{t("Saved on this device", "اس ڈیوائس پر محفوظ")}</span>
            <h2>
              {savedLocal}
              <small> {t("entries", "اندراجات")}</small>
            </h2>
          </div>
          <div className="panel glass">
            <span>{t("Sample records", "نمونہ ریکارڈ")}</span>
            <h2>{visible.length - savedLocal}</h2>
          </div>
          <div className="panel glass">
            <span>{t("Factory connection", "فیکٹری کنکشن")}</span>
            <h2 className="text-value">{t("Not connected", "منسلک نہیں")}</h2>
          </div>
        </div>
        <div className="warning-banner">
          <AlertTriangle size={20} />
          <div>
            <strong>
              {t("Keep a copy of your work.", "اپنے کام کی نقل رکھیں۔")}
            </strong>
            <p>
              {t(
                "Clearing browser data removes local practice entries. Export a backup before clearing storage or changing devices.",
                "براؤزر ڈیٹا صاف کرنے سے مقامی اندراجات مٹ جائیں گے۔ پہلے بیک اپ برآمد کریں۔",
              )}
            </p>
          </div>
          <Button
            icon={Download}
            onClick={() =>
              downloadCsv("yarnflow-local-backup.json.csv", [
                ["Backup JSON"],
                [JSON.stringify({ entries, orders })],
              ])
            }
          >
            {t("Export backup", "بیک اپ برآمد کریں")}
          </Button>
        </div>
        <section className="panel glass">
          <div className="panel-heading">
            <h3>{t("Saved on this device", "اس ڈیوائس پر محفوظ")}</h3>
            <Button
              icon={RefreshCw}
              onClick={() =>
                notify(
                  t(
                    "All practice entries are saved locally. Server sync needs a connected backend.",
                    "تمام اندراجات مقامی طور پر محفوظ ہیں۔ سنک کے لیے سرور کنکشن درکار ہے۔",
                  ),
                )
              }
            >
              {t("Check status", "حالت چیک کریں")}
            </Button>
          </div>
          <EntryTable
            entries={visible.filter((e) => e.createdAt > 0)}
            onDetail={(entry) => setModal({ type: "detail", entry })}
          />
        </section>
      </>
    );
  }
  function settings() {
    return (
      <div className="settings-layout">
        <nav className="settings-nav">
          {[
            ["general", "General", "عمومی", Settings2],
            ["appearance", "Appearance", "ظاہری شکل", Sun],
            ["data", "Data & masters", "ڈیٹا اور بنیادی معلومات", Database],
            ["people", "People & devices", "افراد اور ڈیوائسز", Users],
          ].map(([key, en, urdu, I]) => (
            <button
              key={String(key)}
              className={settingsTab === key ? "active" : ""}
              onClick={() => setSettingsTab(String(key))}
            >
              <Icon icon={I as LucideIcon} />
              {t(String(en), String(urdu))}
              <ChevronRight size={15} />
            </button>
          ))}
        </nav>
        <section className="panel glass settings-panel">
          {settingsTab === "general" ? (
            <>
              <h3>{t("A workspace of your own", "آپ کا اپنا ورک اسپیس")}</h3>
              <p className="muted">
                {t(
                  "The small details that make it feel like your factory.",
                  "آپ کی فیکٹری کی بنیادی معلومات۔",
                )}
              </p>
              <label>
                {t("Factory name", "فیکٹری کا نام")}
                <input
                  value={factoryName}
                  onChange={(e) => setFactoryName(e.target.value)}
                  maxLength={80}
                />
              </label>
              <div className="form-grid">
                <label>
                  {t("Timezone", "ٹائم زون")}
                  <input value="Asia/Karachi (UTC +05:00)" readOnly />
                </label>
                <label>
                  {t("Language", "زبان")}
                  <select
                    value={ur ? "ur" : "en"}
                    onChange={(e) => setUr(e.target.value === "ur")}
                  >
                    <option value="en">English</option>
                    <option value="ur">اردو</option>
                  </select>
                </label>
              </div>
              <div className="setting-line">
                <div>
                  <strong>{t("Practice workspace", "مشق کا ورک اسپیس")}</strong>
                  <p>
                    {t(
                      "Try real workflows with sample data, safely.",
                      "نمونہ ڈیٹا کے ساتھ کام کی مشق کریں۔",
                    )}
                  </p>
                </div>
                <Status tone="purple">
                  {t("Always on in this preview", "اس پیش نظارے میں فعال")}
                </Status>
              </div>
              <Button
                variant="primary"
                icon={Check}
                onClick={() =>
                  notify(
                    t(
                      "Workspace preferences saved on this device.",
                      "ورک اسپیس کی ترتیبات اس ڈیوائس پر محفوظ ہوگئیں۔",
                    ),
                  )
                }
              >
                {t("Save preferences", "ترتیبات محفوظ کریں")}
              </Button>
            </>
          ) : settingsTab === "appearance" ? (
            <>
              <h3>{t("Find your kind of clarity", "اپنی پسند کا منظر")}</h3>
              <p className="muted">
                {t(
                  "Choose a comfortable view for your environment.",
                  "اپنے ماحول کے مطابق آرام دہ منظر منتخب کریں۔",
                )}
              </p>
              <div className="theme-options">
                {[
                  ["light", "Liquid glass", "لیکوئڈ گلاس", Sun],
                  ["dark", "After hours", "گہرا منظر", Moon],
                  ["factory", "Factory mode", "فیکٹری موڈ", Monitor],
                ].map(([key, en, urdu, I]) => (
                  <button
                    key={String(key)}
                    onClick={() => setTheme(String(key))}
                    className={`theme-card ${key} ${theme === key ? "active" : ""}`}
                  >
                    <div className="theme-preview">
                      <span />
                      <div>
                        <i />
                        <i />
                        <i />
                      </div>
                    </div>
                    <span>
                      <Icon icon={I as LucideIcon} size={18} />
                      {t(String(en), String(urdu))}
                      {theme === key && <Check size={17} />}
                    </span>
                  </button>
                ))}
              </div>
              <div className="info-banner">
                <Eye size={20} />
                {t(
                  "Factory mode uses stronger borders and higher contrast for the floor.",
                  "فیکٹری موڈ میں واضح بارڈر اور زیادہ کنٹراسٹ ہے۔",
                )}
              </div>
            </>
          ) : settingsTab === "data" ? (
            <>
              <h3>
                {t(
                  "Everything starts with good data",
                  "درست معلومات سے بہتر شروعات",
                )}
              </h3>
              {[
                [
                  "masters",
                  "Manage yarn, lots & suppliers",
                  "یارن، لاٹ اور سپلائر سنبھالیں",
                  Database,
                ],
                ["import", "Import a register", "رجسٹر درآمد کریں", Upload],
                [
                  "sync",
                  "Back up your practice data",
                  "مشق کے ڈیٹا کا بیک اپ",
                  Download,
                ],
              ].map(([to, en, urdu, I]) => (
                <button
                  key={String(to)}
                  className="setting-link"
                  onClick={() => navigate(String(to))}
                >
                  <Icon icon={I as LucideIcon} />
                  <span>{t(String(en), String(urdu))}</span>
                  <ArrowUpRight size={18} />
                </button>
              ))}
            </>
          ) : (
            <>
              <h3>
                {t(
                  "A little teamwork goes a long way",
                  "ٹیم ورک سے بہتر نتائج",
                )}
              </h3>
              <p className="muted">
                {t(
                  "Preview the people and device management screens.",
                  "افراد اور ڈیوائسز کے انتظام کا پیش نظارہ دیکھیں۔",
                )}
              </p>
              <Button icon={Users} onClick={() => navigate("users")}>
                {t("Manage people & devices", "افراد اور ڈیوائسز سنبھالیں")}
              </Button>
            </>
          )}
        </section>
      </div>
    );
  }
  function help() {
    return (
      <>
        <div className="help-hero glass">
          <span className="feature-icon">
            <CircleHelp size={30} />
          </span>
          <h2>
            {t(
              "You’ve got this. We’re here to help.",
              "آپ یہ کر سکتے ہیں۔ ہم مدد کے لیے موجود ہیں۔",
            )}
          </h2>
          <p>
            {t(
              "Get comfortable with your new everyday workspace.",
              "اپنے نئے روزمرہ ورک اسپیس سے واقف ہوں۔",
            )}
          </p>
          <Button
            variant="primary"
            icon={Sparkles}
            onClick={() => navigate("home")}
          >
            {t("Explore practice actions", "مشق کے کام دیکھیں")}
          </Button>
        </div>
        <div className="help-grid">
          {[
            [
              "How do I record production?",
              "پیداوار کیسے درج کروں؟",
              "Choose New entry → Record production. Pick a machine and lot, enter quantities, then review and save.",
              "نیا اندراج ← پیداوار منتخب کریں۔ مشین اور لاٹ چنیں، مقدار درج کریں، پھر جائزہ اور محفوظ کریں۔",
            ],
            [
              "What happens without internet?",
              "انٹرنیٹ نہ ہو تو کیا ہوگا؟",
              "Practice entries save on this device. After the first visit, the app shell is cached for offline use. This preview has no factory sync server.",
              "مشق کے اندراجات ڈیوائس پر محفوظ ہوتے ہیں۔ پہلی بار کھولنے کے بعد ایپ آف لائن بھی دستیاب ہے۔ اس پیش نظارے میں سرور سنک نہیں۔",
            ],
            [
              "Can I correct a saved entry?",
              "کیا محفوظ اندراج درست کر سکتا ہوں؟",
              "Open an entry and choose Reverse entry. Give a reason. The original stays in history, and a reversing entry restores stock if it is still available.",
              "اندراج کھولیں اور واپس کریں منتخب کریں۔ وجہ درج کریں۔ اصل تاریخ برقرار رہے گی اور اسٹاک دستیاب ہونے پر واپس ہوگا۔",
            ],
            [
              "What does QC hold mean?",
              "کوالٹی ہولڈ کیا ہے؟",
              "The lot is waiting for a quality check. It remains visible in stock, but cannot be dispatched until the manager releases it.",
              "لاٹ کی کوالٹی جانچ باقی ہے۔ اسٹاک میں نظر آتی ہے لیکن منظوری تک ترسیل نہیں ہوسکتی۔",
            ],
          ].map(([en, urdu, answer, urAnswer]) => (
            <details className="help-question glass" key={en}>
              <summary>
                {t(en, urdu)}
                <ChevronDown size={18} />
              </summary>
              <p>{t(answer, urAnswer)}</p>
            </details>
          ))}
        </div>
        <div className="help-links">
          <button onClick={() => navigate("components")}>
            <Layers3 size={19} />
            {t("Component gallery", "کمپوننٹ گیلری")}
            <ArrowUpRight size={16} />
          </button>
          <button onClick={() => navigate("login")}>
            <Users size={19} />
            {t("Try the PIN login screen", "پن لاگ ان آزمائیں")}
            <ArrowUpRight size={16} />
          </button>
        </div>
      </>
    );
  }
  function dayClose() {
    const isClosed = closed === today();
    return (
      <div className="day-close panel glass">
        <div className="day-close-head">
          <span className="feature-icon">
            <CalendarDays size={28} />
          </span>
          <h2>
            {isClosed
              ? t("A good day, all wrapped up.", "آج کا حساب مکمل ہوگیا۔")
              : t("Let’s bring today together.", "آج کا حساب مکمل کریں۔")}
          </h2>
          <p>
            {dateLabel} · {factoryName}
          </p>
        </div>
        <div className="close-totals">
          <div>
            <span>{t("Production", "پیداوار")}</span>
            <strong>
              <bdi>{fmt(produced / 1000)} kg</bdi>
            </strong>
          </div>
          <div>
            <span>{t("Dispatch", "ترسیل")}</span>
            <strong>
              <bdi>{fmt(dispatched / 1000)} kg</bdi>
            </strong>
          </div>
          <div>
            <span>{t("Closing stock", "اختتامی اسٹاک")}</span>
            <strong>
              <bdi>{fmt(finished.grams / 1000)} kg</bdi>
            </strong>
          </div>
        </div>
        {isClosed ? (
          <div className="success-block">
            <CircleCheck size={36} />
            <h3>{t("Practice day closed", "مشق کا دن بند ہوگیا")}</h3>
            <p>
              {t(
                "New entries for today are now blocked in this practice workspace.",
                "اس مشق کے ورک اسپیس میں آج کے نئے اندراجات بند ہیں۔",
              )}
            </p>
            <Button onClick={() => setModal({ type: "reopen" })}>
              {t("Reopen with a reason", "وجہ کے ساتھ دوبارہ کھولیں")}
            </Button>
          </div>
        ) : (
          <>
            <h3>
              {t(
                "A quick check before you close",
                "بند کرنے سے پہلے مختصر چیک",
              )}
            </h3>
            {[
              [
                "I reviewed today’s production and dispatch entries.",
                "آج کی پیداوار اور ترسیل دیکھ لی ہے۔",
              ],
              [
                "I checked the closing stock against the register.",
                "رجسٹر سے اختتامی اسٹاک ملا لیا ہے۔",
              ],
              [
                "I have exported a backup of locally saved entries.",
                "مقامی اندراجات کا بیک اپ برآمد کر لیا ہے۔",
              ],
            ].map(([en, urdu], i) => (
              <label className="check-line" key={en}>
                <input
                  type="checkbox"
                  checked={checks[i]}
                  onChange={(e) =>
                    setChecks(
                      checks.map((v, j) => (j === i ? e.target.checked : v)),
                    )
                  }
                />
                {t(en, urdu)}
              </label>
            ))}
            <label>
              {t("Handover notes", "اگلی شفٹ کے لیے نوٹس")}
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder={t(
                  "Anything for the next shift?",
                  "اگلی شفٹ کے لیے کوئی بات؟",
                )}
              />
            </label>
            <div className="modal-actions">
              <Button icon={Download} onClick={() => exportEntries()}>
                {t("Export daily summary", "روزانہ خلاصہ برآمد")}
              </Button>
              <Button
                variant="primary"
                icon={LockKeyhole}
                disabled={!checks.every(Boolean)}
                onClick={() => setModal({ type: "close-confirm" })}
              >
                {t("Review & close day", "جائزہ لیں اور دن بند کریں")}
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }
  function searchPage() {
    const results = query.trim()
      ? visible.filter((e) =>
          `${e.serial} ${e.machine} ${e.lot} ${e.by} ${lots.find((l) => l.id === e.lot)?.spec}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
      : [];
    const foundLots = lots.filter(
      (l) =>
        query.trim() &&
        `${l.id} ${l.spec} ${l.supplier}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
    return (
      <section className="panel glass">
        <label className="large-search">
          <Search size={23} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(
              "Try a lot number, yarn spec, or machine…",
              "لاٹ نمبر، یارن یا مشین تلاش کریں…",
            )}
            aria-label={t("Search all records", "تمام ریکارڈ تلاش کریں")}
          />
          {query && (
            <button
              className="icon-button"
              aria-label={t("Clear search", "تلاش صاف کریں")}
              onClick={() => setQuery("")}
            >
              <X size={18} />
            </button>
          )}
        </label>
        {foundLots.length > 0 && (
          <div className="search-lots">
            {foundLots.map((l) => (
              <button
                key={l.id}
                onClick={() => setModal({ type: "lot", lot: l.id })}
              >
                <Layers3 size={20} />
                <strong>
                  {t("Lot", "لاٹ")} {l.id}
                </strong>
                <span>{l.spec}</span>
                <ArrowUpRight size={17} />
              </button>
            ))}
          </div>
        )}
        {results.length ? (
          <EntryTable
            entries={results}
            onDetail={(entry) => setModal({ type: "detail", entry })}
          />
        ) : (
          <Empty
            title={
              query
                ? t("No matching entries", "کوئی اندراج نہیں ملا")
                : t("Find something in a heartbeat.", "فوراً تلاش کریں۔")
            }
            detail={
              query
                ? t(
                    "Check the lot number or try the supplier name.",
                    "لاٹ نمبر چیک کریں یا سپلائر کا نام آزمائیں۔",
                  )
                : t(
                    "Search by lot, serial, machine, yarn specification, or team member.",
                    "لاٹ، سیریل، مشین، یارن یا ٹیم کے نام سے تلاش کریں۔",
                  )
            }
            action={
              query ? (
                <Button onClick={() => setQuery("")}>
                  {t("Clear search", "تلاش صاف کریں")}
                </Button>
              ) : (
                <div className="search-suggestions">
                  {["1221", "30/1", "1A"].map((s) => (
                    <button key={s} onClick={() => setQuery(s)}>
                      {s}
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
              )
            }
          />
        )}
      </section>
    );
  }
  function masters() {
    return (
      <>
        <div className="info-banner">
          <Database size={19} />
          {t(
            "Sample master data is read-only. Production editing and archiving need server permissions.",
            "نمونہ بنیادی ڈیٹا صرف پڑھنے کے لیے ہے۔ اصل ترمیم اور آرکائیو کے لیے سرور کی اجازت ضروری ہے۔",
          )}
        </div>
        <section className="panel glass">
          <div className="panel-heading">
            <h3>{t("Yarn specifications & lots", "یارن کی تفصیل اور لاٹ")}</h3>
            <Status tone="purple">{t("4 sample lots", "۴ نمونہ لاٹ")}</Status>
          </div>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label={t("Scrollable table", "اسکرول جدول")}
          >
            <table>
              <thead>
                <tr>
                  {[
                    "Specification",
                    "Lot",
                    "Supplier",
                    "Packing default",
                    "Status",
                  ].map((h, i) => (
                    <th key={h}>
                      {t(h, ["یارن", "لاٹ", "سپلائر", "پیکنگ", "حالت"][i])}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lots.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <strong>{l.spec}</strong>
                    </td>
                    <td>{l.id}</td>
                    <td>{l.supplier}</td>
                    <td>24 {t("cones / carton", "کونز / کارٹن")}</td>
                    <td>
                      <Status tone={l.status === "hold" ? "amber" : "green"}>
                        {l.status === "hold"
                          ? t("QC hold", "جانچ باقی")
                          : t("Active", "فعال")}
                      </Status>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="inventory-summary">
          {[
            ["6", "Machines", "مشینیں", "1A · 1B · 2A · 2B · 3A · 3B"],
            ["3", "Shifts", "شفٹیں", "A 07–15 · B 15–23 · C 23–07"],
            ["3", "Suppliers", "سپلائر", "Crescent · Nishat · Ibrahim"],
          ].map(([n, en, urdu, desc]) => (
            <div className="panel glass" key={en}>
              <span>{t(en, urdu)}</span>
              <h2>{n}</h2>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </>
    );
  }
  function users() {
    return (
      <>
        <div className="info-banner">
          <ShieldCheck size={20} />
          {t(
            "These are practice profiles. Live PIN resets, device approval, and permissions require the authentication server.",
            "یہ مشق کے پروفائل ہیں۔ اصل پن، ڈیوائس منظوری اور اجازتوں کے لیے سرور ضروری ہے۔",
          )}
        </div>
        <section className="panel glass">
          <div className="panel-heading">
            <h3>{t("Your people", "آپ کی ٹیم")}</h3>
            <Button icon={LogOut} onClick={() => navigate("login")}>
              {t("Switch profile", "پروفائل بدلیں")}
            </Button>
          </div>
          {[
            ["Ahmed Khan", "Owner", "مالک", "AK"],
            ["Asif Ali", "Supervisor", "سپروائزر", "AA"],
            ["Muhammad Bilal", "Operator", "آپریٹر", "MB"],
          ].map(([name, role, urdu, initials]) => (
            <div className="user-row" key={name}>
              <span className="avatar">{initials}</span>
              <div>
                <strong>{name}</strong>
                <small>{t(role, urdu)}</small>
              </div>
              <Status>{t("Practice profile", "مشق پروفائل")}</Status>
            </div>
          ))}
        </section>
        <section className="panel glass">
          <div className="panel-heading">
            <h3>{t("This device", "یہ ڈیوائس")}</h3>
            <Monitor size={20} />
          </div>
          <div className="device-row">
            <span className="feature-icon">
              <Monitor size={24} />
            </span>
            <div>
              <strong>
                {t("Your current browser", "آپ کا موجودہ براؤزر")}
              </strong>
              <p>
                {t(
                  "Local practice storage · no registered factory device",
                  "مقامی مشق اسٹوریج · فیکٹری ڈیوائس رجسٹر نہیں",
                )}
              </p>
            </div>
          </div>
        </section>
      </>
    );
  }
  function home() {
    return (
      <div className="quick-actions">
        <button
          className="quick-action glass"
          onClick={() => navigate("scanner")}
        >
          <span className="feature-icon">
            <ScanLine size={30} />
          </span>
          <h3>{t("Scan material", "کپڑا اسکین کریں")}</h3>
          <ArrowUpRight size={20} />
        </button>
        {[
          ["production", "Record production", "پیداوار درج کریں", Factory],
          ["issue", "Issue to machine", "مشین کو اجرا", Layers3],
          ["receipt", "Receive yarn", "یارن وصول کریں", PackagePlus],
          ["dispatch", "Dispatch yarn", "یارن ترسیل کریں", Truck],
        ].map(([kind, en, urdu, I]) => (
          <button
            className="quick-action glass"
            key={String(kind)}
            onClick={() => setModal({ type: "entry", kind: kind as Kind })}
          >
            <span className="feature-icon">
              <Icon icon={I as LucideIcon} size={30} />
            </span>
            <h3>{t(String(en), String(urdu))}</h3>
            <ArrowUpRight size={20} />
          </button>
        ))}
        <button
          className="quick-action glass"
          onClick={() => navigate("register")}
        >
          <span className="feature-icon">
            <BookOpen size={30} />
          </span>
          <h3>{t("Open register", "رجسٹر کھولیں")}</h3>
          <ArrowUpRight size={20} />
        </button>
        <button
          className="quick-action glass"
          onClick={() => navigate("close")}
        >
          <span className="feature-icon">
            <CalendarDays size={30} />
          </span>
          <h3>{t("Close the day", "دن بند کریں")}</h3>
          <ArrowUpRight size={20} />
        </button>
      </div>
    );
  }
  function gallery() {
    return (
      <div className="gallery">
        <section className="panel glass">
          <h3>{t("Buttons & controls", "بٹن اور کنٹرول")}</h3>
          <div className="gallery-row">
            <Button
              variant="primary"
              onClick={() => notify(t("Action complete", "کام مکمل"))}
              icon={Check}
            >
              {t("Primary action", "بنیادی عمل")}
            </Button>
            <Button
              onClick={() =>
                notify(t("Secondary action complete", "ثانوی کام مکمل"))
              }
            >
              {t("Secondary action", "ثانوی عمل")}
            </Button>
            <Button disabled>{t("Disabled", "غیر فعال")}</Button>
          </div>
          <div className="gallery-row">
            <Status>{t("Saved locally", "مقامی محفوظ")}</Status>
            <Status tone="amber">{t("QC hold", "جانچ باقی")}</Status>
            <Status tone="purple">{t("Practice", "مشق")}</Status>
            <Status tone="gray">{t("Archived", "آرکائیو")}</Status>
          </div>
          <label>
            {t("Preview a screen state", "اسکرین کی حالت دیکھیں")}
            <select
              value={previewState}
              onChange={(e) => setPreviewState(e.target.value)}
            >
              {["ready", "loading", "empty", "error", "denied"].map(
                (state, i) => (
                  <option key={state} value={state}>
                    {t(
                      [
                        "Ready",
                        "Loading",
                        "Empty",
                        "Error",
                        "Permission denied",
                      ][i],
                      ["تیار", "لوڈنگ", "خالی", "خرابی", "اجازت نہیں"][i],
                    )}
                  </option>
                ),
              )}
            </select>
          </label>
        </section>
        <section className="panel glass">
          <h3>{t("Theme & language", "منظر اور زبان")}</h3>
          <div className="gallery-row">
            <Button onClick={() => setUr(!ur)} icon={Globe2}>
              {ur ? "English" : "اردو"}
            </Button>
            {["light", "dark", "factory"].map((v, i) => (
              <Button key={v} onClick={() => setTheme(v)}>
                {t(
                  ["Liquid glass", "After hours", "Factory mode"][i],
                  ["لیکوئڈ گلاس", "گہرا منظر", "فیکٹری موڈ"][i],
                )}
              </Button>
            ))}
          </div>
        </section>
      </div>
    );
  }
  function content() {
    if (previewState === "loading")
      return (
        <div className="panel glass loading-state" role="status">
          <RefreshCw className="spin" size={30} />
          <p>
            {t("Loading your workspace…", "آپ کا ورک اسپیس لوڈ ہو رہا ہے…")}
          </p>
          <Button onClick={() => setPreviewState("ready")}>
            {t("Finish preview", "پیش نظارہ مکمل")}
          </Button>
        </div>
      );
    if (previewState === "error" || previewState === "denied")
      return (
        <div className="panel glass">
          <Empty
            title={
              previewState === "denied"
                ? t(
                    "This view needs manager access",
                    "اس منظر کے لیے مینیجر کی اجازت درکار ہے",
                  )
                : t("We couldn’t load these entries", "اندراجات لوڈ نہیں ہوئے")
            }
            detail={t(
              "Your saved entries are still safe on this device.",
              "آپ کے محفوظ اندراجات اس ڈیوائس پر برقرار ہیں۔",
            )}
            action={
              <Button onClick={() => setPreviewState("ready")}>
                {t("Try again", "دوبارہ کوشش کریں")}
              </Button>
            }
          />
        </div>
      );
    switch (route) {
      case "overview":
        return overview();
      case "scanner":
        return <Scanner t={t} onInventory={() => navigate("inventory")} />;
      case "production":
      case "dispatch":
        return listPage();
      case "inventory":
        return inventory();
      case "orders":
        return ordersPage();
      case "register":
        return register();
      case "reports":
        return reports();
      case "sync":
        return sync();
      case "settings":
        return settings();
      case "help":
        return help();
      case "search":
        return searchPage();
      case "close":
        return dayClose();
      case "masters":
        return masters();
      case "users":
        return users();
      case "import":
        return <ImportPage onNotify={notify} />;
      case "home":
        return home();
      case "components":
        return gallery();
      default:
        return overview();
    }
  }
  const currentEntry = modal?.entry;
  const currentLot = lots.find((l) => l.id === modal?.lot);
  const currentOrder = orders.find((o) => o.id === modal?.report);
  return (
    <LedgerContext.Provider value={entries}>
      <div className="app-shell">
        {mobileNav && (
          <button
            className="sidebar-scrim"
            aria-label={t("Close navigation", "نیویگیشن بند کریں")}
            onClick={() => setMobileNav(false)}
          />
        )}
        <aside className={`sidebar glass ${mobileNav ? "open" : ""}`}>
          <button
            className="brand-button"
            onClick={() => navigate("overview")}
            aria-label="Yarnflow overview"
          >
            <Logo />
          </button>
          <button
            className="workspace-picker"
            onClick={() => navigate("settings")}
          >
            <span className="workspace-symbol">
              <Factory size={19} />
            </span>
            <span>
              <strong>{factoryName}</strong>
              <small>
                {t("Your factory workspace", "آپ کی فیکٹری کا ورک اسپیس")}
              </small>
            </span>
            <ChevronDown size={15} />
          </button>
          <div className="nav-label">{t("WORKSPACE", "ورک اسپیس")}</div>
          <nav
            className="main-nav"
            aria-label={t("Main navigation", "بنیادی نیویگیشن")}
          >
            {navItems.map(([to, en, urdu, I]) => (
              <button
                key={to}
                onClick={() => {
                  setQuery("");
                  navigate(to);
                }}
                className={route === to ? "active" : ""}
                aria-current={route === to ? "page" : undefined}
              >
                <Icon icon={I} />
                <span>{t(en, urdu)}</span>
                {to === "orders" && (
                  <span className="nav-badge">
                    {orders.filter((o) => o.status !== "completed").length}
                  </span>
                )}
                {to === "overview" && route === to && (
                  <span className="active-indicator" />
                )}
              </button>
            ))}
          </nav>
          <div className="nav-label tools-label">
            {t("YOUR TOOLS", "آپ کے ٹولز")}
          </div>
          <nav className="main-nav utility-nav" aria-label={t("Tools", "ٹولز")}>
            {[
              ["sync", "Sync center", "سنک سینٹر", RefreshCw],
              ["settings", "Settings", "ترتیبات", Settings2],
              ["help", "Help & getting started", "مدد اور شروعات", CircleHelp],
            ].map(([to, en, urdu, I]) => (
              <button
                key={String(to)}
                onClick={() => navigate(String(to))}
                className={route === to ? "active" : ""}
              >
                <Icon icon={I as LucideIcon} />
                <span>{t(String(en), String(urdu))}</span>
                {to === "sync" && <span className="tiny-green-dot" />}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="practice-card">
              <div>
                <span className="practice-icon">
                  <Sparkles size={17} />
                </span>
                <strong>{t("A little practice?", "کچھ مشق کریں؟")}</strong>
              </div>
              <p>
                {t(
                  "Get the hang of things. Your real stock stays safe.",
                  "کام کو سمجھیں۔ آپ کا اصل اسٹاک محفوظ ہے۔",
                )}
              </p>
              <button onClick={() => navigate("home")}>
                {t("Explore practice mode", "مشق کا موڈ کھولیں")}
                <ArrowUpRight size={16} />
              </button>
            </div>
            <button className="user-profile" onClick={() => navigate("login")}>
              <span className="avatar">{initials}</span>
              <span>
                <strong>{user}</strong>
                <small>
                  {t("Practice · Switch profile", "مشق · پروفائل بدلیں")}
                </small>
              </span>
              <LogOut size={17} />
            </button>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button mobile-menu"
                onClick={() => setMobileNav(true)}
                aria-label={t("Open navigation", "نیویگیشن کھولیں")}
              >
                <Menu size={22} />
              </button>
              <span className="breadcrumb-home">
                <Factory size={16} />
                <span>{t("Workspace", "ورک اسپیس")}</span>
                <ChevronRight size={13} />
              </span>
              <strong>{t(title[0], title[1])}</strong>
            </div>
            <div className="topbar-right">
              <label className="global-search">
                <Search size={17} />
                <input
                  id="global-search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    if (e.target.value && route !== "search")
                      navigate("search");
                  }}
                  placeholder={t("Search anything…", "کچھ بھی تلاش کریں…")}
                  aria-label={t("Search anything", "کچھ بھی تلاش کریں")}
                />
                <kbd>/</kbd>
              </label>
              <button className="top-sync" onClick={() => navigate("sync")}>
                <span className={offline ? "offline-dot" : "live-dot"} />
                {offline
                  ? t("Offline", "آف لائن")
                  : t("Saved locally", "مقامی محفوظ")}
              </button>
              <span className="topbar-divider" />
              <button
                className="language-button"
                onClick={() => setUr(!ur)}
                aria-label={ur ? "Switch to English" : "اردو میں بدلیں"}
              >
                <Globe2 size={17} />
                <span>{ur ? "EN" : "اردو"}</span>
              </button>
              <button
                className="icon-button notification-button"
                aria-label={t("Notifications", "اطلاعات")}
                onClick={() => setModal({ type: "notifications" })}
              >
                <Bell size={20} />
                <i />
              </button>
              <button
                className="avatar small-avatar"
                aria-label={t("Switch profile", "پروفائل بدلیں")}
                onClick={() => navigate("login")}
              >
                {initials}
              </button>
            </div>
          </header>
          <main id="main-content">
            <div className="page-heading">
              <div>
                <div className="page-eyebrow">
                  <span className="eyebrow">
                    {t("YOUR FACTORY, IN FLOW", "آپ کی فیکٹری، رواں دواں")}
                  </span>
                  <span className="practice-label">
                    <span />
                    {route === "scanner"
                      ? t("TexPilot integration", "ٹیکس پائلٹ انٹیگریشن")
                      : t("Practice workspace", "مشق کا ورک اسپیس")}
                  </span>
                </div>
                <h1>
                  {t(title[0], title[1])}
                  <span className="heading-dot">.</span>
                </h1>
                <p>{t(title[2], title[3])}</p>
              </div>
              <div className="heading-actions">{headerAction()}</div>
            </div>
            {offline && (
              <div className="info-banner offline-banner">
                <WifiOff size={19} />
                {t(
                  "You’re offline. Practice entries will still save on this device.",
                  "آپ آف لائن ہیں۔ مشق کے اندراجات پھر بھی ڈیوائس پر محفوظ ہوں گے۔",
                )}
                <button
                  className="text-button"
                  onClick={() => navigate("sync")}
                >
                  {t("Details", "تفصیل")}
                </button>
              </div>
            )}
            {closed === today() && route !== "close" && (
              <div className="warning-banner">
                <LockKeyhole size={18} />
                {t(
                  "Today is closed. Reopen the practice day to record more entries.",
                  "آج کا دن بند ہے۔ مزید اندراجات کے لیے دن دوبارہ کھولیں۔",
                )}
                <button
                  className="text-button"
                  onClick={() => navigate("close")}
                >
                  {t("View day close", "دن بند کرنے کی تفصیل")}
                </button>
              </div>
            )}
            {content()}
            <footer className="page-footer">
              <span>
                <img src="/icon.svg" alt="" />
                {t(
                  "A little more flow. A lot less paperwork.",
                  "کام رواں، کاغذی کام کم۔",
                )}
              </span>
              <span>
                {t(
                  "Practice data · Stored on this device",
                  "مشق کا ڈیٹا · ڈیوائس پر محفوظ",
                )}
                <span className="footer-dot" />
                Yarnflow v0.1
              </span>
            </footer>
          </main>
        </div>
        {modal && (
          <Modal
            title={
              modal.type === "entry"
                ? t(...kindNames[modal.kind || "production"])
                : modal.type === "new"
                  ? t(
                      "What would you like to record?",
                      "آپ کیا درج کرنا چاہتے ہیں؟",
                    )
                  : modal.type === "detail"
                    ? t("Entry details", "اندراج کی تفصیل")
                    : modal.type === "lot"
                      ? `${t("Lot", "لاٹ")} ${modal.lot}`
                      : modal.type === "date"
                        ? t("Your business date", "آپ کی کاروباری تاریخ")
                        : modal.type === "notifications"
                          ? t("A little attention", "تھوڑی توجہ")
                          : modal.type === "order"
                            ? t("Create an order", "آرڈر بنائیں")
                            : modal.type === "report"
                              ? t("Report preview", "رپورٹ پیش نظارہ")
                              : modal.type === "order-detail"
                                ? t("Order details", "آرڈر کی تفصیل")
                                : modal.type === "void"
                                  ? t("Reverse this entry", "اندراج واپس کریں")
                                  : modal.type === "reopen"
                                    ? t(
                                        "Reopen the practice day",
                                        "مشق کا دن دوبارہ کھولیں",
                                      )
                                    : t(
                                        "Close the practice day",
                                        "مشق کا دن بند کریں",
                                      )
            }
            onClose={() => setModal(null)}
            wide={["report", "lot"].includes(modal.type)}
          >
            {modal.type === "entry" && (
              <EntryForm
                user={user}
                kind={modal.kind || "production"}
                entries={entries}
                onSave={save}
                onClose={() => setModal(null)}
                closed={closed === today()}
              />
            )}
            {modal.type === "new" && (
              <div className="new-entry-grid">
                {(["production", "receipt", "issue", "dispatch"] as Kind[]).map(
                  (kind, i) => (
                    <button
                      key={kind}
                      onClick={() => setModal({ type: "entry", kind })}
                    >
                      <span className="feature-icon">
                        <Icon
                          icon={[Factory, PackagePlus, Layers3, Truck][i]}
                          size={25}
                        />
                      </span>
                      <strong>{t(...kindNames[kind])}</strong>
                      <span>
                        {t(
                          [
                            "Pack the shift’s finished yarn",
                            "Bring new material into stock",
                            "Keep your machines in flow",
                            "Prepare a customer delivery",
                          ][i],
                          [
                            "شفٹ کا تیار یارن پیک کریں",
                            "نیا یارن اسٹاک میں لائیں",
                            "مشین کو یارن جاری کریں",
                            "کسٹمر کی ترسیل تیار کریں",
                          ][i],
                        )}
                      </span>
                      <ArrowUpRight size={18} />
                    </button>
                  ),
                )}
              </div>
            )}
            {modal.type === "date" && (
              <>
                <div className="date-card">
                  <CalendarDays size={36} />
                  <h3>{dateLabel}</h3>
                  <p>Asia/Karachi · UTC +05:00</p>
                </div>
                <div className="info-banner">
                  {t(
                    "The overview shows today’s practice data. Change the business date inside an entry form when needed.",
                    "جائزے میں آج کا مشق ڈیٹا ہے۔ ضرورت ہو تو اندراج میں تاریخ بدلیں۔",
                  )}
                </div>
                <div className="modal-actions">
                  <Button onClick={() => setModal(null)}>
                    {t("Got it", "سمجھ گیا")}
                  </Button>
                </div>
              </>
            )}
            {modal.type === "notifications" && (
              <div className="notification-list">
                <button
                  onClick={() => {
                    setModal({ type: "lot", lot: "1216" });
                  }}
                >
                  <span className="row-icon amber-bg">
                    <AlertTriangle size={20} />
                  </span>
                  <div>
                    <strong>
                      {t("Lot 1216 is on QC hold", "لاٹ 1216 کی جانچ باقی ہے")}
                    </strong>
                    <p>
                      {t(
                        "Dispatch is blocked until quality approval.",
                        "کوالٹی منظوری تک ترسیل بند ہے۔",
                      )}
                    </p>
                    <small>
                      {t("Sample alert · Quality", "نمونہ اطلاع · کوالٹی")}
                    </small>
                  </div>
                  <ChevronRight size={18} />
                </button>
                <button
                  onClick={() => {
                    setModal(null);
                    navigate("orders");
                  }}
                >
                  <span className="row-icon lavender">
                    <ShoppingBag size={20} />
                  </span>
                  <div>
                    <strong>
                      {t(
                        "Your next orders are getting closer",
                        "اگلے آرڈرز کی تاریخ قریب ہے",
                      )}
                    </strong>
                    <p>
                      {t(
                        "Review material availability for this week’s orders.",
                        "اس ہفتے کے آرڈرز کے لیے یارن کی دستیابی دیکھیں۔",
                      )}
                    </p>
                    <small>
                      {t("Sample alert · Orders", "نمونہ اطلاع · آرڈرز")}
                    </small>
                  </div>
                  <ChevronRight size={18} />
                </button>
              </div>
            )}
            {modal.type === "detail" && currentEntry && (
              <>
                <div className="detail-hero">
                  <span className="feature-icon">
                    <Factory size={27} />
                  </span>
                  <div>
                    <span className="eyebrow">
                      {t(...kindNames[currentEntry.kind])}
                    </span>
                    <h3>
                      <bdi>{currentEntry.serial}</bdi>
                    </h3>
                    <Status
                      tone={
                        entries.some((e) => e.reverses === currentEntry.id)
                          ? "gray"
                          : "green"
                      }
                    >
                      {entries.some((e) => e.reverses === currentEntry.id)
                        ? t("Reversed", "واپس کیا گیا")
                        : t("Saved locally", "مقامی محفوظ")}
                    </Status>
                  </div>
                </div>
                <dl className="detail-grid">
                  {[
                    [
                      t("Yarn", "یارن"),
                      lots.find((l) => l.id === currentEntry.lot)?.spec,
                    ],
                    [t("Lot", "لاٹ"), currentEntry.lot],
                    [
                      t("Weight", "وزن"),
                      `${fmt(currentEntry.grams / 1000, 3)} kg`,
                    ],
                    [
                      t("Cartons / cones", "کارٹن / کونز"),
                      `${currentEntry.cartons} / ${currentEntry.cones}`,
                    ],
                    [
                      t("Machine / customer", "مشین / کسٹمر"),
                      currentEntry.machine,
                    ],
                    [
                      t("Date / shift", "تاریخ / شفٹ"),
                      `${currentEntry.date} · ${currentEntry.shift}`,
                    ],
                    [t("Recorded by", "درج کرنے والا"), currentEntry.by],
                    [t("Notes", "نوٹس"), currentEntry.notes || "—"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>
                        <bdi>{value}</bdi>
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="audit-note">
                  <ShieldCheck size={19} />
                  {t(
                    "Original entry retained. Corrections create a reversing record.",
                    "اصل اندراج محفوظ ہے۔ تصحیح کے لیے واپسی کا اندراج بنتا ہے۔",
                  )}
                </div>
                <div className="modal-actions">
                  <Button
                    icon={Download}
                    onClick={() => exportEntries([currentEntry])}
                  >
                    {t("Export entry", "اندراج برآمد")}
                  </Button>
                  {currentEntry.kind !== "reversal" &&
                    !entries.some((e) => e.reverses === currentEntry.id) && (
                      <Button
                        onClick={() =>
                          setModal({ type: "void", entry: currentEntry })
                        }
                        icon={RefreshCw}
                      >
                        {t("Reverse entry", "اندراج واپس کریں")}
                      </Button>
                    )}
                </div>
              </>
            )}
            {modal.type === "void" && currentEntry && (
              <ReasonForm
                text={t(
                  "This creates a reversing entry. The original stays in history. Stock must still be available.",
                  "واپسی کا اندراج بنایا جائے گا۔ اصل تاریخ برقرار رہے گی۔ اسٹاک دستیاب ہونا ضروری ہے۔",
                )}
                button={t("Confirm reversal", "واپسی کی تصدیق")}
                onSubmit={(reason) => undo(currentEntry, reason)}
              />
            )}
            {modal.type === "reopen" && (
              <ReasonForm
                text={t(
                  "Reopening allows new entries for today. Give a reason for the practice audit trail.",
                  "دوبارہ کھولنے سے آج نئے اندراجات ممکن ہوں گے۔ وجہ درج کریں۔",
                )}
                button={t("Reopen day", "دن دوبارہ کھولیں")}
                onSubmit={(reason) => {
                  localStorage.setItem("yf-reopen-reason", reason);
                  setClosed("");
                  setModal(null);
                  notify(
                    t("Practice day reopened.", "مشق کا دن دوبارہ کھل گیا۔"),
                  );
                }}
              />
            )}
            {modal.type === "close-confirm" && (
              <>
                <div className="warning-banner">
                  <LockKeyhole size={24} />
                  {t(
                    "New entries for today will be blocked. The practice day can be reopened with a reason.",
                    "آج کے نئے اندراجات بند ہو جائیں گے۔ وجہ کے ساتھ دوبارہ کھولا جا سکتا ہے۔",
                  )}
                </div>
                <div className="modal-actions">
                  <Button onClick={() => setModal(null)}>
                    {t("Keep reviewing", "مزید جائزہ")}
                  </Button>
                  <Button
                    variant="primary"
                    icon={Check}
                    onClick={() => {
                      setClosed(today());
                      localStorage.setItem("yf-handover", remarks);
                      setModal(null);
                      notify(
                        t(
                          "Practice day closed. Everything is accounted for.",
                          "مشق کا دن بند۔ حساب مکمل ہے۔",
                        ),
                      );
                    }}
                  >
                    {t("Approve & close", "منظور اور بند کریں")}
                  </Button>
                </div>
              </>
            )}
            {modal.type === "lot" && currentLot && (
              <>
                <div className="lot-detail-header">
                  <span
                    className="material-swatch"
                    style={{ background: currentLot.color }}
                  >
                    <Layers3 size={30} />
                  </span>
                  <div>
                    <h3>{currentLot.spec}</h3>
                    <p>
                      {currentLot.supplier} · {t("Received", "وصولی")}{" "}
                      <bdi>{currentLot.received}</bdi>
                    </p>
                  </div>
                  <Status
                    tone={currentLot.status === "hold" ? "amber" : "green"}
                  >
                    {currentLot.status === "hold"
                      ? t("QC hold", "جانچ باقی")
                      : t("Active", "فعال")}
                  </Status>
                </div>
                <div className="close-totals">
                  <div>
                    <span>{t("Finished stock", "تیار اسٹاک")}</span>
                    <strong>
                      <bdi>
                        {fmt(
                          balance(entries, currentLot.id, "finished").grams /
                            1000,
                        )}{" "}
                        kg
                      </bdi>
                    </strong>
                  </div>
                  <div>
                    <span>{t("Raw stock", "خام اسٹاک")}</span>
                    <strong>
                      <bdi>
                        {fmt(
                          balance(entries, currentLot.id, "raw").grams / 1000,
                        )}{" "}
                        kg
                      </bdi>
                    </strong>
                  </div>
                  <div>
                    <span>{t("Finished cartons", "تیار کارٹن")}</span>
                    <strong>
                      {balance(entries, currentLot.id, "finished").cartons}
                    </strong>
                  </div>
                </div>
                {currentLot.status === "hold" && (
                  <div className="warning-banner">
                    <AlertTriangle size={20} />
                    {t(
                      "QC hold · Sample hold placed by Ahmed Khan. Dispatch is blocked. Live hold changes require the factory backend.",
                      "کوالٹی جانچ · احمد خان کا نمونہ ہولڈ۔ ترسیل بند ہے۔ اصل تبدیلی کے لیے سرور ضروری ہے۔",
                    )}
                  </div>
                )}
                <h3 className="timeline-title">
                  {t("The story of this lot", "اس لاٹ کی تاریخ")}
                </h3>
                <div className="timeline">
                  {entries
                    .filter((e) => e.lot === currentLot.id)
                    .slice()
                    .reverse()
                    .map((e) => (
                      <div key={e.id}>
                        <span className="timeline-point" />
                        <div>
                          <strong>
                            {e.opening
                              ? t("Opening stock", "ابتدائی اسٹاک")
                              : t(...kindNames[e.kind])}
                          </strong>
                          <p>
                            <bdi>{fmt(e.grams / 1000, 3)} kg</bdi> · {e.cartons}{" "}
                            {t("cartons", "کارٹن")} · {e.by}
                          </p>
                          <small>
                            <bdi>{e.serial}</bdi> ·{" "}
                            <bdi>
                              {e.date} {e.time}
                            </bdi>
                          </small>
                        </div>
                      </div>
                    ))}
                </div>
              </>
            )}
            {modal.type === "order" && (
              <OrderForm
                onSave={(o) => {
                  setOrders([...orders, o]);
                  setModal(null);
                  notify(
                    t("Practice order saved.", "مشق کا آرڈر محفوظ ہوگیا۔"),
                  );
                }}
              />
            )}
            {modal.type === "order-detail" && currentOrder && (
              <>
                <div className="order-detail">
                  <Status
                    tone={
                      currentOrder.status === "completed" ? "green" : "purple"
                    }
                  >
                    {currentOrder.status === "completed"
                      ? t("Completed", "مکمل")
                      : t("In progress", "جاری")}
                  </Status>
                  <h3>{currentOrder.customer}</h3>
                  <p>
                    <bdi>{currentOrder.id}</bdi> · {currentOrder.fabric}
                  </p>
                  <h2>
                    <bdi>
                      {fmt(
                        (currentOrder.grams - currentOrder.delivered) / 1000,
                      )}{" "}
                      kg
                    </bdi>
                  </h2>
                  <span>{t("remaining to fulfill", "مزید ترسیل باقی")}</span>
                  <div className="progress-track">
                    <i
                      style={{
                        width: `${(currentOrder.delivered / currentOrder.grams) * 100}%`,
                      }}
                    />
                  </div>
                  <p>
                    {currentOrder.spec} · {t("Due", "تاریخ")}{" "}
                    <bdi>{currentOrder.due}</bdi>
                  </p>
                </div>
                <div className="info-banner">
                  {t(
                    "Dispatch entries in this preview are independent from orders. Order linking is part of the server integration.",
                    "اس پیش نظارے میں ترسیل اور آرڈر الگ ہیں۔ آرڈر لنک سرور انٹیگریشن میں ہوگا۔",
                  )}
                </div>
                <div className="modal-actions">
                  <Button
                    onClick={() => {
                      setModal(null);
                      navigate("inventory");
                    }}
                  >
                    {t("Check inventory", "اسٹاک چیک کریں")}
                  </Button>
                  <Button
                    variant="primary"
                    icon={Truck}
                    onClick={() =>
                      setModal({ type: "entry", kind: "dispatch" })
                    }
                  >
                    {t("Prepare dispatch", "ترسیل تیار کریں")}
                  </Button>
                </div>
              </>
            )}
            {modal.type === "report" && (
              <>
                <div className="report-preview">
                  <div className="report-letterhead">
                    <Logo compact />
                    <div>
                      <strong>{factoryName}</strong>
                      <small>
                        {dateLabel} · {t("PRACTICE DATA", "مشق کا ڈیٹا")}
                      </small>
                    </div>
                  </div>
                  <h2>
                    {t(
                      modal.report || "",
                      reportNames.find((r) => r[0] === modal.report)?.[1],
                    )}
                  </h2>
                  <p className="muted">
                    {t("Business date", "کاروباری تاریخ")}: <bdi>{today()}</bdi>{" "}
                    · Asia/Karachi
                  </p>
                  {modal.report === "Stock report" ||
                  modal.report === "Lot ledger" ? (
                    <table>
                      <thead>
                        <tr>
                          <th>{t("Lot", "لاٹ")}</th>
                          <th>{t("Yarn", "یارن")}</th>
                          <th>{t("Stock (kg)", "اسٹاک کلو")}</th>
                          <th>{t("Cartons", "کارٹن")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lots.map((l) => (
                          <tr key={l.id}>
                            <td>{l.id}</td>
                            <td>{l.spec}</td>
                            <td>
                              {fmt(
                                balance(entries, l.id, "finished").grams / 1000,
                                3,
                              )}
                            </td>
                            <td>
                              {balance(entries, l.id, "finished").cartons}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : modal.report === "Order status" ? (
                    <table>
                      <thead>
                        <tr>
                          <th>{t("Customer", "کسٹمر")}</th>
                          <th>{t("Ordered (kg)", "آرڈر کلو")}</th>
                          <th>{t("Remaining (kg)", "باقی کلو")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((o) => (
                          <tr key={o.id}>
                            <td>{o.customer}</td>
                            <td>{o.grams / 1000}</td>
                            <td>{(o.grams - o.delivered) / 1000}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <>
                      <div className="close-totals">
                        <div>
                          <span>{t("Production", "پیداوار")}</span>
                          <strong>{fmt(produced / 1000)} kg</strong>
                        </div>
                        <div>
                          <span>{t("Dispatch", "ترسیل")}</span>
                          <strong>{fmt(dispatched / 1000)} kg</strong>
                        </div>
                        <div>
                          <span>{t("Closing stock", "اختتامی اسٹاک")}</span>
                          <strong>{fmt(finished.grams / 1000)} kg</strong>
                        </div>
                      </div>
                      <EntryTable
                        entries={
                          modal.report === "Production register"
                            ? active.filter((e) => e.kind === "production")
                            : visible.slice(0, 8)
                        }
                        compact
                        onDetail={(entry) =>
                          setModal({ type: "detail", entry })
                        }
                      />
                    </>
                  )}
                </div>
                <div className="modal-actions">
                  <Button
                    icon={Download}
                    onClick={() => {
                      if (
                        modal.report === "Stock report" ||
                        modal.report === "Lot ledger"
                      )
                        downloadCsv("yarnflow-stock.csv", [
                          ["Lot", "Spec", "Finished kg", "Cartons"],
                          ...lots.map((l) => [
                            l.id,
                            l.spec,
                            balance(entries, l.id, "finished").grams / 1000,
                            balance(entries, l.id, "finished").cartons,
                          ]),
                        ]);
                      else if (modal.report === "Order status")
                        downloadCsv("yarnflow-orders.csv", [
                          ["Order", "Customer", "Ordered kg", "Remaining kg"],
                          ...orders.map((o) => [
                            o.id,
                            o.customer,
                            o.grams / 1000,
                            (o.grams - o.delivered) / 1000,
                          ]),
                        ]);
                      else
                        exportEntries(
                          modal.report === "Production register"
                            ? active.filter((e) => e.kind === "production")
                            : visible,
                        );
                    }}
                  >
                    {t("Export CSV", "CSV برآمد")}
                  </Button>
                  <Button
                    variant="primary"
                    icon={Printer}
                    onClick={() => window.print()}
                  >
                    {t("Print / save PDF", "پرنٹ / پی ڈی ایف محفوظ")}
                  </Button>
                </div>
              </>
            )}
          </Modal>
        )}
        {toast && (
          <div className="toast glass" role="status">
            <span className="toast-check">
              <Check size={18} />
            </span>
            <span>{toast.text}</span>
            {toast.entry && (
              <button onClick={() => undo(toast.entry!)}>
                {t("Undo", "واپس کریں")}
              </button>
            )}
            <button
              className="icon-button"
              aria-label={t("Dismiss notification", "اطلاع بند کریں")}
              onClick={() => setToast(null)}
            >
              <X size={17} />
            </button>
          </div>
        )}
      </div>
    </LedgerContext.Provider>
  );
}
function ReasonForm({
  text,
  button,
  onSubmit,
}: {
  text: string;
  button: string;
  onSubmit: (reason: string) => void;
}) {
  const t = useT();
  const [reason, setReason] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim()) onSubmit(reason.trim());
      }}
    >
      <p className="reason-text">{text}</p>
      <label>
        {t("Reason", "وجہ")}
        <textarea
          required
          minLength={3}
          maxLength={500}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="modal-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={reason.trim().length < 3}
        >
          {button}
        </Button>
      </div>
    </form>
  );
}
function OrderForm({ onSave }: { onSave: (order: Order) => void }) {
  const t = useT();
  const [customer, setCustomer] = useState("Lahore Knitwear");
  const [spec, setSpec] = useState(lots[0].spec);
  const [fabric, setFabric] = useState("Single Jersey · 160 GSM");
  const [weight, setWeight] = useState("1500");
  const [due, setDue] = useState(today());
  const [error, setError] = useState("");
  return (
    <form
      className="entry-form"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const grams = kgToGrams(weight);
          if (due < today()) throw new Error();
          onSave({
            id: `ORD-26-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
            customer,
            spec,
            fabric,
            grams,
            delivered: 0,
            due,
            status: "in-progress",
          });
        } catch {
          setError(
            t(
              "Check the weight and choose today or a later due date.",
              "وزن چیک کریں اور آج یا بعد کی تاریخ منتخب کریں۔",
            ),
          );
        }
      }}
    >
      <label>
        {t("Customer", "کسٹمر")}
        <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
          {[
            "Lahore Knitwear",
            "Style Textile",
            "Sapphire Finishing",
            "Masood Textile",
          ].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <div className="form-grid">
        <label>
          {t("Fabric & GSM", "کپڑا اور جی ایس ایم")}
          <select value={fabric} onChange={(e) => setFabric(e.target.value)}>
            {[
              "Single Jersey · 160 GSM",
              "Fleece · 280 GSM",
              "Polo PK · 200 GSM",
              "Thermal · 220 GSM",
            ].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Yarn specification", "یارن کی تفصیل")}
          <select value={spec} onChange={(e) => setSpec(e.target.value)}>
            {lots.map((l) => (
              <option key={l.id}>{l.spec}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Required weight (kg)", "مطلوبہ وزن کلو")}
          <input
            required
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>
        <label>
          {t("Required by", "مطلوبہ تاریخ")}
          <input
            required
            type="date"
            value={due}
            min={today()}
            onChange={(e) => setDue(e.target.value)}
          />
        </label>
      </div>
      <div className="info-banner">
        <Boxes size={19} />
        {t(
          "Orders reserve no stock. Check lot availability before dispatch.",
          "آرڈر اسٹاک محفوظ نہیں کرتا۔ ترسیل سے پہلے لاٹ کی دستیابی چیک کریں۔",
        )}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <Button type="submit" variant="primary" icon={Check}>
          {t("Save practice order", "مشق کا آرڈر محفوظ کریں")}
        </Button>
      </div>
    </form>
  );
}
function ImportPage({ onNotify }: { onNotify: (text: string) => void }) {
  const t = useT();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  function parse(text: string) {
    const parsed: string[][] = [];
    let row: string[] = [];
    let value = "",
      quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') {
          value += '"';
          i++;
        } else quoted = !quoted;
      } else if (c === "," && !quoted) {
        row.push(value);
        value = "";
      } else if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(value);
        if (row.some((v) => v.trim())) parsed.push(row);
        row = [];
        value = "";
      } else value += c;
    }
    row.push(value);
    if (row.some((v) => v.trim())) parsed.push(row);
    if (quoted) throw new Error();
    return parsed;
  }
  return (
    <>
      <div className="info-banner">
        <ShieldCheck size={20} />
        {t(
          "Preview and validate a CSV file here. Factory imports require the server and do not change stock in this preview.",
          "یہاں CSV فائل کا جائزہ لیں۔ اصل درآمد کے لیے سرور ضروری ہے، یہاں اسٹاک تبدیل نہیں ہوگا۔",
        )}
      </div>
      <section className="panel glass import-panel">
        <div className="step-indicator">
          <span className="current">1</span>
          <b>{t("Choose a file", "فائل چنیں")}</b>
          <div />
          <span className={rows.length ? "current" : ""}>2</span>
          <b>{t("Review rows", "سطروں کا جائزہ")}</b>
          <div />
          <span className={accepted ? "current" : ""}>3</span>
          <b>{t("Save preview", "پیش نظارہ محفوظ")}</b>
        </div>
        <label className="upload-zone">
          <Upload size={36} />
          <strong>
            {fileName ||
              t("Bring your register into view", "اپنا رجسٹر یہاں لائیں")}
          </strong>
          <span>
            {t(
              "Choose a CSV file · maximum 2 MB",
              "CSV فائل منتخب کریں · زیادہ سے زیادہ ۲ ایم بی",
            )}
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              setAccepted(false);
              setError("");
              const file = e.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              if (file.size > 2 * 1024 * 1024) {
                setError(
                  t(
                    "Choose a file smaller than 2 MB.",
                    "۲ ایم بی سے چھوٹی فائل منتخب کریں۔",
                  ),
                );
                return;
              }
              try {
                const data = parse((await file.text()).replace(/^\uFEFF/, ""));
                if (
                  data.length < 2 ||
                  data[0].join(",").toLowerCase() !==
                    "lot,spec,cartons,weight_kg"
                )
                  throw new Error();
                setRows(data);
              } catch {
                setRows([]);
                setError(
                  t(
                    "Use the template columns: lot, spec, cartons, weight_kg. Check that each quoted cell is closed.",
                    "ٹیمپلیٹ کے کالم استعمال کریں: lot, spec, cartons, weight_kg۔",
                  ),
                );
              }
            }}
          />
        </label>
        <button
          className="text-button"
          onClick={() =>
            downloadCsv("yarnflow-import-template.csv", [
              ["lot", "spec", "cartons", "weight_kg"],
              ["1221", "30/1 CVC 60/40", 12, 258.66],
            ])
          }
        >
          <Download size={16} />
          {t("Download CSV template", "CSV ٹیمپلیٹ ڈاؤن لوڈ")}
        </button>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {rows.length > 0 && (
          <>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label={t("Scrollable table", "اسکرول جدول")}
            >
              <table>
                <thead>
                  <tr>
                    {rows[0].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                    <th>{t("Check", "جانچ")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(1, 101).map((row, i) => {
                    const valid =
                      row.length === 4 &&
                      lots.some((l) => l.id === row[0] && l.spec === row[1]) &&
                      Number.isInteger(Number(row[2])) &&
                      Number(row[2]) > 0 &&
                      /^\d+(\.\d{1,3})?$/.test(row[3] || "") &&
                      Number(row[3]) > 0;
                    return (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j}>{cell}</td>
                        ))}
                        <td>
                          <Status tone={valid ? "green" : "amber"}>
                            {valid
                              ? t("Valid preview", "درست پیش نظارہ")
                              : t(
                                  "Check lot or quantity",
                                  "لاٹ یا مقدار چیک کریں",
                                )}
                          </Status>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <span className="muted">
                {rows.length - 1}{" "}
                {t(
                  "rows found · first 100 shown",
                  "سطریں ملیں · پہلی ۱۰۰ دکھائی گئیں",
                )}
              </span>
              <Button
                variant="primary"
                disabled={accepted}
                icon={Check}
                onClick={() => {
                  localStorage.setItem(
                    "yf-import-preview",
                    JSON.stringify(rows),
                  );
                  setAccepted(true);
                  onNotify(
                    t(
                      "Import preview saved. No stock movements were posted.",
                      "درآمد کا پیش نظارہ محفوظ ہے۔ اسٹاک تبدیل نہیں ہوا۔",
                    ),
                  );
                }}
              >
                {accepted
                  ? t("Preview saved", "پیش نظارہ محفوظ")
                  : t("Save preview locally", "پیش نظارہ مقامی محفوظ کریں")}
              </Button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
