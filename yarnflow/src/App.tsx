import { copy } from "./ui-copy";
import {
  useState,
  useEffect,
  useRef,
  useId,
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
  ArrowLeftRight,
  RefreshCw,
  Globe2,
  LogOut,
  Menu,
  WifiOff,
  ShieldCheck,
  LockKeyhole,
  Delete,
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
const pendingWrites = new Map<string, unknown>();
const Language = createContext(false);
const LedgerContext = createContext<Entry[]>([]);
function displayDate(value: string, ur = document.documentElement.lang === "ur") {
  const date = new Date(value + "T12:00:00+05:00");
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(ur ? "ur-PK" : "en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Karachi",
  }).format(date);
}
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
  const current = useRef(value);
  current.current = value;
  return [
    value,
    (next) => {
      const updated =
        typeof next === "function"
          ? (next as (v: T) => T)(current.current)
          : next;
      try {
        localStorage.setItem(key, JSON.stringify(updated));
        pendingWrites.delete(key);
      } catch {
        window.dispatchEvent(new Event("yf-storage-error"));
        // Stock changes commit only after persistence succeeds. Keep typed drafts in memory.
        if (key === "yf-entries-v1" || key === "yf-orders-v1")
          throw new Error("storage");
        pendingWrites.set(key, updated);
      }
      current.current = updated;
      setValue(updated);
    },
  ];
}
function Icon({ icon: I, size = 20 }: { icon: LucideIcon; size?: number }) {
  return <I size={size} strokeWidth={1.7} aria-hidden="true" />;
}
function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <img src="/icon.svg" alt="" />
      <span>{copy.yarnflow}</span>
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
      {tone === "amber" || tone === "red" || tone === "danger" ? (
        <AlertTriangle size={18} aria-hidden="true" />
      ) : tone === "green" ? (
        <CircleCheck size={18} aria-hidden="true" />
      ) : (
        <Clock3 size={18} aria-hidden="true" />
      )}
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
      if (e.key === copy.escape) close.current();
      if (e.key === copy.tab) {
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
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label={t(copy.close, copy.urdu)}
            onClick={onClose}
          >
            <X size={21} />
            <span className="control-label">{t(copy.close, copy.urdu)}</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
const navItems: [string, string, string, LucideIcon][] = [
  ["overview", copy.today, copy.urdu2, LayoutDashboard],
  ["production", copy.production, copy.urdu3, Factory],
  ["inventory", copy.stock, copy.urdu4, Boxes],
  ["orders", copy.orders, copy.urdu5, ShoppingBag],
  ["dispatch", copy.dispatch, copy.urdu6, Truck],
  ["register", copy.registers, copy.urdu7, BookOpen],
  ["more", copy.more, copy.urdu8, Menu],
];
const kindNames: Record<Kind, [string, string]> = {
  production: [copy.production, copy.urdu3],
  receipt: [copy.yarnReceipt, copy.urdu9],
  dispatch: [copy.dispatch, copy.urdu6],
  issue: [copy.machineIssue, copy.urdu10],
  waste: [copy.waste, copy.urdu11],
  cops: [copy.copsProduced, copy.urdu12],
  reversal: [copy.reversal, copy.urdu13],
};
function ScrollTable({ children }: { children: ReactNode }) {
  const t = useT();
  const hintId = useId();
  const region = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const element = region.current;
    if (!element) return;
    const update = () => setScrollable(element.scrollWidth > element.clientWidth + 1);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.querySelectorAll("table").forEach((table) => observer.observe(table));
    update();
    return () => observer.disconnect();
  }, []);
  return (
    <div className="register-table-wrap">
      {scrollable && (
        <p className="table-scroll-hint" id={hintId}>
          <ArrowLeftRight size={18} aria-hidden="true" />
          <span>{t(copy.scrollToSeeColumns, copy.scrollToSeeColumnsUr)}</span>
        </p>
      )}
      <div className="table-scroll" ref={region} tabIndex={0} role="region"
        aria-label={t(copy.scrollableTable, copy.urdu14)}
        aria-describedby={scrollable ? hintId : undefined}>
        {children}
      </div>
    </div>
  );
}
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
    <ScrollTable>
      <table>
        <thead>
          <tr>
            <th>{t(copy.entryMaterial, copy.urdu15)}</th>
            <th>{t(copy.machineCustomer, copy.urdu16)}</th>
            <th>{t(copy.quantity, copy.urdu17)}</th>
            {!compact && <th>{t(copy.recordedBy, copy.urdu18)}</th>}
            <th>{t(copy.status, copy.urdu19)}</th>
            <th>
              <span className="sr-only">{t(copy.details, copy.urdu20)}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>
                <button className="table-link" onClick={() => onDetail(e)}>
                  <span
                    className={`row-icon ${e.kind === "dispatch" ? "mint" : "neutral-icon"}`}
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
                    <strong><bdi dir="ltr">{lots.find((l) => l.id === e.lot)?.spec}</bdi></strong>
                    <small>
                      <bdi>{e.serial}</bdi>
                      {copy.urdu21}
                      {t(copy.lot, copy.urdu22)} <bdi>{e.lot}</bdi>
                    </small>
                  </span>
                </button>
              </td>
              <td>
                <span className="cell-main">
                  <bdi>{e.machine}</bdi>
                </span>
                <small>
                  {t(copy.shift, copy.urdu23)} <bdi>{e.shift}</bdi>
                  {copy.urdu21}
                  <bdi>{e.time}</bdi>
                </small>
              </td>
              <td>
                <strong className="number">
                  <bdi>
                    {fmt(e.grams / 1000, 3)}
                    {copy.kg}
                  </bdi>
                </strong>
                <small>
                  <bdi>{e.cartons}</bdi> {t(copy.cartons, copy.urdu24)}
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
                    isReversed(e) ? copy.reversed : copy.savedLocally,
                    isReversed(e) ? copy.urdu25 : copy.urdu26,
                  )}
                </Status>
              </td>
              <td>
                <button
                  className="icon-button"
                  aria-label={t(copy.viewEntry, copy.urdu27)}
                  onClick={() => onDetail(e)}
                >
                  <ChevronRight size={17} />
                  <span className="control-label">
                    {t(copy.viewEntry, copy.urdu27)}
                  </span>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  ) : (
    <Empty
      title={t(copy.noEntriesYet, copy.urdu28)}
      detail={t(copy.yourSavedEntriesWillAppearHere, copy.urdu29)}
    />
  );
}
function ProductionChart({ entries }: { entries: Entry[] }) {
  const t = useT();
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(today() + "T12:00:00+05:00");
    date.setUTCDate(date.getUTCDate() - 6 + i);
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone: copy.asiaKarachi,
    }).format(date);
    return {
      key,
      label: new Intl.DateTimeFormat(
        document.documentElement.lang === "ur" ? "ur-PK" : "en-GB",
        { weekday: "short", timeZone: copy.asiaKarachi },
      ).format(date),
      value: entries
        .filter((e) => e.date === key && e.kind === "production")
        .reduce((sum, e) => sum + e.grams / 1000, 0),
    };
  });
  const max = Math.max(
    4000,
    Math.ceil(Math.max(...days.map((d) => d.value)) / 1000) * 1000,
  );
  return (
    <div className="weekly-chart" dir="ltr">
      <p className="chart-target">
        {t(copy.dailyTarget, copy.urdu30)}
        {copy.label3000Kg}
      </p>
      <div className="bar-plot">
        <div className="bar-axis">
          {[max, max * 0.75, max * 0.5, max * 0.25, 0].map((n) => (
            <span key={n}>{fmt(n, 0)}</span>
          ))}
        </div>
        <div className="bar-columns">
          <div
            className="target-rule"
            style={{ bottom: `${(3000 / max) * 100}%` }}
          >
            <span>{t(copy.target, copy.urdu34)}</span>
          </div>
          {days.map((d) => (
            <div className="bar-column" key={d.key}>
              {d.value > 0 && (
                <span className="bar-quantity">{fmt(d.value, 0)}</span>
              )}
              <div
                className={`production-bar ${d.key === today() ? "is-today" : ""}`}
                style={{ height: `${(d.value / max) * 100}%` }}
              />
              <span className="bar-day">{d.label}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="chart-note">
        {t(copy.chartRecordedDays, copy.chartRecordedDaysUr)}
      </p>
      <details className="chart-table">
        <summary>{t(copy.showDailyFigures, copy.urdu32)}</summary>
        <table>
          <thead>
            <tr>
              <th>{t(copy.date, copy.urdu33)}</th>
              <th>{copy.kg}</th>
              <th>{t(copy.target, copy.urdu34)}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.key}>
                <td>{displayDate(d.key)}</td>
                <td>
                  {d.value > 0
                    ? fmt(d.value, 0)
                    : t(copy.noRecordedProduction, copy.noRecordedProductionUr)}
                </td>
                <td>{copy.label3000Kg2}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
function Choices({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: {
    value: string;
    label: ReactNode;
  }[];
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="choice-field">
      <legend>{label}</legend>
      <div className="choice-grid">
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            aria-pressed={value === option.value}
            className={value === option.value ? "selected" : ""}
            onClick={() => onChange(option.value)}
          >
            {value === option.value && <Check size={20} />}
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
function EntryForm({
  kind,
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
  const storageKey = `yf-draft-v2-${user}-${kind}`;
  const machines =
    kind === "dispatch"
      ? [copy.lahoreKnitwear, copy.styleTextile, copy.sapphireFinishing]
      : kind === "receipt"
        ? [copy.crescentTextiles, copy.nishatMills, copy.ibrahimFibres]
        : ["1A", "1B", "2A", "2B", "3A", "3B"];
  const [d, setDraft] = useStored(storageKey, {
    date: today(),
    shift: currentShift(),
    machine: localStorage.getItem(`yf-last-machine-${kind}`) || machines[0],
    lot: lots[0].id,
    cartons: "",
    cones: "",
    weight: "",
    notes: "",
    id: crypto.randomUUID(),
  });
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof d, value: string) => {
    setDraft({ ...d, [key]: value });
    setError("");
  };
  const lot = lots.find((l) => l.id === d.lot)!;
  const stockStage: Stage =
    kind === "waste" ? "wip" : kind === "dispatch" ? "finished" : "raw";
  const available = balance(entries, d.lot, stockStage);
  const removesStock = ["dispatch", "issue", "waste"].includes(kind);
  const weightError =
    d.weight && !/^\d+(\.\d{1,3})?$/.test(d.weight)
      ? t(copy.enterAWeightSuchAs520Or, copy.label520520250)
      : d.weight && Number(d.weight) <= 0
        ? t(copy.weightMustBeGreaterThanZero, copy.urdu35)
        : removesStock && Number(d.weight) * 1000 > available.grams
          ? t(
              copy.only0KgIsAvailableReduceThe(fmt(available.grams / 1000, 3)),
              copy.label0(fmt(available.grams / 1000, 3)),
            )
          : "";
  const countError = (value: string, limit: number) =>
    value && (!/^\d+$/.test(value) || (removesStock && Number(value) > limit))
      ? t(copy.enterAWholeNumberWithinTheAvailable, copy.urdu36)
      : "";
  const cartonsError = countError(d.cartons, available.cartons);
  const conesError = countError(d.cones, available.cones);
  const dateError =
    !d.date || d.date > today()
      ? t(copy.chooseTodayOrAnEarlierDate, copy.urdu37)
      : closed && d.date === today()
        ? t(copy.todayIsClosedAskTheManagerTo, copy.urdu38)
        : "";
  const holdError =
    kind === "dispatch" && lot.status === "hold"
      ? t(copy.thisLotIsOnQcHoldChoose, copy.urdu39)
      : "";
  const canContinue =
    step === 1
      ? !dateError && !holdError
      : !!d.weight &&
        !weightError &&
        !!d.cartons &&
        !cartonsError &&
        !!d.cones &&
        !conesError;
  const locationLabel = t(
    kind === "dispatch"
      ? copy.customer
      : kind === "receipt"
        ? copy.supplier
        : copy.machine,
    kind === "dispatch"
      ? copy.urdu40
      : kind === "receipt"
        ? copy.urdu41
        : copy.urdu42,
  );
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (step < 3) {
      if (canContinue) setStep(step + 1);
      return;
    }
    try {
      setSaving(true);
      const entry = createEntry(
        {
          kind,
          date: d.date,
          shift: d.shift,
          machine: d.machine,
          lot: d.lot,
          grams: kgToGrams(d.weight),
          cartons: Number(d.cartons),
          cones: Number(d.cones),
          notes: d.notes,
        },
        d.id,
      );
      appendEntry(entries, entry);
      localStorage.setItem(`yf-last-machine-${kind}`, d.machine);
      onSave(entry);
      localStorage.removeItem(storageKey);
    } catch {
      setError(t(copy.couldNotSaveThisEntryCheckThe, copy.urdu43));
      setSaving(false);
    }
  }
  return (
    <form onSubmit={submit} className="entry-form register-form">
      <div ref={heading} tabIndex={-1} className="form-step-heading">
        <strong>{t(copy.step0Of3(step), copy.label03(step))}</strong>
        <span>
          {step === 1
            ? t(copy.dateMachineAndLot, copy.urdu44)
            : step === 2
              ? t(copy.quantities, copy.urdu17)
              : t(copy.reviewEntry, copy.urdu45)}
        </span>
      </div>
      <p className="draft-status">
        <CheckCheck size={18} />
        {t(copy.draftSavedOnThisDevice, copy.urdu46)}
      </p>
      {step === 1 && (
        <>
          <label>
            {t(copy.date, copy.urdu33)}
            <input
              type="date"
              required
              max={today()}
              value={d.date}
              onChange={(e) => set("date", e.target.value)}
              aria-invalid={!!dateError}
              aria-describedby={dateError ? "date-error" : undefined}
            />
          </label>
          {dateError && (
            <p id="date-error" className="field-error" role="alert">
              {dateError}
            </p>
          )}
          <Choices
            label={t(copy.shift, copy.urdu23)}
            value={d.shift}
            options={[
              { value: "A", label: copy.shiftA },
              { value: "B", label: copy.shiftB },
              { value: "C", label: copy.shiftC },
            ]}
            onChange={(v) => set("shift", v)}
          />
          <Choices
            label={locationLabel}
            value={d.machine}
            options={machines.map((m) => ({ value: m, label: m }))}
            onChange={(v) => set("machine", v)}
          />
          <Choices
            label={t(copy.yarnAndLot, copy.urdu47)}
            value={d.lot}
            options={lots.map((l) => ({
              value: l.id,
              label: <>{t(copy.lot, copy.urdu22)} <bdi dir="ltr">{l.id}</bdi> · <bdi dir="ltr">{l.spec}</bdi>{l.status === "hold" ? ` · ${t(copy.qcHold, copy.urdu48)}` : ""}</>,
            }))}
            onChange={(v) => set("lot", v)}
          />
          {holdError && (
            <p className="field-error" role="alert">
              {holdError}
            </p>
          )}
        </>
      )}
      {step === 2 && (
        <>
          <p className="register-context">
            {locationLabel}
            {copy.urdu49}
            <strong>{d.machine}</strong>
            {copy.urdu21}
            {t(copy.lot, copy.urdu22)} <bdi>{d.lot}</bdi>
            {copy.urdu21}
            {t(copy.shift, copy.urdu23)} <bdi>{d.shift}</bdi>
          </p>
          {removesStock && (
            <p className="stock-available">
              {t(copy.available, copy.urdu50)}
              {copy.urdu49}
              {fmt(available.grams / 1000, 3)}
              {copy.kg2}
              {available.cartons} {t(copy.cartons, copy.urdu24)}
              {copy.urdu21}
              {available.cones} {t(copy.cones, copy.urdu51)}
            </p>
          )}
          <div className="form-grid">
            <label>
              {t(copy.cartons2, copy.urdu24)}
              <input
                required
                inputMode="numeric"
                value={d.cartons}
                aria-invalid={!!cartonsError}
                aria-describedby={cartonsError ? "cartons-error" : undefined}
                onChange={(e) => {
                  setDraft({
                    ...d,
                    cartons: e.target.value,
                    cones: /^\d*$/.test(e.target.value)
                      ? String(Number(e.target.value) * 24)
                      : d.cones,
                  });
                  setError("");
                }}
              />
              {cartonsError && (
                <span id="cartons-error" className="field-error">
                  {cartonsError}
                </span>
              )}
            </label>
            <label>
              {t(copy.cones2, copy.urdu51)}
              <input
                required
                inputMode="numeric"
                value={d.cones}
                onChange={(e) => set("cones", e.target.value)}
                aria-invalid={!!conesError}
                aria-describedby={conesError ? "cones-error" : undefined}
              />
              {conesError && (
                <span id="cones-error" className="field-error">
                  {conesError}
                </span>
              )}
            </label>
          </div>
          <label>
            {t(copy.netWeight, copy.urdu52)}
            <div className="quantity-input">
              <input
                autoFocus
                required
                inputMode="decimal"
                value={d.weight}
                onChange={(e) => set("weight", e.target.value)}
                aria-label={t(copy.netWeightInKilograms, copy.urdu53)}
                aria-invalid={!!weightError}
                aria-describedby="weight-help"
              />
              <span>{copy.kg}</span>
            </div>
            <span
              id="weight-help"
              className={weightError ? "field-error" : "field-help"}
            >
              {weightError || t(copy.useTheWeightOnTheScaleUp, copy.urdu54)}
            </span>
          </label>
          <label>
            {t(copy.notesOptional, copy.urdu55)}
            <textarea
              rows={2}
              maxLength={500}
              value={d.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </label>
        </>
      )}
      {step === 3 && (
        <section className="entry-review">
          <h3>{t(copy.checkBeforeSaving, copy.urdu56)}</h3>
          <p className="register-line">
            {t(
              copy.registerSummary(
                displayDate(d.date),
                d.shift,
                locationLabel,
                d.machine,
                d.lot,
                d.cartons,
                d.cones,
                fmt(Number(d.weight), 3),
              ),
              copy.registerSummaryUr(
                displayDate(d.date, true),
                d.shift,
                locationLabel,
                d.machine,
                d.lot,
                d.cartons,
                d.cones,
                fmt(Number(d.weight), 3),
              ),
            )}
          </p>
          <dl>
            <div>
              <dt>{t(copy.yarn, copy.urdu57)}</dt>
              <dd><bdi dir="ltr">{lot.spec}</bdi></dd>
            </div>
            <div>
              <dt>{t(copy.recordedBy, copy.urdu18)}</dt>
              <dd>{user}</dd>
            </div>
            {d.notes && (
              <div>
                <dt>{t(copy.notes, copy.urdu58)}</dt>
                <dd>{d.notes}</dd>
              </div>
            )}
          </dl>
          <p>
            {t(copy.practiceEntryThisChangesPracticeStockOnly, copy.urdu59)}
          </p>
        </section>
      )}
      {error && (
        <p className="error-banner" role="alert">
          <AlertTriangle size={20} />
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button onClick={() => (step === 1 ? onClose() : setStep(step - 1))}>
          {step === 1
            ? t(copy.saveDraftAndClose, copy.urdu60)
            : t(copy.back, copy.urdu61)}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={saving || (step < 3 && !canContinue)}
        >
          {saving
            ? t(copy.saving, copy.urdu62)
            : step === 3
              ? t(copy.saveEntry, copy.urdu63)
              : t(copy.continue, copy.urdu64)}
        </Button>
      </div>
    </form>
  );
}
function currentShift() {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: copy.asiaKarachi,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
  );
  return hour >= 7 && hour < 15 ? "A" : hour >= 15 && hour < 23 ? "B" : "C";
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
  const [profile, setProfile] = useState<string>(copy.ahmedKhan);
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
      <section className="login-side">
        <button className="language-button" onClick={onLanguage}>
          <Globe2 size={17} />
          {ur ? copy.english : copy.urdu65}
          <ChevronDown size={14} />
        </button>
        <form className="login-card" onSubmit={enter}>
          <Logo />
          <h1>{t(copy.signIn, copy.urdu66)}</h1>
          <p>{t(copy.pickYourProfileAndEnterYourPin, copy.urdu67)}</p>
          <Choices
            label={t(copy.yourName, copy.urdu68)}
            value={profile}
            options={[copy.ahmedKhan, copy.asifAli, copy.muhammadBilal].map(
              (name) => ({ value: name, label: name }),
            )}
            onChange={setProfile}
          />
          <div className="profile-preview">
            <span className="avatar">
              {profile
                .split(" ")
                .map((s) => s[0])
                .join("")}
            </span>
            <div>
              <strong>{profile}</strong>
              <small>{t(copy.practiceProfile, copy.urdu69)}</small>
            </div>
            <Status tone="neutral">{t(copy.demo, copy.urdu70)}</Status>
          </div>
          <label>
            {t(copy.your4DigitPin, copy.urdu71)}
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
              aria-label={t(copy.your4DigitPin, copy.urdu72)}
              required
              placeholder={copy.urdu73}
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
                    ? t(copy.deleteDigit, copy.urdu74)
                    : n === "clear"
                      ? t(copy.clearPin, copy.urdu75)
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
                  <span>{t(copy.deleteDigit, copy.urdu74)}</span>
                ) : n === "clear" ? (
                  t(copy.clear, copy.urdu76)
                ) : (
                  n
                )}
              </button>
            ))}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {t(copy.use1234ToEnterThisPracticeWorkspace, copy.label1234)}
            </div>
          )}
          <Button type="submit" variant="primary full" icon={ArrowRight}>
            {t(copy.enterWorkspace, copy.urdu77)}
          </Button>
          <div className="demo-pin">
            <LockKeyhole size={14} />
            {t(copy.practiceWorkspaceDemoPin1234, copy.label12342)}
          </div>
          <button
            type="button"
            className="text-button forgot"
            onClick={() => setError(true)}
          >
            {t(copy.forgotYourPin, copy.urdu78)}{" "}
            <strong>{t(copy.askYourSupervisor, copy.urdu79)}</strong>
          </button>
        </form>
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
  const [user, setUser] = useStored<string>("yf-user", copy.ahmedKhan);
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
  const [factoryName, setFactoryName] = useStored<string>(
    "yf-factory",
    copy.crescentYarnMills,
  );
  const [closed, setClosed] = useStored("yf-closed-v1", "");
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState(copy.thisWeek);
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
  const [toast, setToast] = useState<{
    text: string;
    entry?: Entry;
  } | null>(null);
  const [storageError, setStorageError] = useState(false);
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
        navigate("search");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!toast || modal) return;
    const id = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(id);
  }, [toast, modal]);
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
    .filter((e) => e.kind === "dispatch" && e.date === today())
    .reduce((s, e) => s + e.grams, 0);
  const finished = total(entries, "finished");
  const raw = total(entries, "raw");
  const pending = orders.reduce((s, o) => s + o.grams - o.delivered, 0);
  const savedLocal = entries.filter((e) => e.createdAt > 0).length;
  function save(entry: Entry) {
    try {
      const next = appendEntry(entries, { ...entry, by: user });
      setEntries(next);
      setModal({ type: "saved", entry });
      notify(
        t(
          copy.saved0Kg1Shift2(
            fmt(entry.grams / 1000, 3),
            entry.machine,
            entry.shift,
          ),
          copy.label012(fmt(entry.grams / 1000, 3), entry.machine, entry.shift),
        ),
        entry,
      );
    } catch {
      throw new Error("stock");
    }
  }
  function undo(entry: Entry, reason: string = copy.undoneByCreator) {
    try {
      setEntries(reverseEntry(entries, entry, reason));
      setModal(null);
      notify(t(copy.entryReversedTheOriginalStaysInYour, copy.urdu80));
    } catch {
      notify(t(copy.thisEntryCannotBeReversedBecauseIts, copy.urdu81));
    }
  }
  function exportEntries(list = visible) {
    downloadCsv("yarnflow-entries.csv", [
      [
        t(copy.serial, copy.urdu82),
        t(copy.date, copy.urdu33),
        t(copy.type, copy.urdu83),
        t(copy.lot, copy.urdu22),
        t(copy.machine, copy.urdu42),
        t(copy.cartons2, copy.urdu24),
        t(copy.cones2, copy.urdu51),
        t(copy.weightKg, copy.urdu84),
        t(copy.recordedBy, copy.urdu18),
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
    notify(t(copy.yourCsvExportIsReady, copy.csv));
  }
  const dateLabel = new Intl.DateTimeFormat(ur ? "ur-PK" : "en-GB", {
    timeZone: copy.asiaKarachi,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date());
  const titles: Record<string, [string, string, string, string]> = {
    scanner: [copy.materialScanner, copy.urdu85, "", ""],
    overview: [copy.today, copy.urdu2, "", ""],
    production: [copy.todaySProduction, copy.urdu86, "", ""],
    inventory: [copy.stock, copy.urdu4, "", ""],
    orders: [copy.customerOrders, copy.urdu87, "", ""],
    dispatch: [copy.dispatch, copy.urdu6, "", ""],
    register: [copy.registers, copy.urdu7, "", ""],
    reports: [copy.reports, copy.urdu88, "", ""],
    sync: [copy.savedEntries, copy.urdu89, "", ""],
    settings: [copy.workspaceSettings, copy.urdu90, "", ""],
    help: [copy.help, copy.urdu91, "", ""],
    search: [copy.searchYourWorkspace, copy.urdu92, "", ""],
    close: [copy.dayClose, copy.urdu93, "", ""],
    masters: [copy.yarnLotsAndSuppliers, copy.urdu94, "", ""],
    users: [copy.peopleDevices, copy.urdu95, "", ""],
    import: [copy.importYourRegisters, copy.urdu96, "", ""],
    home: [copy.recordStockMovement, copy.urdu97, "", ""],
    components: [copy.componentGallery, copy.urdu98, "", ""],
  };
  const title =
    route === "more"
      ? [copy.more, copy.urdu8, "", ""]
      : titles[route] || titles.overview;
  useEffect(() => {
    const close = () => setModal(null);
    window.addEventListener("yf-close-modal", close);
    return () => window.removeEventListener("yf-close-modal", close);
  }, []);
  useEffect(() => {
    const failed = () => setStorageError(true);
    window.addEventListener("yf-storage-error", failed);
    return () => window.removeEventListener("yf-storage-error", failed);
  }, []);
  function retryStorage() {
    try {
      const probe = "yf-storage-check";
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
      for (const [key, value] of pendingWrites)
        localStorage.setItem(key, JSON.stringify(value));
      pendingWrites.clear();
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }
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
          {t(copy.openInventory, copy.urdu99)}
        </Button>
      );
    if (route === "overview")
      return (
        <Button
          variant="primary"
          icon={Plus}
          onClick={() => setModal({ type: "entry", kind: "production" })}
        >
          {t(copy.recordProduction, copy.urdu100)}
        </Button>
      );
    if (route === "production")
      return (
        <Button
          variant="primary"
          icon={Plus}
          onClick={() => setModal({ type: "entry", kind: "production" })}
        >
          {t(copy.recordProduction, copy.urdu100)}
        </Button>
      );
    if (route === "dispatch")
      return (
        <Button
          variant="primary"
          icon={Plus}
          onClick={() => setModal({ type: "entry", kind: "dispatch" })}
        >
          {t(copy.recordDispatch, copy.urdu101)}
        </Button>
      );
    if (route === "orders")
      return (
        <Button
          variant="primary"
          icon={Plus}
          onClick={() => setModal({ type: "order" })}
        >
          {t(copy.recordOrder, copy.urdu102)}
        </Button>
      );
    if (route === "inventory")
      return (
        <Button
          variant="primary"
          icon={PackagePlus}
          onClick={() => setModal({ type: "entry", kind: "receipt" })}
        >
          {t(copy.receiveYarn, copy.urdu103)}
        </Button>
      );
    return null;
  }
  function friendlyDue(value: string) {
    const date = new Date(value + "T12:00:00+05:00");
    const days = Math.round(
      (date.getTime() - new Date(today() + "T12:00:00+05:00").getTime()) /
        86400000,
    );
    const label = new Intl.DateTimeFormat(ur ? "ur-PK" : "en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "Asia/Karachi",
    }).format(date);
    const relative =
      days === 0
        ? t(copy.dueToday, copy.dueTodayUr)
        : days === 1
          ? t(copy.dueTomorrow, copy.dueTomorrowUr)
          : days > 0
            ? t(copy.dueInDays(days), copy.dueInDaysUr(days))
            : t(copy.daysOverdue(-days), copy.daysOverdueUr(-days));
    return `${label} · ${relative}`;
  }
  function overview() {
    const target = 3000;
    const difference = Math.abs(Math.round(produced / 1000) - target);
    const heldLots = lots.filter((l) => l.status === "hold");
    const dueOrders = orders
      .filter((o) => o.status !== "completed")
      .sort((a, b) => a.due.localeCompare(b.due));
    const machines = ["1A", "1B", "2A", "2B", "3A", "3B"]
      .map((machine) => ({
        machine,
        value: dayProduction
          .filter((e) => e.machine === machine)
          .reduce((sum, e) => sum + e.grams / 1000, 0),
      }))
      .sort((a, b) => b.value - a.value);
    const stats = [
      {
        label: t(copy.producedToday, copy.urdu86),
        icon: Factory,
        tone: produced / 1000 >= target ? "success" : "warning",
        value: produced / 1000,
        note:
          produced / 1000 >= target
            ? t(copy.label0KgAboveTarget(difference), copy.label02(difference))
            : t(copy.label0KgBelowTarget(difference), copy.label04(difference)),
      },
      {
        label: t(copy.finishedStock, copy.urdu105),
        icon: Boxes,
        tone: "neutral",
        value: finished.grams / 1000,
        note: t(
          copy.stockCartons(finished.cartons),
          copy.stockCartonsUr(finished.cartons),
        ),
      },
      {
        label: t(copy.dispatchedToday, copy.urdu107),
        icon: Truck,
        tone: "success",
        value: dispatched / 1000,
        note: t(
          copy.label0DispatchesRecorded(
            active.filter((e) => e.kind === "dispatch" && e.date === today())
              .length,
          ),
          copy.label05(
            active.filter((e) => e.kind === "dispatch" && e.date === today())
              .length,
          ),
        ),
      },
      {
        label: t(copy.ordersRemaining, copy.urdu108),
        icon: ShoppingBag,
        tone: dueOrders.length ? "warning" : "success",
        value: pending / 1000,
        note: t(
          copy.label0OrdersToComplete(dueOrders.length),
          copy.label06(dueOrders.length),
        ),
      },
    ];
    return (
      <>
        <section
          className="attention-section"
          aria-labelledby="attention-title"
        >
          <div className="section-heading">
            <h2 id="attention-title">{t(copy.needsAttention, copy.urdu109)}</h2>
            <span>
              {t(
                copy.label0Items(
                  heldLots.length + Math.min(dueOrders.length, 2),
                ),
                copy.label07(heldLots.length + Math.min(dueOrders.length, 2)),
              )}
            </span>
          </div>
          <div className="action-list">
            {heldLots.map((l) => (
              <div className="action-row warning" key={l.id}>
                <span className="attention-symbol">
                  <AlertTriangle size={24} />
                </span>
                <div>
                  <p>{t(copy.lot0IsOnQcHoldDo(l.id), copy.label08(l.id))}</p>
                  <span><bdi dir="ltr">{l.spec}</bdi></span>
                </div>
                <Button onClick={() => setModal({ type: "lot", lot: l.id })}>
                  {t(copy.reviewLot, copy.urdu110)}
                </Button>
              </div>
            ))}
            {dueOrders.slice(0, 2).map((o) => (
              <div
                className={`action-row ${o.due < today() ? "danger" : "warning"}`}
                key={o.id}
              >
                <span className="attention-symbol">
                  <Clock3 size={24} />
                </span>
                <div>
                  <p>
                    {t(
                      copy.label0Needs1KgBy2(
                        o.customer,
                        fmt((o.grams - o.delivered) / 1000, 0),
                        friendlyDue(o.due),
                      ),
                      copy.label0122(
                        o.customer,
                        friendlyDue(o.due),
                        fmt((o.grams - o.delivered) / 1000, 0),
                      ),
                    )}
                  </p>
                  <span>
                    <bdi>{o.id}</bdi>
                  </span>
                </div>
                <Button
                  onClick={() =>
                    setModal({ type: "order-detail", report: o.id })
                  }
                >
                  {t(copy.viewOrder, copy.urdu111)}
                </Button>
              </div>
            ))}
            {!heldLots.length && !dueOrders.length && (
              <p className="empty-inline">
                <CircleCheck size={24} />
                {t(copy.noLotsOnHoldOrOrdersWaiting, copy.urdu112)}
              </p>
            )}
          </div>
        </section>
        <section className="today-section" aria-labelledby="today-figures">
          <div className="section-heading">
            <h2 id="today-figures">{t(copy.todaySTotals, copy.urdu113)}</h2>
            <span>{t(copy.dailyProductionTarget3000Kg, copy.label3000)}</span>
          </div>
          <div className="daily-stats">
            {stats.map((stat) => (
              <div key={stat.label} className="total-card">
                <div className="total-heading">
                  <p>{stat.label}</p>

                </div>
                <strong>
                  <bdi>{fmt(stat.value, 0)}</bdi>
                  <span>{copy.kg}</span>
                </strong>
                <p className={`stat-note ${stat.tone}`}>
                  {stat.tone === "success" ? (
                    <CircleCheck size={16} />
                  ) : stat.tone === "warning" ? (
                    stat.icon === ShoppingBag ? (
                      <Clock3 size={16} />
                    ) : (
                      <AlertTriangle size={16} aria-hidden="true" />
                    )
                  ) : null}
                  {stat.note}
                </p>
              </div>
            ))}
          </div>
        </section>
        <div className="overview-analysis">
          <section className="machine-section">
            <div className="section-heading">
              <h2>{t(copy.productionByMachine, copy.urdu114)}</h2>
            </div>
            <p className="section-description">
              {t(copy.todayTarget500KgPerMachine, copy.label500)}
            </p>
            <div className="machine-target-key">
              <span />
              {t(copy.target, copy.urdu34)} · 500 kg
            </div>
            <div className="plain-machine-list">
              {machines.map((m) => (
                <div key={m.machine}>
                  <span>
                    {t(copy.machine, copy.urdu42)} <bdi>{m.machine}</bdi>
                  </span>
                  <div className="plain-machine-track">
                    <span
                      style={{
                        width: `${Math.min((m.value / 600) * 100, 100)}%`,
                      }}
                    />
                    <i style={{ insetInlineStart: `${(500 / 600) * 100}%` }} />
                  </div>
                  <strong>
                    <bdi>
                      {fmt(m.value, 0)}
                      {copy.kg}
                    </bdi>
                  </strong>
                  <span
                    className={`machine-gap ${m.value >= 500 ? "success" : "warning"}`}
                  >
                    {m.value >= 500 ? <CircleCheck size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
                    {m.value >= 500
                      ? t(copy.targetMet, copy.urdu115)
                      : t(
                          copy.label0KgBelow(Math.round(500 - m.value)),
                          copy.label09(Math.round(500 - m.value)),
                        )}
                  </span>
                </div>
              ))}
            </div>
            <Button onClick={() => navigate("production")}>
              {t(copy.viewProductionEntries, copy.urdu116)}
            </Button>
          </section>
          <section className="trend-section">
            <div className="section-heading">
              <h2>{t(copy.last7Days, copy.urdu117)}</h2>
            </div>
            <ProductionChart entries={active} />
          </section>
        </div>
        <section className="recent-entries">
          <div className="section-heading">
            <h2>{t(copy.recentEntries, copy.urdu118)}</h2>
            <Button onClick={() => navigate("register")}>
              {t(copy.viewRegisters, copy.urdu119)}
            </Button>
          </div>
          <EntryTable
            compact
            entries={visible.slice(0, 4)}
            onDetail={(entry) => setModal({ type: "detail", entry })}
          />
        </section>
        <div className="day-close-link">
          <Button onClick={() => navigate("close")}>
            {t(copy.reviewAndCloseToday, copy.urdu120)}
          </Button>
        </div>
      </>
    );
  }
  function listPage() {
    const list = visible.filter(
      (e) =>
        (route === "dispatch"
          ? e.kind === "dispatch"
          : e.kind === "production" && e.date === today()) &&
        (filter === "all" || e.shift === filter) &&
        (!query ||
          `${e.machine} ${e.serial} ${e.lot} ${e.by}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    );
    return (
      <>
        {route === "production" && (
          <div className="summary-strip">
            <div>
              <span className="feature-icon">
                <Factory size={22} />
              </span>
              <span>
                {t(copy.producedToday, copy.urdu86)}
                <strong>
                  <bdi>
                    {fmt(produced / 1000, 0)}
                    {copy.kg}
                  </bdi>
                </strong>
              </span>
            </div>
            <div>
              <span>
                {t(copy.cartonsPacked, copy.urdu121)}
                <strong>
                  <bdi>{dayProduction.reduce((s, e) => s + e.cartons, 0)}</bdi>
                </strong>
              </span>
            </div>
            <div>
              <span>
                {t(copy.machinesRunning, copy.urdu122)}
                <strong>
                  {new Set(dayProduction.map((e) => e.machine)).size}
                  <small>{copy.label62}</small>
                </strong>
              </span>
            </div>
            <div>
              <span>
                {t(copy.currentShift, copy.urdu123)}
                <strong>
                  {currentShift()}
                  <small>
                    {
                      {
                        A: copy.shiftATime,
                        B: copy.shiftBTime,
                        C: copy.shiftCTime,
                      }[currentShift()]
                    }
                  </small>
                </strong>
              </span>
            </div>
          </div>
        )}
        {route === "dispatch" && (
          <div className="info-banner">
            <Truck size={20} />
            {t(copy.dispatchOnlyFromReleasedLotsStockIs, copy.urdu124)}
          </div>
        )}
        <section className="panel">
          <div className="list-toolbar">
            <div className="tabs">
              {["all", "A", "B", "C"].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={filter === f ? "active" : ""}
                >
                  {f === "all"
                    ? t(copy.allEntries, copy.urdu125)
                    : `${t(copy.shift, copy.urdu23)} ${f}`}
                </button>
              ))}
            </div>
            <div className="toolbar-actions">
              <label className="inline-search">
                <Search size={17} />
                <input
                  aria-label={t(copy.searchEntries, copy.urdu126)}
                  placeholder={t(copy.searchEntries2, copy.urdu127)}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <button
                className="icon-button"
                aria-label={t(copy.exportEntries, copy.urdu128)}
                onClick={() => exportEntries(list)}
              >
                <Download size={18} />
                <span className="control-label">
                  {t(copy.exportEntries, copy.urdu128)}
                </span>
              </button>
            </div>
          </div>
          {list.length === 0 ? (
            <Empty
              title={
                query || filter !== "all"
                  ? t(copy.noMatchingListEntries, copy.noMatchingEntriesUr)
                  : route === "dispatch"
                    ? t(copy.noDispatchesToday, copy.noDispatchesTodayUr)
                    : t(copy.noProductionToday, copy.noProductionTodayUr)
              }
              detail={
                query || filter !== "all"
                  ? t(copy.changeEntryFilters, copy.changeEntryFiltersUr)
                  : t(copy.recordFirstEntry, copy.recordFirstEntryUr)
              }
            />
          ) : (
            <EntryTable
              entries={previewState === "empty" ? [] : list}
              onDetail={(entry) => setModal({ type: "detail", entry })}
            />
          )}
          <div className="table-footer">
            {t(copy.showing, copy.urdu129)} <bdi>{list.length}</bdi>{" "}
            {t(copy.entriesAsiaKarachiBusinessDate, copy.urdu130)}
            <Status tone="gray">{t(copy.practiceData, copy.urdu131)}</Status>
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
          <div className="panel">
            <span>{t(copy.totalFinishedStock, copy.urdu132)}</span>
            <h2>
              <bdi>{fmt(finished.grams / 1000, 0)}</bdi>
              <small>{copy.kg}</small>
            </h2>
            <p>
              {finished.cartons} {t(copy.cartonsAcross4Lots, copy.urdu133)}
            </p>
          </div>
          <div className="panel">
            <span>{t(copy.rawYarnAvailable, copy.urdu134)}</span>
            <h2>
              <bdi>{fmt(raw.grams / 1000, 0)}</bdi>
              <small>{copy.kg}</small>
            </h2>
            <p>{t(copy.readyForTheNextProductionRun, copy.urdu135)}</p>
          </div>
          <div className="panel">
            <span>{t(copy.qualityHold, copy.urdu136)}</span>
            <h2>
              {copy.label1}
              <small> {t(copy.lot2, copy.urdu22)}</small>
            </h2>
            <p>{t(copy.lot1216AwaitingLabRelease, copy.label1216)}</p>
          </div>
        </div>
        <section className="panel">
          <div className="list-toolbar">
            <div className="tabs">
              {(["finished", "raw", "wip", "cops"] as Stage[]).map((s, i) => (
                <button
                  key={s}
                  className={stage === s ? "active" : ""}
                  onClick={() => setStage(s)}
                >
                  {t(
                    [
                      copy.finishedYarn,
                      copy.rawYarn,
                      copy.machineWip,
                      copy.copsWip,
                    ][i],
                    [copy.urdu137, copy.urdu138, copy.urdu139, copy.urdu140][i],
                  )}
                </button>
              ))}
            </div>
            <div className="toolbar-actions">
              <button
                className={`icon-button ${filter === "hold" ? "selected" : ""}`}
                aria-label={t(copy.filterQcHoldLots, copy.urdu141)}
                aria-pressed={filter === "hold"}
                onClick={() => setFilter(filter === "hold" ? "all" : "hold")}
              >
                <SlidersHorizontal size={19} />
                <span className="control-label">
                  {t(copy.filterQcHoldLots, copy.urdu141)}
                </span>
              </button>
              <button
                className={`icon-button ${viewMatrix ? "selected" : ""}`}
                aria-label={t(copy.toggleMatrixView, copy.urdu142)}
                aria-pressed={viewMatrix}
                onClick={() => setViewMatrix(!viewMatrix)}
              >
                <LayoutDashboard size={18} />
                <span className="control-label">
                  {t(copy.toggleMatrixView, copy.urdu142)}
                </span>
              </button>
              <button
                className="icon-button"
                aria-label={t(copy.exportStock, copy.urdu143)}
                onClick={() =>
                  downloadCsv("yarnflow-stock.csv", [
                    [
                      copy.lot,
                      copy.spec,
                      copy.stage,
                      "kg",
                      copy.cartons2,
                      copy.cones2,
                    ],
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
                <span className="control-label">
                  {t(copy.exportStock, copy.urdu143)}
                </span>
              </button>
            </div>
          </div>
          {filter === "hold" && (
            <div className="active-filter">
              {t(copy.qcHoldLots, copy.urdu144)}
              <button
                onClick={() => setFilter("all")}
                aria-label={t(copy.clearFilter, copy.urdu145)}
              >
                <X size={14} />
                <span className="control-label">
                  {t(copy.clearFilter, copy.urdu145)}
                </span>
              </button>
            </div>
          )}
          {["wip", "cops"].includes(stage) &&
          total(entries, stage).grams === 0 ? (
            <Empty
              title={t(copy.noYarnIssuedToMachines, copy.urdu146)}
              detail={t(copy.issueYarnToAMachineToStart, copy.urdu147)}
              action={
                <Button
                  icon={Plus}
                  onClick={() => setModal({ type: "entry", kind: "issue" })}
                >
                  {t(copy.issueToMachine, copy.urdu10)}
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

                  >
                    <Layers3 size={25} />
                  </span>
                  <strong><bdi dir="ltr">{l.spec}</bdi></strong>
                  <span>
                    {t(copy.lot, copy.urdu22)} {l.id}
                  </span>
                  <h3>
                    <bdi>
                      {fmt(balance(entries, l.id, stage).grams / 1000)}
                      {copy.kg}
                    </bdi>
                  </h3>
                  <Status tone={l.status === "hold" ? "amber" : "green"}>
                    {l.status === "hold"
                      ? t(copy.qcHold, copy.urdu48)
                      : t(copy.available, copy.urdu50)}
                  </Status>
                </button>
              ))}
            </div>
          ) : (
            <ScrollTable>
              <table>
                <thead>
                  <tr>
                    <th>{t(copy.yarnSpecification, copy.urdu148)}</th>
                    <th>{t(copy.lotSupplier, copy.urdu149)}</th>
                    <th>{t(copy.availableStock, copy.urdu150)}</th>
                    <th>{t(copy.cartonsCones, copy.urdu151)}</th>
                    <th>{t(copy.status, copy.urdu19)}</th>
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

                            >
                              <Layers3 size={20} />
                            </span>
                            <span>
                              <strong><bdi dir="ltr">{l.spec}</bdi></strong>
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
                            <bdi>
                              {fmt(b.grams / 1000, 3)}
                              {copy.kg}
                            </bdi>
                          </strong>
                          <small>
                            {t(copy.calculatedFromEntries, copy.urdu152)}
                          </small>
                        </td>
                        <td>
                          <bdi>
                            {b.cartons}
                            {copy.urdu153}
                            {fmt(b.cones, 0)}
                          </bdi>
                        </td>
                        <td>
                          <Status
                            tone={l.status === "hold" ? "amber" : "green"}
                          >
                            {l.status === "hold"
                              ? t(copy.qcHold, copy.urdu48)
                              : t(copy.available, copy.urdu50)}
                          </Status>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`${t(copy.viewLot, copy.urdu154)} ${l.id}`}
                            onClick={() => setModal({ type: "lot", lot: l.id })}
                          >
                            <ChevronRight size={18} />
                            <span className="control-label">{`${t(copy.viewLot, copy.urdu154)} ${l.id}`}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollTable>
          )}
          <div className="table-footer">
            {t(copy.stockIsCalculatedFromSavedEntries, copy.urdu155)}
            <span>{t(copy.label4ActiveLots, copy.urdu156)}</span>
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
        <div className="order-insight">
          <div className="feature-icon">
            <ShoppingBag size={26} />
          </div>
          <div>
            <strong>
              <bdi>
                {fmt(pending / 1000)}
                {copy.kg}
              </bdi>{" "}
              {t(copy.toMakeGoodOn, copy.urdu157)}
            </strong>
            <p>{t(copy.label3CustomersAreCountingOnYourNext, copy.urdu158)}</p>
          </div>
          <Button onClick={() => navigate("inventory")} icon={ArrowUpRight}>
            {t(copy.checkAvailableStock, copy.urdu159)}
          </Button>
        </div>
        <section className="panel">
          <div className="list-toolbar">
            <div className="tabs">
              {["all", "active", "completed"].map((v, i) => (
                <button
                  key={v}
                  onClick={() => setOrderTab(v)}
                  className={orderTab === v ? "active" : ""}
                >
                  {t(
                    [copy.allOrders, copy.inProgress, copy.completed][i],
                    [copy.urdu160, copy.urdu161, copy.urdu162][i],
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
              aria-label={t(copy.exportOrders, copy.urdu163)}
              onClick={() =>
                downloadCsv("yarnflow-orders.csv", [
                  [
                    copy.order,
                    copy.customer,
                    copy.spec,
                    copy.orderedKg,
                    copy.deliveredKg,
                    copy.due,
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
              <span className="control-label">
                {t(copy.exportOrders, copy.urdu163)}
              </span>
            </button>
          </div>
          <ScrollTable>
            <table>
              <thead>
                <tr>
                  <th>{t(copy.customerOrder, copy.urdu164)}</th>
                  <th>{t(copy.yarnFabric, copy.urdu165)}</th>
                  <th>{t(copy.fulfillment, copy.urdu166)}</th>
                  <th>{t(copy.dueDate, copy.urdu167)}</th>
                  <th>{t(copy.status, copy.urdu19)}</th>
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
                      <strong><bdi dir="ltr">{o.spec}</bdi></strong>
                      <small>{o.fabric}</small>
                    </td>
                    <td>
                      <strong>
                        <bdi>
                          {fmt(o.delivered / 1000)}
                          {copy.urdu153}
                          {fmt(o.grams / 1000)}
                          {copy.kg}
                        </bdi>
                      </strong>
                      <div className="progress-track">
                        <i
                          style={{ width: `${(o.delivered / o.grams) * 100}%` }}
                        />
                      </div>
                    </td>
                    <td>
                      <bdi>{displayDate(o.due, ur)}</bdi>
                    </td>
                    <td>
                      <Status
                        tone={
                          o.status === "completed"
                            ? "green"
                            : o.status === "ready"
                              ? "neutral"
                              : "amber"
                        }
                      >
                        {o.status === "completed"
                          ? t(copy.completed, copy.urdu162)
                          : o.status === "ready"
                            ? t(copy.readyToPlan, copy.urdu168)
                            : t(copy.inProgress, copy.urdu161)}
                      </Status>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={t(copy.viewOrder, copy.urdu111)}
                        onClick={() =>
                          setModal({ type: "order-detail", report: o.id })
                        }
                      >
                        <ArrowUpRight size={18} />
                        <span className="control-label">
                          {t(copy.viewOrder, copy.urdu111)}
                        </span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
          {!list.length && (
            <Empty title={t(copy.noOrdersHereYet, copy.urdu169)} />
          )}
        </section>
      </>
    );
  }
  function register() {
    return (
      <section className="panel register-panel">
        <div className="list-toolbar">
          <div className="tabs">
            {["lot", "production", "daily"].map((tab, i) => (
              <button
                key={tab}
                onClick={() => setRegisterTab(tab)}
                className={registerTab === tab ? "active" : ""}
              >
                {t(
                  [copy.lotSheet, copy.production, copy.dailySummary][i],
                  [copy.urdu170, copy.urdu3, copy.urdu171][i],
                )}
              </button>
            ))}
          </div>
          <div className="toolbar-actions">
            <Button icon={Download} onClick={() => exportEntries()}>
              {t(copy.exportCsv, copy.csv2)}
            </Button>
            <Button icon={Printer} onClick={() => window.print()}>
              {t(copy.print, copy.urdu172)}
            </Button>
          </div>
        </div>
        <div className="register-caption">
          <BookOpen size={17} />
          {t(copy.sameColumnsAsYourPaperRegisterEvery, copy.urdu173)}
          <span>{dateLabel}</span>
        </div>
        <ScrollTable>
          <table className="paper-table">
            <thead>
              <tr>
                {(registerTab === "production"
                  ? [
                      copy.date,
                      copy.machine,
                      copy.yarnSpec,
                      copy.lotNo,
                      copy.cartons2,
                      copy.cones2,
                      copy.weightKg2,
                    ]
                  : registerTab === "lot"
                    ? [
                        copy.lotNo,
                        copy.dateReceived,
                        copy.cartonsReceived,
                        copy.cartonsIssued,
                        copy.cartonsInStock,
                        copy.conesInStock,
                      ]
                    : [
                        copy.date,
                        copy.productionKg,
                        copy.deliveryKg,
                        copy.stockBalanceKg,
                        copy.entries,
                      ]
                ).map((h, i) => (
                  <th key={h}>
                    {t(
                      h,
                      (registerTab === "production"
                        ? [
                            copy.urdu33,
                            copy.urdu42,
                            copy.urdu57,
                            copy.urdu174,
                            copy.urdu24,
                            copy.urdu51,
                            copy.urdu84,
                          ]
                        : registerTab === "lot"
                          ? [
                              copy.urdu174,
                              copy.urdu175,
                              copy.urdu176,
                              copy.urdu177,
                              copy.urdu178,
                              copy.urdu179,
                            ]
                          : [
                              copy.urdu33,
                              copy.urdu180,
                              copy.urdu181,
                              copy.urdu182,
                              copy.urdu183,
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
                    <tr key={e.id}>
                      <td>
                        <bdi>{displayDate(e.date, ur)}</bdi>
                      </td>
                      <td>
                        <button
                          className="table-link"
                          onClick={() => setModal({ type: "detail", entry: e })}
                        >
                          <bdi>{e.machine}</bdi>
                          {copy.urdu21}
                          {t(copy.viewEntry, copy.urdu27)}
                        </button>
                      </td>
                      <td><bdi dir="ltr">{lots.find((l) => l.id === e.lot)?.spec}</bdi></td>
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
                  {t(copy.total, copy.urdu184)}
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
                    <td>{fmt(produced / 1000, 0)}</td>
                    <td>{fmt(dispatched / 1000, 0)}</td>
                    <td>{fmt(finished.grams / 1000, 0)}</td>
                    <td>{visible.length}</td>
                  </>
                )}
              </tr>
            </tfoot>
          </table>
        </ScrollTable>
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
            {t(copy.addARegisterEntry, copy.urdu185)}
          </Button>
          <small>
            {t(copy.savedEntriesRemainInTheRegisterReverse, copy.urdu186)}
          </small>
        </div>
      </section>
    );
  }
  const reportNames: [string, string, string, string, LucideIcon][] = [
    [
      copy.dailySummary,
      copy.urdu171,
      copy.productionDeliveriesAndClosingStockInOne,
      copy.urdu187,
      CalendarDays,
    ],
    [
      copy.productionRegister,
      copy.urdu188,
      copy.everyMachineLotAndShiftClearlyAccounted,
      copy.urdu189,
      Factory,
    ],
    [
      copy.lotLedger,
      copy.urdu190,
      copy.followALotFromReceiptToIts,
      copy.urdu191,
      Layers3,
    ],
    [
      copy.stockReport,
      copy.urdu192,
      copy.seeExactlyWhatSAvailableAcrossYour,
      copy.urdu193,
      Boxes,
    ],
    [
      copy.orderStatus,
      copy.urdu194,
      copy.whatSPromisedWhatSDeliveredAnd,
      copy.urdu195,
      ShoppingBag,
    ],
    [
      copy.paperMatchReport,
      copy.urdu196,
      copy.aFamiliarLayoutForYourPaperAnd,
      copy.urdu197,
      BookOpen,
    ],
  ];
  function reports() {
    return (
      <>
        <div className="report-grid">
          {reportNames.map(([name, urdu, description, urDesc, I], i) => (
            <button
              key={name}
              className="report-card panel"
              onClick={() => setModal({ type: "report", report: name })}
            >
              <div className={`report-icon report-${i}`}>
                <Icon icon={I} size={24} />
              </div>
              <h3>{t(name, urdu)}</h3>
              <p>{t(description, urDesc)}</p>
              <div>
                <span>
                  {copy.csv3}
                  {t(copy.printPdf, copy.urdu200)}
                </span>
                <ArrowUpRight size={18} />
              </div>
            </button>
          ))}
        </div>
        <div className="info-banner">
          <FileText size={20} />
          {t(copy.exportsUseYourPracticeDataUseYour, copy.urdu201)}
        </div>
      </>
    );
  }
  function sync() {
    return (
      <>
        <div className="sync-hero panel">
          <span className="sync-illustration">
            <ShieldCheck size={40} />
          </span>
          <div>
            <h2>{t(copy.yourPracticeEntriesAreSafeHere, copy.urdu202)}</h2>
            <p>{t(copy.savedInThisBrowserAFactoryServer, copy.urdu203)}</p>
            <Status tone={offline ? "amber" : "green"}>
              {offline
                ? t(copy.offlineLocalSavesAvailable, copy.urdu204)
                : t(copy.onlinePracticeWorkspace, copy.urdu205)}
            </Status>
          </div>
        </div>
        <div className="inventory-summary">
          <div className="panel">
            <span>{t(copy.savedOnThisDevice, copy.urdu206)}</span>
            <h2>
              {savedLocal}
              <small> {t(copy.entries2, copy.urdu183)}</small>
            </h2>
          </div>
          <div className="panel">
            <span>{t(copy.sampleRecords, copy.urdu207)}</span>
            <h2>{visible.length - savedLocal}</h2>
          </div>
          <div className="panel">
            <span>{t(copy.factoryConnection, copy.urdu208)}</span>
            <h2 className="text-value">{t(copy.notConnected, copy.urdu209)}</h2>
          </div>
        </div>
        <div className="warning-banner">
          <AlertTriangle size={20} />
          <div>
            <strong>{t(copy.keepACopyOfYourWork, copy.urdu210)}</strong>
            <p>
              {t(
                copy.clearingBrowserDataRemovesLocalPracticeEntries,
                copy.urdu211,
              )}
            </p>
          </div>
          <Button
            icon={Download}
            onClick={() =>
              downloadCsv("yarnflow-local-backup.json.csv", [
                [copy.backupJson],
                [JSON.stringify({ entries, orders })],
              ])
            }
          >
            {t(copy.exportBackup, copy.urdu212)}
          </Button>
        </div>
        <section className="panel">
          <div className="panel-heading">
            <h3>{t(copy.savedOnThisDevice, copy.urdu206)}</h3>
            <Button
              icon={RefreshCw}
              onClick={() =>
                notify(
                  t(copy.allPracticeEntriesAreSavedLocallyServer, copy.urdu213),
                )
              }
            >
              {t(copy.checkStatus, copy.urdu214)}
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
            ["general", copy.general, copy.urdu215, Settings2],
            ["appearance", copy.appearance, copy.urdu216, Sun],
            ["data", copy.dataMasters, copy.urdu217, Database],
            ["people", copy.peopleDevices, copy.urdu95, Users],
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
        <section className="panel settings-panel">
          {settingsTab === "general" ? (
            <>
              <h3>{t(copy.factorySettings, copy.urdu218)}</h3>
              <p className="muted">
                {t(copy.factoryNameTimezoneAndLanguage, copy.urdu219)}
              </p>
              <label>
                {t(copy.factoryName, copy.urdu220)}
                <input
                  value={factoryName}
                  onChange={(e) => setFactoryName(e.target.value)}
                  maxLength={80}
                />
              </label>
              <div className="form-grid">
                <label>
                  {t(copy.timezone, copy.urdu221)}
                  <input value={copy.factoryTimezone} readOnly />
                </label>
                <Choices
                  label={t(copy.language, copy.urdu222)}
                  value={ur ? "ur" : "en"}
                  options={[
                    { value: "en", label: copy.english },
                    { value: "ur", label: copy.urdu65 },
                  ]}
                  onChange={(value) => setUr(value === "ur")}
                />
              </div>
              <div className="setting-line">
                <div>
                  <strong>{t(copy.practiceWorkspace, copy.urdu223)}</strong>
                  <p>
                    {t(copy.tryRealWorkflowsWithSampleDataSafely, copy.urdu224)}
                  </p>
                </div>
                <Status tone="neutral">
                  {t(copy.alwaysOnInThisPreview, copy.urdu225)}
                </Status>
              </div>
              <Button
                variant="primary"
                icon={Check}
                onClick={() =>
                  notify(
                    t(copy.workspacePreferencesSavedOnThisDevice, copy.urdu226),
                  )
                }
              >
                {t(copy.savePreferences, copy.urdu227)}
              </Button>
            </>
          ) : settingsTab === "appearance" ? (
            <>
              <h3>{t(copy.display, copy.urdu228)}</h3>
              <p className="muted">
                {t(copy.chooseAComfortableViewForYourEnvironment, copy.urdu229)}
              </p>
              <div className="theme-options">
                {[
                  ["light", copy.light, copy.urdu230, Sun],
                  ["dark", copy.dark, copy.urdu231, Moon],
                  ["factory", copy.factoryMode, copy.urdu232, Monitor],
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
                {t(copy.factoryModeUsesStrongerBordersAndHigher, copy.urdu233)}
              </div>
            </>
          ) : settingsTab === "data" ? (
            <>
              <h3>{t(copy.manageFactoryRecords, copy.urdu234)}</h3>
              {[
                [
                  "masters",
                  copy.manageYarnLotsSuppliers,
                  copy.urdu235,
                  Database,
                ],
                ["import", copy.importARegister, copy.urdu96, Upload],
                ["sync", copy.backUpYourPracticeData, copy.urdu236, Download],
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
              <h3>{t(copy.peopleAndDevices, copy.urdu237)}</h3>
              <p className="muted">
                {t(
                  copy.previewThePeopleAndDeviceManagementScreens,
                  copy.urdu238,
                )}
              </p>
              <Button icon={Users} onClick={() => navigate("users")}>
                {t(copy.managePeopleDevices, copy.urdu239)}
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
        <div className="help-hero">
          <span className="feature-icon">
            <CircleHelp size={30} />
          </span>
          <h2>{t(copy.howToUseYarnflow, copy.urdu240)}</h2>
          <p>{t(copy.chooseATaskBelowForInstructions, copy.urdu241)}</p>
          <Button
            variant="primary"
            icon={CircleHelp}
            onClick={() => navigate("home")}
          >
            {t(copy.explorePracticeActions, copy.urdu242)}
          </Button>
        </div>
        <div className="help-grid">
          {[
            [
              copy.howDoIRecordProduction,
              copy.urdu243,
              copy.chooseProductionThenRecordProductionChooseA,
              copy.urdu244,
            ],
            [
              copy.whatHappensWithoutInternet,
              copy.urdu245,
              copy.practiceEntriesSaveOnThisDeviceAfter,
              copy.urdu246,
            ],
            [
              copy.canICorrectASavedEntry,
              copy.urdu247,
              copy.openAnEntryAndChooseReverseEntry,
              copy.urdu248,
            ],
            [
              copy.whatDoesQcHoldMean,
              copy.urdu249,
              copy.theLotIsWaitingForAQuality,
              copy.urdu250,
            ],
          ].map(([en, urdu, answer, urAnswer]) => (
            <details className="help-question" key={en}>
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
            {t(copy.componentGallery, copy.urdu98)}
            <ArrowUpRight size={16} />
          </button>
          <button onClick={() => navigate("login")}>
            <Users size={19} />
            {t(copy.tryThePinLoginScreen, copy.urdu251)}
            <ArrowUpRight size={16} />
          </button>
        </div>
      </>
    );
  }
  function dayClose() {
    const isClosed = closed === today();
    return (
      <div className="day-close panel">
        <div className="day-close-head">
          <span className="feature-icon">
            <CalendarDays size={28} />
          </span>
          <h2>
            {isClosed
              ? t(copy.aGoodDayAllWrappedUp, copy.urdu252)
              : t(copy.reviewTodaySEntries, copy.urdu253)}
          </h2>
          <p>
            {dateLabel}
            {copy.urdu21}
            {factoryName}
          </p>
        </div>
        <div className="close-totals">
          <div>
            <span>{t(copy.production, copy.urdu3)}</span>
            <strong>
              <bdi>
                {fmt(produced / 1000, 0)}
                {copy.kg}
              </bdi>
            </strong>
          </div>
          <div>
            <span>{t(copy.dispatch, copy.urdu6)}</span>
            <strong>
              <bdi>
                {fmt(dispatched / 1000, 0)}
                {copy.kg}
              </bdi>
            </strong>
          </div>
          <div>
            <span>{t(copy.closingStock, copy.urdu254)}</span>
            <strong>
              <bdi>
                {fmt(finished.grams / 1000, 0)}
                {copy.kg}
              </bdi>
            </strong>
          </div>
        </div>
        {isClosed ? (
          <div className="success-block">
            <CircleCheck size={36} />
            <h3>{t(copy.practiceDayClosed, copy.urdu255)}</h3>
            <p>{t(copy.newEntriesForTodayAreNowBlocked, copy.urdu256)}</p>
            <Button onClick={() => setModal({ type: "reopen" })}>
              {t(copy.reopenWithAReason, copy.urdu257)}
            </Button>
          </div>
        ) : (
          <>
            <h3>{t(copy.aQuickCheckBeforeYouClose, copy.urdu258)}</h3>
            {[
              [copy.iReviewedTodaySProductionAndDispatch, copy.urdu259],
              [copy.iCheckedTheClosingStockAgainstThe, copy.urdu260],
              [copy.iHaveExportedABackupOfLocally, copy.urdu261],
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
              {t(copy.handoverNotes, copy.urdu262)}
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder={t(copy.anythingForTheNextShift, copy.urdu263)}
              />
            </label>
            <div className="modal-actions">
              <Button icon={Download} onClick={() => exportEntries()}>
                {t(copy.exportDailySummary, copy.urdu264)}
              </Button>
              <Button
                variant="primary"
                icon={LockKeyhole}
                disabled={!checks.every(Boolean)}
                onClick={() => setModal({ type: "close-confirm" })}
              >
                {t(copy.reviewCloseDay, copy.urdu265)}
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
      <section className="panel">
        <label className="large-search">
          <Search size={23} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(copy.tryALotNumberYarnSpecOr, copy.urdu266)}
            aria-label={t(copy.searchAllRecords, copy.urdu267)}
          />
          {query && (
            <button
              className="icon-button"
              aria-label={t(copy.clearSearch, copy.urdu268)}
              onClick={() => setQuery("")}
            >
              <X size={18} />
              <span className="control-label">
                {t(copy.clearSearch, copy.urdu268)}
              </span>
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
                  {t(copy.lot, copy.urdu22)} {l.id}
                </strong>
                <span><bdi dir="ltr">{l.spec}</bdi></span>
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
                ? t(copy.noMatchingEntries, copy.urdu269)
                : t(copy.findSomethingInAHeartbeat, copy.urdu270)
            }
            detail={
              query
                ? t(copy.checkTheLotNumberOrTryThe, copy.urdu271)
                : t(
                    copy.searchByLotSerialMachineYarnSpecification,
                    copy.urdu272,
                  )
            }
            action={
              query ? (
                <Button onClick={() => setQuery("")}>
                  {t(copy.clearSearch, copy.urdu268)}
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
          {t(copy.sampleMasterDataIsReadOnlyProduction, copy.urdu273)}
        </div>
        <section className="panel">
          <div className="panel-heading">
            <h3>{t(copy.yarnSpecificationsLots, copy.urdu274)}</h3>
            <Status tone="neutral">
              {t(copy.label4SampleLots, copy.urdu275)}
            </Status>
          </div>
          <ScrollTable>
            <table>
              <thead>
                <tr>
                  {[
                    copy.specification,
                    copy.lot,
                    copy.supplier,
                    copy.packingDefault,
                    copy.status,
                  ].map((h, i) => (
                    <th key={h}>
                      {t(
                        h,
                        [
                          copy.urdu57,
                          copy.urdu22,
                          copy.urdu41,
                          copy.urdu276,
                          copy.urdu19,
                        ][i],
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lots.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <strong><bdi dir="ltr">{l.spec}</bdi></strong>
                    </td>
                    <td>{l.id}</td>
                    <td>{l.supplier}</td>
                    <td>
                      {copy.label24}
                      {t(copy.conesCarton, copy.urdu277)}
                    </td>
                    <td>
                      <Status tone={l.status === "hold" ? "amber" : "green"}>
                        {l.status === "hold"
                          ? t(copy.qcHold, copy.urdu48)
                          : t(copy.active, copy.urdu278)}
                      </Status>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        </section>
        <div className="inventory-summary">
          {[
            ["6", copy.machines, copy.urdu279, "1A · 1B · 2A · 2B · 3A · 3B"],
            ["3", copy.shifts, copy.urdu280, "A 07–15 · B 15–23 · C 23–07"],
            ["3", copy.suppliers, copy.urdu41, copy.crescentNishatIbrahim],
          ].map(([n, en, urdu, desc]) => (
            <div className="panel" key={en}>
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
          {t(copy.theseArePracticeProfilesLivePinResets, copy.urdu281)}
        </div>
        <section className="panel">
          <div className="panel-heading">
            <h3>{t(copy.yourPeople, copy.urdu282)}</h3>
            <Button icon={LogOut} onClick={() => navigate("login")}>
              {t(copy.switchProfile, copy.urdu283)}
            </Button>
          </div>
          {[
            [copy.ahmedKhan, copy.owner, copy.urdu284, copy.ak],
            [copy.asifAli, copy.supervisor, copy.urdu285, copy.aa],
            [copy.muhammadBilal, copy.operator, copy.urdu286, copy.mb],
          ].map(([name, role, urdu, initials]) => (
            <div className="user-row" key={name}>
              <span className="avatar">{initials}</span>
              <div>
                <strong>{name}</strong>
                <small>{t(role, urdu)}</small>
              </div>
              <Status>{t(copy.practiceProfile, copy.urdu287)}</Status>
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h3>{t(copy.thisDevice, copy.urdu288)}</h3>
            <Monitor size={20} />
          </div>
          <div className="device-row">
            <span className="feature-icon">
              <Monitor size={24} />
            </span>
            <div>
              <strong>{t(copy.yourCurrentBrowser, copy.urdu289)}</strong>
              <p>
                {t(
                  copy.localPracticeStorageNoRegisteredFactoryDevice,
                  copy.urdu290,
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
        {[
          ["production", copy.recordProduction, copy.urdu100, Factory],
          ["issue", copy.issueToMachine, copy.urdu10, Layers3],
          ["receipt", copy.receiveYarn, copy.urdu103, PackagePlus],
          ["dispatch", copy.dispatchYarn, copy.urdu292, Truck],
        ].map(([kind, en, urdu, I]) => (
          <button
            className="quick-action"
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
          className="quick-action"
          onClick={() => navigate("register")}
        >
          <span className="feature-icon">
            <BookOpen size={30} />
          </span>
          <h3>{t(copy.openRegister, copy.urdu293)}</h3>
          <ArrowUpRight size={20} />
        </button>
        <button
          className="quick-action"
          onClick={() => navigate("close")}
        >
          <span className="feature-icon">
            <CalendarDays size={30} />
          </span>
          <h3>{t(copy.closeTheDay, copy.urdu93)}</h3>
          <ArrowUpRight size={20} />
        </button>
      </div>
    );
  }
  function gallery() {
    return (
      <div className="gallery">
        <section className="panel">
          <h3>{t(copy.buttonsControls, copy.urdu294)}</h3>
          <div className="gallery-row">
            <Button
              variant="primary"
              onClick={() => notify(t(copy.actionComplete, copy.urdu295))}
              icon={Check}
            >
              {t(copy.primaryAction, copy.urdu296)}
            </Button>
            <Button
              onClick={() =>
                notify(t(copy.secondaryActionComplete, copy.urdu297))
              }
            >
              {t(copy.secondaryAction, copy.urdu298)}
            </Button>
            <Button disabled>{t(copy.disabled, copy.urdu299)}</Button>
          </div>
          <div className="gallery-row">
            <Status>{t(copy.savedLocally, copy.urdu300)}</Status>
            <Status tone="amber">{t(copy.qcHold, copy.urdu48)}</Status>
            <Status tone="neutral">{t(copy.practice, copy.urdu301)}</Status>
            <Status tone="gray">{t(copy.archived, copy.urdu302)}</Status>
          </div>
          <Choices
            label={t(copy.previewAScreenState, copy.urdu303)}
            value={previewState}
            options={["ready", "loading", "empty", "error", "denied"].map(
              (value, i) => ({
                value,
                label: t(
                  [
                    copy.ready,
                    copy.loading,
                    copy.empty,
                    copy.error,
                    copy.permissionDenied,
                  ][i],
                  [
                    copy.urdu304,
                    copy.urdu305,
                    copy.urdu306,
                    copy.urdu307,
                    copy.urdu308,
                  ][i],
                ),
              }),
            )}
            onChange={setPreviewState}
          />
        </section>
        <section className="panel">
          <h3>{t(copy.themeLanguage, copy.urdu309)}</h3>
          <div className="gallery-row">
            <Button onClick={() => setUr(!ur)} icon={Globe2}>
              {ur ? copy.english : copy.urdu65}
            </Button>
            {["light", "dark", "factory"].map((v, i) => (
              <Button key={v} onClick={() => setTheme(v)}>
                {t(
                  [copy.light, copy.dark, copy.factoryMode][i],
                  [copy.urdu230, copy.urdu231, copy.urdu232][i],
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
        <div className="panel loading-state" role="status">
          <RefreshCw className="spin" size={30} />
          <p>{t(copy.loadingYourWorkspace, copy.urdu310)}</p>
          <Button onClick={() => setPreviewState("ready")}>
            {t(copy.finishPreview, copy.urdu311)}
          </Button>
        </div>
      );
    if (previewState === "error" || previewState === "denied")
      return (
        <div className="panel">
          <Empty
            title={
              previewState === "denied"
                ? t(copy.thisViewNeedsManagerAccess, copy.urdu312)
                : t(copy.weCouldnTLoadTheseEntries, copy.urdu313)
            }
            detail={t(copy.yourSavedEntriesAreStillSafeOn, copy.urdu314)}
            action={
              <Button onClick={() => setPreviewState("ready")}>
                {t(copy.tryAgain, copy.urdu315)}
              </Button>
            }
          />
        </div>
      );
    switch (route) {
      case "more":
        return (
          <div className="more-grid">
            {[
              ["dispatch", copy.dispatch, copy.urdu6, Truck],
              ["register", copy.registers, copy.urdu7, BookOpen],
              ["scanner", copy.scanMaterial, copy.urdu291, ScanLine],
              ["reports", copy.reports, copy.urdu88, BarChart3],
              ["home", copy.recordStockMovement, copy.urdu104, PackagePlus],
              ["close", copy.closeToday, copy.urdu316, CheckCheck],
              ["settings", copy.settings, copy.urdu317, Settings2],
              ["help", copy.help, copy.urdu318, CircleHelp],
            ].map(([to, en, ur, I]) => (
              <button
                className="more-link"
                key={String(to)}
                onClick={() => navigate(String(to))}
              >
                <Icon icon={I as LucideIcon} />
                <span>{t(String(en), String(ur))}</span>
                <ChevronRight size={20} />
              </button>
            ))}
          </div>
        );
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
        <a
          className="skip-link"
          href="#main-content"
          onClick={(event) => {
            event.preventDefault();
            document.getElementById("main-content")?.focus();
          }}
        >
          {t(copy.skipToContent, copy.urdu319)}
        </a>
        <aside className="sidebar">
          <button
            className="brand-button"
            onClick={() => navigate("overview")}
            aria-label={copy.yarnflow2}
          >
            <Logo />
          </button>
          <div className="factory-name">{factoryName}</div>
          <nav
            className="main-nav"
            aria-label={t(copy.mainNavigation, copy.urdu320)}
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
              </button>
            ))}
          </nav>
          <div className="sidebar-note">
            <ShieldCheck size={18} />
            {t(copy.practiceWorkspace, copy.urdu223)}
          </div>
        </aside>
        <div className="main-shell">
          <div className="practice-banner">
            <div>
              <ShieldCheck size={22} />
              <strong>
                {t(copy.practiceModeNothingHereAffectsRealStock, copy.urdu321)}
              </strong>
            </div>
            <Button onClick={() => location.assign("/")}>
              {t(copy.switchToRealWorkspace, copy.urdu322)}
            </Button>
          </div>
          <header className="topbar">
            <span className="header-date">{dateLabel}</span>
            <div className="topbar-right">
              <button className="button" onClick={() => navigate("search")}>
                <Search size={20} />
                <span>{t(copy.search, copy.urdu323)}</span>
              </button>
              <button className="button" onClick={() => setUr(!ur)}>
                <Globe2 size={20} />
                <span>{ur ? copy.english : copy.urdu65}</span>
              </button>
              <button
                className="button profile-control"
                onClick={() => navigate("login")}
              >
                <Users size={20} />
                <span>{user}</span>
              </button>
            </div>
          </header>
          <main id="main-content" tabIndex={-1}>
            <div className="page-heading">
              <h1>{t(title[0], title[1])}</h1>
              <div className="heading-actions">{headerAction()}</div>
            </div>
            {closed === today() && route !== "close" && (
              <div className="warning-banner">
                <LockKeyhole size={18} />
                {t(copy.todayIsClosedReopenThePracticeDay, copy.urdu324)}
                <button
                  className="text-button"
                  onClick={() => navigate("close")}
                >
                  {t(copy.viewDayClose, copy.urdu325)}
                </button>
              </div>
            )}
            {content()}
          </main>
        </div>
        <div
          className={`save-status ${storageError ? "storage-error" : ""}`}
          role={storageError ? "alert" : "status"}
        >
          {storageError ? (
            <AlertTriangle size={20} />
          ) : offline ? (
            <WifiOff size={20} />
          ) : (
            <CheckCheck size={20} />
          )}
          <span>
            {storageError
              ? t(copy.storageFailed, copy.storageFailedUr)
              : offline
                ? t(copy.offlineEntriesStillSaveOnThisDevice, copy.urdu326)
                : t(copy.allEntriesSavedOnThisDevicePractice, copy.urdu327)}
          </span>
          {storageError && (
            <Button onClick={retryStorage}>
              {t(copy.tryAgain, copy.urdu315)}
            </Button>
          )}
        </div>
        <nav
          className="bottom-tabs"
          aria-label={t(copy.mainNavigation, copy.urdu320)}
        >
          {navItems
            .filter(([to]) =>
              [
                "overview",
                "production",
                "inventory",
                "orders",
                "more",
              ].includes(to),
            )
            .map(([to, en, urdu, I]) => (
              <button
                key={to}
                className={
                  route === to ||
                  (to === "more" &&
                    !["overview", "production", "inventory", "orders"].includes(
                      route,
                    ))
                    ? "active"
                    : ""
                }
                aria-current={route === to ? "page" : undefined}
                onClick={() => {
                  setQuery("");
                  navigate(to);
                }}
              >
                <Icon icon={I} />
                <span>{t(en, urdu)}</span>
              </button>
            ))}
        </nav>
        {modal && (
          <Modal
            title={
              modal.type === "workspace"
                ? t(copy.realWorkspace, copy.urdu328)
                : modal.type === "saved"
                  ? t(copy.entrySaved, copy.urdu329)
                  : modal.type === "entry"
                    ? t(...kindNames[modal.kind || "production"])
                    : modal.type === "new"
                      ? t(copy.whatWouldYouLikeToRecord, copy.urdu330)
                      : modal.type === "detail"
                        ? t(copy.entryDetails, copy.urdu331)
                        : modal.type === "lot"
                          ? `${t(copy.lot, copy.urdu22)} ${modal.lot}`
                          : modal.type === "date"
                            ? t(copy.yourBusinessDate, copy.urdu332)
                            : modal.type === "notifications"
                              ? t(copy.needsAttention, copy.urdu333)
                              : modal.type === "order"
                                ? t(copy.createAnOrder, copy.urdu334)
                                : modal.type === "report"
                                  ? t(copy.reportPreview, copy.urdu335)
                                  : modal.type === "order-detail"
                                    ? t(copy.orderDetails, copy.urdu336)
                                    : modal.type === "void"
                                      ? t(copy.reverseThisEntry, copy.urdu337)
                                      : modal.type === "reopen"
                                        ? t(
                                            copy.reopenThePracticeDay,
                                            copy.urdu338,
                                          )
                                        : t(
                                            copy.closeThePracticeDay,
                                            copy.urdu339,
                                          )
            }
            onClose={() => setModal(null)}
            wide={["report", "lot"].includes(modal.type)}
          >
            {modal.type === "workspace" && (
              <div className="workspace-explanation">
                <p>
                  {t(copy.aRealFactoryWorkspaceIsNotConnected, copy.urdu340)}
                </p>
                <p>
                  {t(
                    copy.askYourAdministratorToConnectTheFactory,
                    copy.urdu341,
                  )}
                </p>
                <div className="modal-actions">
                  <Button variant="primary" onClick={() => setModal(null)}>
                    {t(copy.returnToPractice, copy.urdu342)}
                  </Button>
                </div>
              </div>
            )}
            {modal.type === "saved" && modal.entry && (
              <div className="saved-result">
                <CircleCheck size={36} />
                <h3>
                  {t(
                    copy.saved0Kg(fmt(modal.entry.grams / 1000, 3)),
                    copy.label010(fmt(modal.entry.grams / 1000, 3)),
                  )}
                </h3>
                <p>
                  {modal.entry.machine}
                  {copy.urdu21}
                  {t(copy.shift, copy.urdu23)} {modal.entry.shift}
                  {copy.urdu21}
                  {t(copy.lot, copy.urdu22)} {modal.entry.lot}
                </p>
                <p>{t(copy.savedOnThisDevicePracticeStockHas, copy.urdu343)}</p>
                <div className="modal-actions">
                  <Button onClick={() => undo(modal.entry!)}>
                    {t(copy.undo, copy.urdu384)}
                  </Button>
                  <Button
                    onClick={() => {
                      setToast(null);
                      setModal({ type: "entry", kind: modal.entry!.kind });
                    }}
                  >
                    {t(copy.recordAnother, copy.urdu344)}
                  </Button>
                  <Button variant="primary" onClick={() => setModal(null)}>
                    {t(copy.done, copy.urdu162)}
                  </Button>
                </div>
              </div>
            )}
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
                            copy.packTheShiftSFinishedYarn,
                            copy.bringNewMaterialIntoStock,
                            copy.recordYarnIssuedToAMachine,
                            copy.prepareACustomerDelivery,
                          ][i],
                          [
                            copy.urdu345,
                            copy.urdu346,
                            copy.urdu347,
                            copy.urdu348,
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
                  <p>{copy.asiaKarachiUtc0500}</p>
                </div>
                <div className="info-banner">
                  {t(copy.theOverviewShowsTodaySPracticeData, copy.urdu349)}
                </div>
                <div className="modal-actions">
                  <Button onClick={() => setModal(null)}>
                    {t(copy.gotIt, copy.urdu350)}
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
                      {t(copy.lot1216IsOnQcHold, copy.label12162)}
                    </strong>
                    <p>
                      {t(
                        copy.dispatchIsBlockedUntilQualityApproval,
                        copy.urdu351,
                      )}
                    </p>
                    <small>{t(copy.sampleAlertQuality, copy.urdu352)}</small>
                  </div>
                  <ChevronRight size={18} />
                </button>
                <button
                  onClick={() => {
                    setModal(null);
                    navigate("orders");
                  }}
                >
                  <span className="row-icon neutral-icon">
                    <ShoppingBag size={20} />
                  </span>
                  <div>
                    <strong>
                      {t(copy.ordersAreDueThisWeek, copy.urdu353)}
                    </strong>
                    <p>
                      {t(
                        copy.reviewMaterialAvailabilityForThisWeekS,
                        copy.urdu354,
                      )}
                    </p>
                    <small>{t(copy.sampleAlertOrders, copy.urdu355)}</small>
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
                    <span className="entry-kind">
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
                        ? t(copy.reversed, copy.urdu25)
                        : t(copy.savedLocally, copy.urdu300)}
                    </Status>
                  </div>
                </div>
                <dl className="detail-grid">
                  {[
                    [
                      t(copy.yarn, copy.urdu57),
                      lots.find((l) => l.id === currentEntry.lot)?.spec,
                    ],
                    [t(copy.lot, copy.urdu22), currentEntry.lot],
                    [
                      t(copy.weight, copy.urdu356),
                      `${fmt(currentEntry.grams / 1000, 3)} kg`,
                    ],
                    [
                      t(copy.cartonsCones, copy.urdu151),
                      `${currentEntry.cartons} / ${currentEntry.cones}`,
                    ],
                    [
                      t(copy.machineCustomer, copy.urdu16),
                      currentEntry.machine,
                    ],
                    [
                      t(copy.dateShift, copy.urdu357),
                      `${displayDate(currentEntry.date, ur)} · ${currentEntry.shift}`,
                    ],
                    [t(copy.recordedBy, copy.urdu18), currentEntry.by],
                    [t(copy.notes, copy.urdu58), currentEntry.notes || "—"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>
                        <bdi dir={label === t(copy.yarn, copy.urdu57) ? "ltr" : "auto"}>{value}</bdi>
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="audit-note">
                  <ShieldCheck size={19} />
                  {t(
                    copy.originalEntryRetainedCorrectionsCreateAReversing,
                    copy.urdu358,
                  )}
                </div>
                <div className="modal-actions">
                  <Button
                    icon={Download}
                    onClick={() => exportEntries([currentEntry])}
                  >
                    {t(copy.exportEntry, copy.urdu359)}
                  </Button>
                  {currentEntry.kind !== "reversal" &&
                    !entries.some((e) => e.reverses === currentEntry.id) && (
                      <Button
                        onClick={() =>
                          setModal({ type: "void", entry: currentEntry })
                        }
                        icon={RefreshCw}
                      >
                        {t(copy.reverseEntry, copy.urdu337)}
                      </Button>
                    )}
                </div>
              </>
            )}
            {modal.type === "void" && currentEntry && (
              <ReasonForm
                text={t(
                  copy.thisCreatesAReversingEntryTheOriginal,
                  copy.urdu360,
                )}
                button={t(copy.confirmReversal, copy.urdu361)}
                onSubmit={(reason) => undo(currentEntry, reason)}
              />
            )}
            {modal.type === "reopen" && (
              <ReasonForm
                text={t(
                  copy.reopeningAllowsNewEntriesForTodayGive,
                  copy.urdu362,
                )}
                button={t(copy.reopenDay, copy.urdu363)}
                onSubmit={(reason) => {
                  localStorage.setItem("yf-reopen-reason", reason);
                  setClosed("");
                  setModal(null);
                  notify(t(copy.practiceDayReopened, copy.urdu364));
                }}
              />
            )}
            {modal.type === "close-confirm" && (
              <>
                <div className="warning-banner">
                  <LockKeyhole size={24} />
                  {t(copy.newEntriesForTodayWillBeBlocked, copy.urdu365)}
                </div>
                <div className="modal-actions">
                  <Button onClick={() => setModal(null)}>
                    {t(copy.keepReviewing, copy.urdu366)}
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
                          copy.practiceDayClosedEverythingIsAccountedFor,
                          copy.urdu367,
                        ),
                      );
                    }}
                  >
                    {t(copy.approveClose, copy.urdu368)}
                  </Button>
                </div>
              </>
            )}
            {modal.type === "lot" && currentLot && (
              <>
                <div className="lot-detail-header">
                  <span
                    className="material-swatch"

                  >
                    <Layers3 size={30} />
                  </span>
                  <div>
                    <h3><bdi dir="ltr">{currentLot.spec}</bdi></h3>
                    <p>
                      {currentLot.supplier}
                      {copy.urdu21}
                      {t(copy.received, copy.urdu369)}{" "}
                      <bdi>{displayDate(currentLot.received)}</bdi>
                    </p>
                  </div>
                  <Status
                    tone={currentLot.status === "hold" ? "amber" : "green"}
                  >
                    {currentLot.status === "hold"
                      ? t(copy.qcHold, copy.urdu48)
                      : t(copy.active, copy.urdu278)}
                  </Status>
                </div>
                <div className="close-totals">
                  <div>
                    <span>{t(copy.finishedStock, copy.urdu105)}</span>
                    <strong>
                      <bdi>
                        {fmt(
                          balance(entries, currentLot.id, "finished").grams /
                            1000,
                        )}{" "}
                        {copy.kg}
                      </bdi>
                    </strong>
                  </div>
                  <div>
                    <span>{t(copy.rawStock, copy.urdu370)}</span>
                    <strong>
                      <bdi>
                        {fmt(
                          balance(entries, currentLot.id, "raw").grams / 1000,
                        )}{" "}
                        {copy.kg}
                      </bdi>
                    </strong>
                  </div>
                  <div>
                    <span>{t(copy.finishedCartons, copy.urdu371)}</span>
                    <strong>
                      {balance(entries, currentLot.id, "finished").cartons}
                    </strong>
                  </div>
                </div>
                {currentLot.status === "hold" && (
                  <div className="warning-banner">
                    <AlertTriangle size={20} />
                    {t(copy.qcHoldSampleHoldPlacedByAhmed, copy.urdu372)}
                  </div>
                )}
                <h3 className="timeline-title">
                  {t(copy.theStoryOfThisLot, copy.urdu373)}
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
                              ? t(copy.openingStock, copy.urdu374)
                              : t(...kindNames[e.kind])}
                          </strong>
                          <p>
                            <bdi>
                              {fmt(e.grams / 1000, 3)}
                              {copy.kg}
                            </bdi>
                            {copy.urdu21}
                            {e.cartons} {t(copy.cartons, copy.urdu24)}
                            {copy.urdu21}
                            {e.by}
                          </p>
                          <small>
                            <bdi>{e.serial}</bdi>
                            {copy.urdu21}{" "}
                            <bdi>
                              {displayDate(e.date, ur)} {e.time}
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
                  notify(t(copy.practiceOrderSaved, copy.urdu375));
                }}
              />
            )}
            {modal.type === "order-detail" && currentOrder && (
              <>
                <div className="order-detail">
                  <Status
                    tone={
                      currentOrder.status === "completed" ? "green" : "neutral"
                    }
                  >
                    {currentOrder.status === "completed"
                      ? t(copy.completed, copy.urdu162)
                      : t(copy.inProgress, copy.urdu161)}
                  </Status>
                  <h3>{currentOrder.customer}</h3>
                  <p>
                    <bdi>{currentOrder.id}</bdi>
                    {copy.urdu21}
                    {currentOrder.fabric}
                  </p>
                  <h2>
                    <bdi>
                      {fmt(
                        (currentOrder.grams - currentOrder.delivered) / 1000,
                      )}{" "}
                      {copy.kg}
                    </bdi>
                  </h2>
                  <span>{t(copy.remainingToFulfill, copy.urdu376)}</span>
                  <div className="progress-track">
                    <i
                      style={{
                        width: `${(currentOrder.delivered / currentOrder.grams) * 100}%`,
                      }}
                    />
                  </div>
                  <p>
                    <bdi dir="ltr">{currentOrder.spec}</bdi>
                    {copy.urdu21}
                    {t(copy.due, copy.urdu33)} <bdi>{displayDate(currentOrder.due, ur)}</bdi>
                  </p>
                </div>
                <div className="info-banner">
                  {t(
                    copy.dispatchEntriesInThisPreviewAreIndependent,
                    copy.urdu377,
                  )}
                </div>
                <div className="modal-actions">
                  <Button
                    onClick={() => {
                      setModal(null);
                      navigate("inventory");
                    }}
                  >
                    {t(copy.checkInventory, copy.urdu378)}
                  </Button>
                  <Button
                    variant="primary"
                    icon={Truck}
                    onClick={() =>
                      setModal({ type: "entry", kind: "dispatch" })
                    }
                  >
                    {t(copy.prepareDispatch, copy.urdu379)}
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
                        {dateLabel}
                        {copy.urdu21}
                        {t(copy.practiceData2, copy.urdu131)}
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
                    {t(copy.businessDate, copy.urdu380)}
                    {copy.urdu49}
                    <bdi>{displayDate(today())}</bdi> {copy.asiaKarachi2}
                  </p>
                  {modal.report === copy.stockReport ||
                  modal.report === copy.lotLedger ? (
                    <ScrollTable><table>
                      <thead>
                        <tr>
                          <th>{t(copy.lot, copy.urdu22)}</th>
                          <th>{t(copy.yarn, copy.urdu57)}</th>
                          <th>{t(copy.stockKg, copy.urdu182)}</th>
                          <th>{t(copy.cartons2, copy.urdu24)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lots.map((l) => (
                          <tr key={l.id}>
                            <td>{l.id}</td>
                            <td><bdi dir="ltr">{l.spec}</bdi></td>
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
                    </table></ScrollTable>
                  ) : modal.report === copy.orderStatus ? (
                    <ScrollTable><table>
                      <thead>
                        <tr>
                          <th>{t(copy.customer, copy.urdu40)}</th>
                          <th>{t(copy.orderedKg2, copy.urdu381)}</th>
                          <th>{t(copy.remainingKg, copy.urdu382)}</th>
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
                    </table></ScrollTable>
                  ) : (
                    <>
                      <div className="close-totals">
                        <div>
                          <span>{t(copy.production, copy.urdu3)}</span>
                          <strong>
                            {fmt(produced / 1000, 0)}
                            {copy.kg}
                          </strong>
                        </div>
                        <div>
                          <span>{t(copy.dispatch, copy.urdu6)}</span>
                          <strong>
                            {fmt(dispatched / 1000, 0)}
                            {copy.kg}
                          </strong>
                        </div>
                        <div>
                          <span>{t(copy.closingStock, copy.urdu254)}</span>
                          <strong>
                            {fmt(finished.grams / 1000, 0)}
                            {copy.kg}
                          </strong>
                        </div>
                      </div>
                      <EntryTable
                        entries={
                          modal.report === copy.productionRegister
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
                        modal.report === copy.stockReport ||
                        modal.report === copy.lotLedger
                      )
                        downloadCsv("yarnflow-stock.csv", [
                          [copy.lot, copy.spec, copy.finishedKg, copy.cartons2],
                          ...lots.map((l) => [
                            l.id,
                            l.spec,
                            balance(entries, l.id, "finished").grams / 1000,
                            balance(entries, l.id, "finished").cartons,
                          ]),
                        ]);
                      else if (modal.report === copy.orderStatus)
                        downloadCsv("yarnflow-orders.csv", [
                          [
                            copy.order,
                            copy.customer,
                            copy.orderedKg,
                            copy.remainingKg2,
                          ],
                          ...orders.map((o) => [
                            o.id,
                            o.customer,
                            o.grams / 1000,
                            (o.grams - o.delivered) / 1000,
                          ]),
                        ]);
                      else
                        exportEntries(
                          modal.report === copy.productionRegister
                            ? active.filter((e) => e.kind === "production")
                            : visible,
                        );
                    }}
                  >
                    {t(copy.exportCsv, copy.csv4)}
                  </Button>
                  <Button
                    variant="primary"
                    icon={Printer}
                    onClick={() => window.print()}
                  >
                    {t(copy.printSavePdf, copy.urdu383)}
                  </Button>
                </div>
              </>
            )}
          </Modal>
        )}
        {toast && !modal && (
          <div className="toast" role="status">
            <span className="toast-check">
              <Check size={18} />
            </span>
            <span>{toast.text}</span>
            {toast.entry && (
              <button onClick={() => undo(toast.entry!)}>
                {t(copy.undo, copy.urdu384)}
              </button>
            )}
            <button
              className="icon-button"
              aria-label={t(copy.dismissNotification, copy.urdu385)}
              onClick={() => setToast(null)}
            >
              <X size={17} />
              <span className="control-label">
                {t(copy.dismissNotification, copy.urdu385)}
              </span>
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
        {t(copy.reason, copy.urdu386)}
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
  const [d, setDraft] = useStored("yf-order-draft-v2", {
    customer: copy.lahoreKnitwear,
    spec: lots[0].spec,
    fabric: copy.singleJersey160Gsm,
    weight: "",
    due: today(),
  });
  const [review, setReview] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const set = (key: keyof typeof d, value: string) => {
    setDraft({ ...d, [key]: value });
    setError("");
  };
  const weightError =
    d.weight && (!/^\d+(\.\d{1,3})?$/.test(d.weight) || Number(d.weight) <= 0)
      ? t(copy.enterAWeightGreaterThanZeroWith, copy.urdu387)
      : "";
  const dateError =
    !d.due || d.due < today()
      ? t(copy.chooseTodayOrALaterDate, copy.urdu388)
      : "";
  if (saved)
    return (
      <div className="saved-result">
        <CircleCheck size={36} />
        <h3>{t(copy.orderSaved, copy.urdu389)}</h3>
        <p>
          {d.customer}
          {copy.urdu21}
          {fmt(Number(d.weight), 3)}
          {copy.kg2}
          {displayDate(d.due)}
        </p>
        <div className="modal-actions">
          <Button
            onClick={() => {
              setDraft({ ...d, weight: "" });
              setSaved(false);
              setReview(false);
            }}
          >
            {t(copy.recordAnother, copy.urdu344)}
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("yf-close-modal"))
            }
          >
            {t(copy.done, copy.urdu162)}
          </Button>
        </div>
      </div>
    );
  return (
    <form
      className="entry-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (weightError || dateError || !d.weight) return;
        if (!review) {
          setReview(true);
          return;
        }
        try {
          onSave({
            id: `ORD-26-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
            customer: d.customer,
            spec: d.spec,
            fabric: d.fabric,
            grams: kgToGrams(d.weight),
            delivered: 0,
            due: d.due,
            status: "in-progress",
          });
          localStorage.removeItem("yf-order-draft-v2");
          setSaved(true);
        } catch {
          setError(t(copy.couldNotSaveYourDraftIsStill, copy.urdu390));
        }
      }}
    >
      <div className="form-step-heading">
        <strong>
          {review
            ? t(copy.step2Of2, copy.label22)
            : t(copy.step1Of2, copy.label12)}
        </strong>
        <span>
          {review
            ? t(copy.reviewOrder, copy.urdu391)
            : t(copy.orderDetails, copy.urdu336)}
        </span>
      </div>
      {!review ? (
        <>
          <Choices
            label={t(copy.customer, copy.urdu40)}
            value={d.customer}
            options={[
              copy.lahoreKnitwear,
              copy.styleTextile,
              copy.sapphireFinishing,
              copy.masoodTextile,
            ].map((c) => ({ value: c, label: c }))}
            onChange={(v) => set("customer", v)}
          />
          <Choices
            label={t(copy.fabricAndGsm, copy.urdu392)}
            value={d.fabric}
            options={[
              copy.singleJersey160Gsm,
              copy.fleece280Gsm,
              copy.poloPk200Gsm,
              copy.thermal220Gsm,
            ].map((f) => ({ value: f, label: f }))}
            onChange={(v) => set("fabric", v)}
          />
          <Choices
            label={t(copy.yarnSpecification, copy.urdu148)}
            value={d.spec}
            options={lots.map((l) => ({ value: l.spec, label: <bdi dir="ltr">{l.spec}</bdi> }))}
            onChange={(v) => set("spec", v)}
          />
          <label>
            {t(copy.requiredWeightKg, copy.urdu393)}
            <input
              required
              inputMode="decimal"
              value={d.weight}
              onChange={(e) => set("weight", e.target.value)}
              aria-invalid={!!weightError}
              aria-describedby={weightError ? "order-weight-error" : undefined}
            />
            {weightError && (
              <span className="field-error" id="order-weight-error">
                {weightError}
              </span>
            )}
          </label>
          <label>
            {t(copy.requiredBy, copy.urdu394)}
            <input
              required
              type="date"
              min={today()}
              value={d.due}
              onChange={(e) => set("due", e.target.value)}
              aria-invalid={!!dateError}
              aria-describedby={dateError ? "order-date-error" : undefined}
            />
            {dateError && (
              <span className="field-error" id="order-date-error">
                {dateError}
              </span>
            )}
          </label>
          <p className="draft-status">
            <CheckCheck size={18} />
            {t(copy.draftSavedOnThisDevice, copy.urdu46)}
          </p>
        </>
      ) : (
        <section className="entry-review">
          <h3>{t(copy.checkBeforeSaving, copy.urdu56)}</h3>
          <p className="register-line">
            {t(
              copy.orderSummary(
                d.customer,
                d.fabric,
                d.spec,
                fmt(Number(d.weight), 3),
                displayDate(d.due),
              ),
              copy.orderSummaryUr(
                d.customer,
                d.fabric,
                d.spec,
                fmt(Number(d.weight), 3),
                displayDate(d.due, true),
              ),
            )}
          </p>
          <p>{t(copy.ordersDoNotReserveStockCheckAvailable, copy.urdu395)}</p>
        </section>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        {review && (
          <Button onClick={() => setReview(false)}>
            {t(copy.back, copy.urdu61)}
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={!!weightError || !!dateError || !d.weight}
        >
          {review
            ? t(copy.saveOrder, copy.urdu396)
            : t(copy.reviewOrder, copy.urdu391)}
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
        {t(copy.previewAndValidateACsvFileHere, copy.csv5)}
      </div>
      <section className="panel import-panel">
        <div className="step-indicator">
          <span className="current">{copy.label1}</span>
          <b>{t(copy.chooseAFile, copy.urdu397)}</b>
          <div />
          <span className={rows.length ? "current" : ""}>{copy.label2}</span>
          <b>{t(copy.reviewRows, copy.urdu398)}</b>
          <div />
          <span className={accepted ? "current" : ""}>{copy.label3}</span>
          <b>{t(copy.savePreview, copy.urdu399)}</b>
        </div>
        <label className="upload-zone">
          <Upload size={36} />
          <strong>
            {fileName || t(copy.bringYourRegisterIntoView, copy.urdu400)}
          </strong>
          <span>{t(copy.chooseACsvFileMaximum2Mb, copy.csv6)}</span>
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
                setError(t(copy.chooseAFileSmallerThan2Mb, copy.urdu401));
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
                    copy.useTheTemplateColumnsLotSpecCartons,
                    copy.lotSpecCartonsWeightKg,
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
          {t(copy.downloadCsvTemplate, copy.csv7)}
        </button>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {rows.length > 0 && (
          <>
            <ScrollTable>
              <table>
                <thead>
                  <tr>
                    {rows[0].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                    <th>{t(copy.check, copy.urdu402)}</th>
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
                              ? t(copy.validPreview, copy.urdu403)
                              : t(copy.checkLotOrQuantity, copy.urdu404)}
                          </Status>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollTable>
            <div className="modal-actions">
              <span className="muted">
                {rows.length - 1} {t(copy.rowsFoundFirst100Shown, copy.urdu405)}
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
                      copy.importPreviewSavedNoStockMovementsWere,
                      copy.urdu406,
                    ),
                  );
                }}
              >
                {accepted
                  ? t(copy.previewSaved, copy.urdu399)
                  : t(copy.savePreviewLocally, copy.urdu407)}
              </Button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
