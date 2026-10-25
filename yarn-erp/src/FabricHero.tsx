import { useEffect, useState } from "react";
import { ArrowRight, Layers, Maximize } from "lucide-react";
import denim from "./assets/fabrics/denim.webp";
import cotton from "./assets/fabrics/cotton.webp";
import polyester from "./assets/fabrics/polyester.webp";
import "./fabric-hero.css";

type T = (en: string, ur?: string) => string;
export type Art = "denim" | "cotton" | "polyester";
// Illustrations from feat/app-scaffold (app/assets/fabrics): reference artwork, not scan evidence.
export const artwork: Record<Art, string> = { denim, cotton, polyester };

const slides: {
  art: Art;
  tag: [string, string];
  title: [string, string];
  body: [string, string];
}[] = [
  {
    art: "denim",
    tag: ["1 · MADE OF", "۱ · کس چیز سے بنا"],
    title: ["What is it made of?", "یہ کس چیز سے بنا ہے؟"],
    body: [
      "Cotton, polyester, or a blend? Start with one photo.",
      "کاٹن، پولیسٹر یا مکس؟ ایک تصویر سے شروع کریں۔",
    ],
  },
  {
    art: "cotton",
    tag: ["2 · FABRIC", "۲ · کپڑا"],
    title: ["Which fabric is it?", "یہ کون سا کپڑا ہے؟"],
    body: [
      "Denim, jersey, twill, fleece and 23 more.",
      "ڈینم، جرسی، ٹوِل، فلیس اور ۲۳ مزید۔",
    ],
  },
  {
    art: "polyester",
    tag: ["3 · YARN", "۳ · یارن"],
    title: ["Which yarn should you buy?", "کون سا یارن خریدیں؟"],
    body: [
      "The yarn to order to make the same fabric.",
      "وہی کپڑا بنانے کے لیے کون سا یارن منگوائیں۔",
    ],
  },
];

/** The fabric scanner's welcome panel, in feat/app-scaffold's design language. */
export default function FabricHero({
  t,
  onScan,
  busy,
}: {
  t: T;
  onScan: () => void;
  busy?: boolean;
}) {
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const id = setInterval(
      () => setSlide((s) => (s + 1) % slides.length),
      4200,
    );
    return () => clearInterval(id);
  }, [paused]);
  const s = slides[slide];
  return (
    <section
      className={`fabric-hero fabric-hero-${s.art}`}
      aria-roledescription="carousel"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="fabric-hero-brand">
        <Layers size={18} aria-hidden="true" />
        <span>
          texpilot<i>.</i>
        </span>
      </div>
      <p className="fabric-hero-eyebrow">
        {t("FABRIC SCANNER", "فیبرک اسکینر")}
      </p>
      <div className="fabric-hero-art" aria-hidden="true">
        <span className="fabric-hero-ring" />
        <span className="fabric-hero-circle" />
        {slides.map((x, i) => (
          <img
            key={x.art}
            src={artwork[x.art]}
            alt=""
            className={i === slide ? "is-active" : ""}
          />
        ))}
        <span className="fabric-hero-tag">
          <Maximize size={13} />
          {t(s.tag[0], s.tag[1])}
        </span>
      </div>
      <div aria-live="polite">
        <h2>{t(s.title[0], s.title[1])}</h2>
        <p>{t(s.body[0], s.body[1])}</p>
      </div>
      <div className="fabric-hero-dots">
        {slides.map((x, i) => (
          <button
            key={x.art}
            aria-label={t(x.title[0], x.title[1])}
            aria-pressed={i === slide}
            onClick={() => setSlide(i)}
          >
            <i />
          </button>
        ))}
      </div>
      <button className="fabric-hero-action" onClick={onScan} disabled={busy}>
        {t("Scan a fabric", "کپڑا اسکین کریں")}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
      <p className="fabric-hero-foot">
        {t(
          "A photo shows the look; the care label confirms the exact mix.",
          "تصویر ظاہری شکل بتاتی ہے؛ اصل مکس کیئر لیبل سے پکا ہوتا ہے۔",
        )}
      </p>
    </section>
  );
}
