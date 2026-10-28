# Material scanner — connection

The scanner screen lives at `/#/scanner`, appears in the sidebar and daily actions, and has a shortcut on Overview. It includes environment-facing live camera capture, image upload, a separate optional care-label photo, manual label correction, cancellation and error recovery, and real-result export. Camera tracks stop on capture, tab changes, analysis and leaving the screen. Photos stay in memory in the browser and are sent only when Analyze is chosen; the existing TexPilot server may retain them according to its ScanStore configuration.

## Exact main-branch contract

- `POST /api/v1/scan`: multipart `surface_image`, optional `label_image`, optional `label_text` (typed text overrides OCR).
- Results retain `scan_id`, verdict, garment, structure, treatment, fibre family, stated label composition, capture quality, flags, model version, KB version and timestamp.
- The UI distinguishes PASS, FLAG and INSUFFICIENT_EVIDENCE. Missing model heads are shown as insufficient evidence, never guessed. Fibre percentages are labelled as care-label evidence, never a photo composition measurement.
- Added `GET /api/v1/model` to the parent Python API for readiness. `/health` remains unchanged. An older API can connect through `/health`, but its model is labelled unverified until its actual scan result supplies a non-stub version.
- Stub outputs are blocked in both readiness and scan response parsing. No mock predictions are shipped.

## Run the real existing Python model

From `/Users/zuhairmerchant/TexPilot`:

```sh
make setup-ml
.venv/bin/python scripts/serve_yarnflow_scanner.py --bundle /absolute/path/to/scanner-v2
```

The bundle must contain `bundle.json` and `heads.safetensors`, plus any fine-tuned head files referenced by the metadata. The launcher forces `TEXPILOT_VISION=scanner` and refuses to substitute the stub if files are missing. The trained bundle was absent from this machine during implementation, so actual inference was not run.

For local development, start Yarnflow with `npm run dev -- --port 5174` and configure `http://127.0.0.1:8000` in Model connection. The Python API binds loopback by default. For the published site, deploy the model API to a trusted HTTPS origin, then enter that URL. The static Sites host does not run PyTorch or receive a copy of the weights.

`TEXPILOT_CORS_ORIGINS` controls exact allowed origins. Defaults are the existing private Yarnflow site and the two local development origins. Wildcards and browser credentials are not enabled. CORS is browser policy, not server authentication; retain whatever authentication and network controls the chosen model host requires.

`VITE_SCANNER_API_URL` is an optional public build-time default. The connection screen stores a URL on the device, not model weights or credentials. URLs with usernames, passwords, query tokens, fragments or non-HTTP schemes are refused; published HTTPS clients require HTTPS endpoints.

## Verification

- 17 frontend/domain tests pass, including eight scanner contract, URL, image validation, stub rejection, abstention and upload-error tests.
- 26 Python API/config/browser tests pass, including the existing scan and OCR contract and new readiness/CORS tests.
- Six scanner accessibility/overflow audits passed: EN and UR at 360/1440, plus desktop dark and phone Factory mode. These audit the initial connection/capture screen, not live model inference.
- A real local HTTP call and browser connection to an intentionally started stub server correctly reported `ready:false` and blocked analysis. That development server is never presented as a trained model.
- Physical camera capture, end-to-end trained model inference and the trained server's HTTPS deployment remain unverified until the real model bundle/server is available.
