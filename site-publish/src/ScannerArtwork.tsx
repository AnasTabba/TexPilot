import { scannerArtworkId, type ArtworkKind } from "./scanner-artwork";
import "./scanner-artwork.css";

// Vite emits small still assets. CSS supplies the same float as the exported WebP loops.
// Importing URLs keeps image bytes out of the JavaScript bundle.
const images = import.meta.glob<string>("../artwork/scanner-outcomes/still/*.webp", {
  eager: true,
  import: "default",
  query: "?url",
});

export default function ScannerArtwork({ kind, label }: {
  kind: ArtworkKind;
  label?: string | null;
}) {
  const id = scannerArtworkId(kind, label);
  return (
    <span className="scanner-artwork" data-artwork-kind={kind} data-artwork-id={id} aria-hidden="true">
      <img
        key={id}
        src={images[`../artwork/scanner-outcomes/still/${id}.webp`]}
        alt=""
        width={72}
        height={72}
        loading="lazy"
        decoding="async"
      />
    </span>
  );
}
