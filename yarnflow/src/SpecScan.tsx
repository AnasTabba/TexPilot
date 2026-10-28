import { useState, type FormEvent } from "react";
import { Camera, Check, ClipboardCopy, LoaderCircle, Ruler, Scale, Shirt, TriangleAlert } from "lucide-react";
import { analyzeSpec, ScanError, type SpecResult } from "./scanner-client";
import { translate, useLanguage } from "./i18n";

/** The model server: the one the fabric scanner connected to, else this page's own origin
 * (the dev proxy serves /api/v1 there). */
function endpoint(): string {
  try {
    return localStorage.getItem("yf-scanner-endpoint") || location.origin;
  } catch {
    return location.origin;
  }
}

function message(e: unknown, language: 'en' | 'ur'): string {
  if (!(e instanceof ScanError)) return translate(language, "Something went wrong. Your inputs are still here; try again.", "کچھ غلط ہو گیا۔ آپ کی درج کردہ معلومات موجود ہیں؛ دوبارہ کوشش کریں۔");
  if (e.code === "invalid-image")
    return e.detail ? translate(language, e.detail) : translate(language, "This scan cannot be measured. Check the dpi and the weight.", "اس اسکین سے پیمائش نہیں ہو سکی۔ dpi اور وزن جانچیں۔");
  if (e.code === "too-large") return translate(language, "The scan is over 60 MB: crop it to the swatch and save again.", "اسکین 60 MB سے بڑا ہے۔ صرف کپڑے کا نمونہ کراپ کرکے دوبارہ محفوظ کریں۔");
  if (e.code === "unsupported") return translate(language, "Use a PNG, JPEG or TIFF scan (not HEIC).", "PNG، JPEG یا TIFF اسکین استعمال کریں؛ HEIC نہیں۔");
  if (e.code === "unreachable" || e.code === "timeout")
    return translate(language, "Could not reach the TexPilot server. Check that it is running.", "TexPilot سرور سے رابطہ نہیں ہو سکا۔ دیکھیں کہ سرور چل رہا ہے۔");
  return translate(language, "The server could not analyse this scan. Your inputs are still here; try again.", "سرور اس اسکین کا تجزیہ نہیں کر سکا۔ آپ کی درج کردہ معلومات موجود ہیں؛ دوبارہ کوشش کریں۔");
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
  const { language, t } = useLanguage();
  const [scan, setScan] = useState<File | null>(null);
  const [dpi, setDpi] = useState("");
  const [cardMm, setCardMm] = useState("");
  const [construction, setConstruction] = useState<"woven" | "knit">("woven");
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState<"gsm" | "oz">("gsm");
  const [labelText, setLabelText] = useState("");
  const [label, setLabel] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ cause: unknown } | null>(null);
  const [result, setResult] = useState<SpecResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(e: FormEvent) {
    e.preventDefault();
    if (!scan) return;
    setBusy(true);
    setError(null);
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
      setError({ cause: err });
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
            <h2>{t('Yarn count', 'دھاگے کا کاؤنٹ')}</h2>
            <p>{t('Measure the threads and yarn count from a photo with the reference card.', 'ریفرنس کارڈ کے ساتھ تصویر سے کپڑے کے دھاگے اور یارن کاؤنٹ کی پیمائش کریں۔')}</p>
          </div>
          <Ruler size={22} aria-hidden="true" />
        </div>
        <details className="spec-guide">
          <summary>{t('How to take the photo', 'تصویر کیسے لیں')}</summary>
          <ol className="spec-steps">
            <li><Camera size={22} aria-hidden="true" /><span><strong>{t('Photo', 'تصویر')}</strong> {t('Lay the', 'کپڑے پر')} <a href="/texpilot-card.svg" target="_blank" rel="noreferrer">{t('printed TexPilot card', 'پرنٹ کیا ہوا TexPilot کارڈ')}</a> {t('on the fabric and take a photo from about 15 cm.', 'رکھیں اور تقریباً 15 cm دور سے تصویر لیں۔')}</span></li>
            <li><Scale size={22} aria-hidden="true" /><span><strong>{t('Weight', 'وزن')}</strong> {t('Weigh a 10 × 10 cm piece. Optional, but needed for the yarn count.', '10 × 10 cm کے ٹکڑے کا وزن کریں۔ یہ اختیاری ہے، لیکن یارن کاؤنٹ کے لیے ضروری ہے۔')}</span></li>
            <li><Shirt size={22} aria-hidden="true" /><span><strong>{t('Woven or knit', 'وون یا نِٹ')}</strong> {t('Pick one, then tap Work out the yarn.', 'ایک چنیں، پھر «دھاگے کا حساب لگائیں» دبائیں۔')}</span></li>
          </ol>
        </details>
        <form className="spec-form" onSubmit={run}>
          <label>
            {t('1. Photo of the fabric with the card', '1. کارڈ کے ساتھ کپڑے کی تصویر')}
            <input
              type="file"
              accept="image/png,image/jpeg,image/tiff,.tif,.tiff"
              required
              onChange={(e) => setScan(e.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            {t('2. Weight', '2. وزن')} ({unit === "gsm" ? t('g/m²: grams of a 10 × 10 cm piece × 100', 'g/m²: دس بائی دس سینٹی میٹر کے ٹکڑے کا وزن گرام میں × 100') : "oz/yd²"}, {t('optional', 'اختیاری')})
            <input
              type="number"
              dir="ltr"
              inputMode="decimal"
              min={0}
              step="any"
              placeholder={unit === "gsm" ? t('e.g. 180', 'مثلاً 180') : t('e.g. 11.5', 'مثلاً 11.5')}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </label>
          <fieldset className="spec-choice">
            <legend>{t('3. Woven or knit', '3. وون یا نِٹ')}</legend>
            {(["woven", "knit"] as const).map((c) => (
              <label key={c}>
                <input
                  type="radio"
                  name="construction"
                  checked={construction === c}
                  onChange={() => setConstruction(c)}
                />
                {c === "woven" ? t('Woven (denim, twill, poplin)', 'وون (ڈینم، ٹوئل، پاپلن)') : t('Knit (jersey, pique)', 'نِٹ (جرسی، پیکے)')}
              </label>
            ))}
          </fieldset>
          <details className="spec-more">
            <summary>{t('More options', 'مزید اختیارات')}</summary>
            <label>
              {t('Weight unit', 'وزن کی اکائی')}
              <select dir="ltr" value={unit} onChange={(e) => setUnit(e.target.value as "gsm" | "oz")}>
                <option value="gsm">g/m²</option>
                <option value="oz">oz/yd²</option>
              </select>
            </label>
            <label>
              {t('Flatbed scan resolution (dpi), if you scanned instead of using the card', 'اگر کارڈ کے بجائے فلیٹ بیڈ اسکینر استعمال کیا ہے تو اسکین کی ریزولوشن (dpi)')}
              <input
                type="number"
                dir="ltr"
                inputMode="numeric"
                min={300}
                max={4800}
                placeholder={t('Read from the scan or the card', 'اسکین یا کارڈ سے پڑھ کر درج کریں')}
                value={dpi}
                onChange={(e) => setDpi(e.target.value)}
              />
            </label>
            <label>
              {t("Card's black square, if your print is not 30 mm", 'اگر پرنٹ میں کارڈ کا سیاہ مربع 30 mm نہیں تو اس کا سائز')}
              <input
                type="number"
                dir="ltr"
                inputMode="decimal"
                min={10}
                max={100}
                step="any"
                placeholder="30"
                value={cardMm}
                onChange={(e) => setCardMm(e.target.value)}
              />
            </label>
            <label>
              {t('Care label text', 'کیئر لیبل کی عبارت')}
              <input
                type="text"
                placeholder={t('e.g. 98% cotton, 2% elastane', 'مثلاً 98% کاٹن، 2% الاسٹین')}
                value={labelText}
                onChange={(e) => setLabelText(e.target.value)}
              />
            </label>
            <label>
              {t('Or a photo of the care label', 'یا کیئر لیبل کی تصویر')}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setLabel(e.target.files?.[0] ?? null)}
              />
            </label>
          </details>
          <button className="button primary" type="submit" disabled={!scan || busy}>
            {busy ? <LoaderCircle className="spin" size={18} /> : <Ruler size={18} />}
            {busy ? t('Measuring the threads…', 'دھاگوں کی پیمائش ہو رہی ہے…') : t('Work out the yarn', 'دھاگے کا حساب لگائیں')}
          </button>
        </form>
        {error && (
          <p className="spec-error" role="alert">
            <TriangleAlert size={18} aria-hidden="true" /> {message(error.cause, language)}
          </p>
        )}
      </section>

      {result && (
        <section className="live-panel spec-result" aria-live="polite">
          <div className="live-panel-heading">
            <div>
              <h2>{t('Yarn to order', 'خریدنے کے لیے دھاگا')}</h2>
              <p>{t('Measured from your scan; check the first orders against a pick glass.', 'یہ پیمائش آپ کے اسکین سے ہے؛ پہلے آرڈر کی پک گلاس سے تصدیق کریں۔')}</p>
            </div>
            <button
              className="button"
              type="button"
              onClick={async () => setCopied(await copy(result.yarn_order.join("\n")))}
            >
              {copied ? <Check size={16} /> : <ClipboardCopy size={16} />}
              {copied ? t('Copied', 'کاپی ہو گیا') : t('Copy', 'کاپی کریں')}
            </button>
          </div>
          <ul className="spec-order">
            {result.yarn_order.map((line) => (
              <li key={line}>{t(line)}</li>
            ))}
          </ul>
          <dl className="spec-measures">
            {result.weave && (
              <div>
                <dt>{t('Weave', 'بُنائی')}</dt>
                <dd>{t(result.weave)}</dd>
              </div>
            )}
            <div>
              <dt>{knit ? t('Wales per inch', 'فی انچ ویلز') : t('Ends per inch (warp)', 'فی انچ تانے کے دھاگے')}</dt>
              <dd dir="ltr">{result.density.ends_per_inch.toFixed(1)}</dd>
            </div>
            <div>
              <dt>{knit ? t('Courses per inch', 'فی انچ کورسز') : t('Picks per inch (weft)', 'فی انچ بانے کے دھاگے')}</dt>
              <dd dir="ltr">{result.density.picks_per_inch.toFixed(1)}</dd>
            </div>
            <div>
              <dt>{t('Scale', 'پیمائش کا حوالہ')}</dt>
              <dd>
                {result.scale_source === "card" ? t('card', 'کارڈ') : t('scan', 'اسکین')}, <span dir="ltr">{result.dpi.toFixed(0)} ppi</span>
              </dd>
            </div>
            <div>
              <dt>{t('Agreement', 'پیمائش کی یکسانیت')}</dt>
              <dd>
                {t(`${result.density.tiles} areas within ${result.density.spread_pct.toFixed(1)}%`, `${result.density.tiles} حصوں میں ${result.density.spread_pct.toFixed(1)}% کے اندر فرق`)}
              </dd>
            </div>
            <div>
              <dt>{t('Weight', 'وزن')}</dt>
              <dd>{result.weight_gsm ? <span dir="ltr">{result.weight_gsm.toFixed(0)} g/m²</span> : t('not given', 'درج نہیں')}</dd>
            </div>
            {result.yarn && (
              <div>
                <dt>{knit ? t('Yarn count', 'دھاگے کا کاؤنٹ') : t('Warp count', 'تانے کا کاؤنٹ')}</dt>
                <dd dir="ltr">
                  Ne {result.yarn.warp_ne[0].toFixed(1)}–{result.yarn.warp_ne[1].toFixed(1)}
                </dd>
              </div>
            )}
            {result.yarn?.weft_ne && (
              <div>
                <dt>{t('Weft count', 'بانے کا کاؤنٹ')}</dt>
                <dd dir="ltr">
                  Ne {result.yarn.weft_ne[0].toFixed(1)}–{result.yarn.weft_ne[1].toFixed(1)}
                </dd>
              </div>
            )}
          </dl>
          {result.yarn && <p className="spec-basis">{t('Assumes:', 'بنیاد:')} {t(result.yarn.basis)}.</p>}
          {!!result.flags.length && (
            <ul className="spec-flags">
              {result.flags.map((f) => (
                <li key={f.code} data-severity={f.severity}>
                  {t(f.message)}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
