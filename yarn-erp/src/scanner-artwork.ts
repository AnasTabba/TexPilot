import manifest from "../artwork/scanner-outcomes/manifest.json" with { type: "json" };

export type ArtworkKind = "structure" | "fibre_family" | "treatment" | "garment" | "verdict";

const groups: Record<ArtworkKind, Readonly<Record<string, string>>> = {
  structure: manifest.groups.Fabric,
  fibre_family: manifest.groups["Fibre family"],
  treatment: manifest.groups.Treatment,
  garment: manifest.groups.Garment,
  verdict: manifest.groups.Verification,
};

/** Only accepted predictions choose artwork; candidates and label claims are not inputs. */
export function scannerArtworkId(kind: ArtworkKind, label?: string | null): string {
  const group = groups[kind];
  return label && Object.hasOwn(group, label) ? group[label] : "uncertain";
}
