import { useState, type FormEvent } from "react";
import { Check, ClipboardCopy, LoaderCircle, Ruler, TriangleAlert } from "lucide-react";
import { analyzeSpec, ScanError, type SpecResult } from "./scanner-client";
import "./spec.css";

/** The model server: the one the fabric scanner connected to, else this page's own origin
 * (the dev proxy serves /api/v1 there). */
function endpoint(): string {
  try {
    return localStorage.getItem("yf-scanner-endpoint") || location.origin;
  } catch {
    return location.origin;
  }
}

function message(e: unknown): string {
  if (!(e instanceof ScanError)) return "Something went wrong. Your inputs are still here; try again.";
  if (e.code === "invalid-image")
    return e.detail || "This scan cannot be measured. Check the dpi and the weight.";
  if (e.code === "too-large") return "The scan is over 60 MB: crop it to the swatch and save again.";
  if (e.code === "unsupported") return "Use a PNG, JPEG or TIFF scan (not HEIC).";
  if (e.code === "unreachable" || e.code === "timeout")
    return "Could not reach the TexPilot server. Check that it is running.";
  return "The server could not analyse this scan. Your inputs are still here; try again.";
}

/** Copy, with a fallback: the clipboard API needs HTTPS, phones on the LAN use plain HTTP. */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export default function SpecScan() {
  const [scan, setScan] = useState<File | null>(null);
  const [dpi, setDpi] = useState("");
  const [cardMm, setCardMm] = useState("");
  const [construction, setConstruction] = useState<"woven" | "knit">("woven");
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState<"gsm" | "oz">("gsm");
  const [labelText, setLabelText] = useState("");
  const [label, setLabel] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SpecResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(e: FormEvent) {
    e.preventDefault();
    if (!scan) return;
    setBusy(true);
    setError("");
    setResult(null);
    setCopied(false);
    try {
      setResult(
        await analyzeSpec(endpoint(), scan, {
          dpi: Number(dpi) || undefined,
          cardMm: Number(cardMm) || undefined,
          construction,
          weight: Number(weight) || undefined,
          unit,
          labelText,
          label,
        }),
      );
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const knit = result?.construction === "knit";
  return (
    <div className="spec-scan">
      <section className="live-panel">
        <div className="live-panel-heading">
          <div>
            <h2>Yarn spec</h2>
            <p>
              Find the yarn to order for a fabric. Scan it flat on a flatbed scanner at 1200 dpi,
              selvedge running up the glass. No scanner? Lay the{" "}
              <a href="/texpilot-card.svg" target="_blank" rel="noreferrer">
                printed TexPilot card
              </a>{" "}
              on the fabric and photograph both from about 15 cm. Then weigh a 10 x 10 cm piece.
            </p>
          </div>
          <Ruler size={22} aria-hidden="true" />
        </div>
        <form className="spec-form" onSubmit={run}>
          <label>
            Fabric scan, or photo with the card (PNG, JPEG or TIFF)
            <input
              type="file"
              accept="image/png,image/jpeg,image/tiff,.tif,.tiff"
              required
              onChange={(e) => setScan(e.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Scan resolution (dpi)
            <input
              type="number"
              inputMode="numeric"
              min={300}
              max={4800}
              placeholder="Read from the scan or the card"
              value={dpi}
              onChange={(e) => setDpi(e.target.value)}
            />
          </label>
          <label>
            Card's black square measures (mm, optional)
            <input
              type="number"
              inputMode="decimal"
              min={10}
              max={100}
              step="any"
              placeholder="30"
              value={cardMm}
              onChange={(e) => setCardMm(e.target.value)}
            />
          </label>
          <fieldset className="spec-choice">
            <legend>Fabric</legend>
            {(["woven", "knit"] as const).map((c) => (
              <label key={c}>
                <input
                  type="radio"
                  name="construction"
                  checked={construction === c}
                  onChange={() => setConstruction(c)}
                />
                {c === "woven" ? "Woven (denim, twill, poplin)" : "Knit (jersey, pique)"}
              </label>
            ))}
          </fieldset>
          <div className="spec-weight">
            <label>
              Fabric weight
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                placeholder={unit === "gsm" ? "e.g. 180" : "e.g. 11.5"}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </label>
            <label>
              Unit
              <select value={unit} onChange={(e) => setUnit(e.target.value as "gsm" | "oz")}>
                <option value="gsm">g/m²</option>
                <option value="oz">oz/yd²</option>
              </select>
            </label>
            <p>10 x 10 cm swatch: grams x 100 = g/m². Without it you get the thread count only.</p>
          </div>
          <label>
            Care label text (optional)
            <input
              type="text"
              placeholder="e.g. 98% cotton, 2% elastane"
              value={labelText}
              onChange={(e) => setLabelText(e.target.value)}
            />
          </label>
          <label>
            Or a photo of the care label (optional)
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setLabel(e.target.files?.[0] ?? null)}
            />
          </label>
          <button className="button primary" type="submit" disabled={!scan || busy}>
            {busy ? <LoaderCircle className="spin" size={18} /> : <Ruler size={18} />}
            {busy ? "Measuring the threads…" : "Work out the yarn"}
          </button>
        </form>
        {error && (
          <p className="spec-error" role="alert">
            <TriangleAlert size={18} aria-hidden="true" /> {error}
          </p>
        )}
      </section>

      {result && (
        <section className="live-panel spec-result" aria-live="polite">
          <div className="live-panel-heading">
            <div>
              <h2>Yarn to order</h2>
              <p>Measured from your scan; check the first orders against a pick glass.</p>
            </div>
            <button
              className="button"
              type="button"
              onClick={async () => setCopied(await copy(result.yarn_order.join("\n")))}
            >
              {copied ? <Check size={16} /> : <ClipboardCopy size={16} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <ul className="spec-order">
            {result.yarn_order.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <dl className="spec-measures">
            <div>
              <dt>{knit ? "Wales per inch" : "Ends per inch (warp)"}</dt>
              <dd>{result.density.ends_per_inch.toFixed(1)}</dd>
            </div>
            <div>
              <dt>{knit ? "Courses per inch" : "Picks per inch (weft)"}</dt>
              <dd>{result.density.picks_per_inch.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Scale</dt>
              <dd>
                {result.scale_source === "card" ? "card" : "scan"}, {result.dpi.toFixed(0)} ppi
              </dd>
            </div>
            <div>
              <dt>Agreement</dt>
              <dd>
                {result.density.tiles} areas within {result.density.spread_pct.toFixed(1)}%
              </dd>
            </div>
            <div>
              <dt>Weight</dt>
              <dd>{result.weight_gsm ? `${result.weight_gsm.toFixed(0)} g/m²` : "not given"}</dd>
            </div>
            {result.yarn && (
              <div>
                <dt>{knit ? "Yarn count" : "Warp count"}</dt>
                <dd>
                  Ne {result.yarn.warp_ne[0].toFixed(1)}–{result.yarn.warp_ne[1].toFixed(1)}
                </dd>
              </div>
            )}
            {result.yarn?.weft_ne && (
              <div>
                <dt>Weft count</dt>
                <dd>
                  Ne {result.yarn.weft_ne[0].toFixed(1)}–{result.yarn.weft_ne[1].toFixed(1)}
                </dd>
              </div>
            )}
          </dl>
          {result.yarn && <p className="spec-basis">Assumes: {result.yarn.basis}.</p>}
          {!!result.flags.length && (
            <ul className="spec-flags">
              {result.flags.map((f) => (
                <li key={f.code} data-severity={f.severity}>
                  {f.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
