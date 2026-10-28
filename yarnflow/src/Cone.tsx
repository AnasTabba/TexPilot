import { useId } from 'react';

// Mills tell yarn apart by the colour of its cone tube. Each material keeps one tube colour,
// assigned by the order it was added, and shows it wherever that material appears.
const hues = ['#2f6fd6', '#c2417f', '#0f8a8a', '#4a4540', '#a4502a', '#5b6b7a'];
export const materialHue = (products: { id: string }[], productId?: string) =>
  hues[Math.max(0, products.findIndex(p => p.id === productId)) % hues.length];

/** A cross-wound yarn cone on its kraft tube, wound in the material's colour. */
export function Cone({ hue, size = 24 }: { hue: string; size?: number }) {
  const clip = useId();
  return <svg className="yf-cone" width={size * 2 / 3} height={size} viewBox="0 0 16 24" aria-hidden="true">
    <path d="M6.3 .8h3.4l.6 4.4H5.7z" fill="#b98a5c" />
    <ellipse cx="8" cy=".9" rx="1.7" ry=".5" fill="#7d5a38" />
    <path d="M2 20.2Q8 22.4 14 20.2l-.3 1.9Q8 24.4 2.3 22.1z" fill="#b98a5c" />
    <clipPath id={clip}><path d="M5.2 4.8Q8 3.7 10.8 4.8l3.4 15.6Q8 22.6 1.8 20.4z" /></clipPath>
    <g clipPath={`url(#${clip})`}>
      <rect width="16" height="24" fill={hue} />
      <path d="M-2 8 18 2M-2 12 18 6M-2 16 18 10M-2 20 18 14M-2 24 18 18M-2 2 18 8M-2 6 18 12M-2 10 18 16M-2 14 18 20M-2 18 18 24" stroke="#fff" strokeOpacity=".22" strokeWidth=".45" />
    </g>
  </svg>;
}
