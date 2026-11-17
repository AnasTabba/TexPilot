import manifest from "../artwork/scanner-outcomes/manifest.json" with { type: "json" };

export type ArtworkKind = "structure" | "fibre_family" | "treatment" | "garment" | "verdict";

const groups: Record<ArtworkKind, Readonly<Record<string, string>>> = {
  structure: manifest.groups.Fabric,
  fibre_family: manifest.groups["Fibre family"],
  treatment: manifest.groups.Treatment,
  garment: manifest.groups.Garment,
  verdict: manifest.groups.Verification,
};

// The taught garment head (models/custom/garment_type) names garments the detector doesn't; draw the nearest one.
const garmentAlias: Readonly<Record<string, string>> = {
  dupatta_shawl: "scarf", hoodie: "sweater", jeans: "pants", trousers: "pants", kurta: "shirt_blouse",
  shirt: "shirt_blouse", polo: "top_tshirt_sweatshirt", t_shirt: "top_tshirt_sweatshirt",
};

/** The picture for a model answer; a label with no picture gets none (null), never a generic stand-in. */
export function scannerArtworkId(kind: ArtworkKind, label?: string | null): string | null {
  const group = groups[kind];
  if (kind === "garment" && label && Object.hasOwn(garmentAlias, label)) label = garmentAlias[label];
  return label && Object.hasOwn(group, label) ? group[label] : null;
}
