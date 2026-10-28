# Scanner outcome artwork

The scanner result view connects these assets to accepted API predictions through `src/scanner-artwork.ts` and `src/ScannerArtwork.tsx`. Fabric, treatment, fibre family, garment, and verdict use separate mappings. Null or unknown labels use the uncertainty artwork; candidates, care-label claims, and custom heads never select an unrelated illustration. Production uses the smaller still assets with the same CSS float and reduced-motion support.

Open `index.html` to review all 53 named outcomes, backed by 52 unique illustrations: 49 newly generated and the three original cotton, denim, and polyester cutouts. Denim also illustrates the pants garment group.

- `animated/`: transparent 256 × 256 animated WebP, seamless 4.2-second floating loop. The encoder can merge identical adjacent frames while preserving their duration.
- `still/`: transparent 512 × 512 WebP for CSS animation or reduced-motion presentation. Atlas illustrations were generated at roughly 314 pixels per cell; the standalone uncertainty image and original cutouts have larger sources.
- `manifest.json`: complete mapping for 27 fabrics, four fibre families, four treatments, 14 garment groups, three verification outcomes, and uncertain detection.
- `sources/`: original generated atlases and uncertainty image, preserved unchanged.

These are illustrative assets, not scanner evidence. Exact composition comes from care-label information. Blend exists in the taxonomy but is not currently trained. Factory-defined custom heads can add arbitrary labels and are outside the fixed taxonomy.

The gallery supports pause/play and respects the operating system’s reduced-motion preference by loading still images. Production integration should do the same; animated WebP itself cannot read a motion preference.

Regenerate exports from the repository root: `PYTHONPATH=scanner scanner/.venv/bin/python yarnflow/artwork/scanner-outcomes/build_assets.py` (Pillow required). This reads the current scanner taxonomies and fails if an outcome has no illustration.
