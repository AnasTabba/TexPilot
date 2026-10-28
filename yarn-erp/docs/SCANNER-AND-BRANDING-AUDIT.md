# Scanner and branding verification — 25 October 2026

- Live inference: unavailable. Port 8000 has no listener; web proxy /api/v1/model returns HTTP 500. Configured models/scanner-v6/bundle.json and heads.safetensors are absent. Do not run a stub as if it were the trained scanner.
- Web: existing readiness check, multipart surface/label upload, accepted-head artwork mapping and reduced-motion-aware CSS float are retained. Unknown labels map to uncertain, never a confident illustration.
- Native: added model-readiness check and stub rejection; connected the same outcome manifest and all bundled stills, with matching float motion and Reduce Motion support. Result structure/fibre/treatment/garment/verdict rows select images only from accepted labels. Review mode is explicitly illustrative.
- Readability: fixed sidebar scanner prompt foreground in normal, hover and focus states. Browser-computed foreground rgb(38,51,27) on background rgb(234,240,223), rendered 18px text.
- Brand: user-supplied spool/checkmark recolored using ImageGen; installed web PNG/SVG compatibility icon, favicon PNG/ICO, 192/512 PWA icons, Apple touch icon, native BrandLogo and iOS app icon sizes. Manifest and theme metadata use the approved palette.
- Builds and Node tests rerun. Live end-to-end model tests remain blocked by missing trained weights; successful compilation does not certify live inference.
