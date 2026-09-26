# TexPilot app (P3)

The phone client for the fabric verification scanner. Expo SDK 57, React Native,
TypeScript, Expo Router.

**Docs in this folder:** `AGENTS.md` (rules for anyone — human or AI agent — changing
the app), `DESIGN.md` (product rules and design system; read before any UI change),
and this file (running the app, task board).

It works end-to-end today: photograph a fabric, type the care-label text, and get a
verdict back from the live API. Until P1 lands a model, that verdict is always
`INSUFFICIENT_EVIDENCE`. That is correct behaviour, not a bug.

## Run it

```bash
# once
make setup          # repo root: Python venv for the API
make app-setup      # app JS deps

# every time, two terminals
make api-lan        # API on 0.0.0.0:8000 so the phone can reach it
make app            # Expo dev server -- scan the QR code with Expo Go
```

**Point the app at your laptop.** On a phone, `127.0.0.1` is the phone itself:

```bash
cp app/.env.example app/.env.local
ipconfig getifaddr en0          # your laptop's LAN IP, e.g. 192.168.1.23
# set EXPO_PUBLIC_API_URL=http://192.168.1.23:8000 in .env.local, then reload the app
```

The home screen shows the API URL and whether it is reachable. Check it first when
something doesn't work. Phone and laptop must be on the same wifi, and university
networks often block device-to-device traffic. A phone hotspot works.

**Web preview** (`npm run web`) is handy for UI work, but the API has no CORS headers
yet, so the browser can't read its responses. It will show "Unreachable". Use a phone
for anything that talks to the API.

## Checks

```bash
npm run check       # typecheck + lint + format check + tests; CI runs the same
npm test            # jest only
npm run format      # prettier --write
```

## Layout

```
src/
  app/                 routes only (Expo Router): every file is a screen
    _layout.tsx        root stack + header styling
    index.tsx          home: start a scan, API status
    scan/surface.tsx   step 1: fabric photo
    scan/label.tsx     step 2: care-label text (T3 turns this into a photo + OCR)
    scan/review.tsx    step 3: confirm and submit
    result/[scanId].tsx
    history.tsx
  features/            one folder per capability; each exposes an index.ts
    capture/           camera, framing guide, quality gate (quality.ts)
    scan/              the in-progress draft + submit hook
    verdict/           rendering a ScanResult: banner, heads, composition, flags
    history/           persisted past results
    queue/             offline queue: contract only, not implemented (T5)
  api/
    client.ts          fetch wrapper, timeouts, ApiError (network | timeout | http)
    scan.ts            submitScan(), getHealth()
    schema.gen.ts      GENERATED from services/api/schemas.py; never edit by hand
    types.ts           friendly names for the generated types
    fixtures.ts        one sample ScanResult per verdict, for tests and UI work
  components/ui/       Button, Card, Screen, Text, TextField
  theme/               colour, spacing, radius, type tokens
  config/env.ts        EXPO_PUBLIC_* config
  hooks/               shared hooks (useApiHealth)
```

## Conventions

1. **Screens are thin.** A file in `src/app/` wires features together and navigates.
   Logic, state and anything reusable live in `src/features/`.
2. **Import a feature through its index**: `@/features/verdict`, not
   `@/features/verdict/components/...`. ESLint enforces this. Inside a feature, use
   relative imports.
3. **Never put tests or helpers in `src/app/`.** Expo Router would treat them as
   routes. Tests sit next to the code they test, as `*.test.ts(x)`.
4. **No hard-coded colours or spacing.** Use `@/theme`. Verdict colours live there too.
5. **The API contract is generated.** When `services/api/schemas.py` changes, run
   `npm run gen:api` and commit `schema.gen.ts`. CI fails if the two drift.
6. **Add native packages with `npx expo install <pkg>`**, not `npm install`. It picks
   the SDK-compatible version. Packages outside Expo Go need a dev build
   (`npx expo run:ios|android`).
7. **Never guess on the user's behalf** (repo house rule #2). A head the model
   declined shows "Not determined". An unreadable label is not a composition.
   `INSUFFICIENT_EVIDENCE` is a normal result with a neutral tone, never an error screen.
8. **Tests first** for logic (stores, quality checks, formatting). Use
   `@testing-library/react-native` for components, with `api/fixtures.ts` as input.

## Task board

Branch as `feat/app-<thing>`. Each task names where the work goes and when it counts
as done. Spec references are to
`docs/superpowers/specs/2026-09-20-fabric-verification-scanner-design.md`.

| #   | Task                               | Where                                     | Size | Depends on      |
| --- | ---------------------------------- | ----------------------------------------- | ---- | --------------- |
| T1  | Camera polish                      | `features/capture/`                       | S    | –               |
| T2  | **Capture-quality gate**           | `features/capture/quality.ts`             | L    | –               |
| T3  | Care-label photo + OCR             | `app/scan/label.tsx`, new `features/ocr/` | L    | P2 contract     |
| T4  | Send capture metrics with the scan | `api/scan.ts`                             | S    | T2, P2 contract |
| T5  | **Offline queue**                  | `features/queue/`                         | L    | T6              |
| T6  | Keep scan images on device         | `features/history/`                       | M    | –               |
| T7  | Result screen detail               | `features/verdict/`                       | M    | –               |
| T8  | Settings: API URL + operator       | new `app/settings.tsx`                    | S    | –               |
| T9  | App identity: icon, splash, name   | `app.json`, `assets/`                     | S    | –               |
| T10 | E2E test of the scan flow          | `.maestro/`                               | M    | –               |

**T1 · Camera polish.** Torch toggle, tap to focus. When permission is denied for
good, offer a button that opens system settings. _Done:_ usable in a dim
goods-in bay; a denied user has a way forward.

**T2 · Capture-quality gate** (spec §4.4, §7). This is the cheapest accuracy win in
the project. Replace the stub in `quality.ts`, keeping its signature. Blur is the
variance of the Laplacian on a downscaled greyscale copy (e.g. `expo-image-manipulator`
to ~256 px, then decode and compute in JS). Exposure comes from the luminance
histogram (clipped highlights and crushed shadows). Framing can start as "enough of
the frame is textured". Calibrate the thresholds on real phone captures, not guesses.
_Done:_ the `test.todo`s in `quality.test.ts` are real passing tests; a blurry photo
is rejected with an operator-facing reason and nothing is uploaded; `checked: true`.

**T3 · Care-label photo + OCR** (spec §4.2). Add a second capture for the label.
Agree with P2 first: on-device OCR (ML Kit / Apple Vision, which needs a dev build,
not Expo Go) or server-side (the API accepting `label_image`). Keep typed entry as a
fallback. _Done:_ a photographed label produces `stated_composition` without typing.

**T4 · Send capture metrics.** The request has no field for `capture_quality` yet.
Propose one to P2, then send `QualityReport.metrics`. _Done:_ the metrics are stored
server-side with the scan (spec §9).

**T5 · Offline queue** (spec §4.4, §7). The full contract is in
`features/queue/index.ts`. Retryable failures (`ApiError.isRetryable`) queue
instead of erroring. The queue persists across restarts, flushes on reconnect,
uploads in order, and never retries a 4xx. Hook it in at the `TODO(T5)` in
`features/scan/useSubmitScan.ts`. _Done:_ in airplane mode a scan shows as pending;
it uploads by itself when the network returns, including after an app restart.

**T6 · Keep scan images on device.** Camera URIs are temporary cache files. Copy the
surface photo into app storage (`expo-file-system`) and store its path with the
history entry. Show thumbnails in history and on the result screen. Cap the disk
usage. _Done:_ images survive a restart. T5 relies on this.

**T7 · Result screen detail.** Expandable top-k per head, confidence bars, flag
severity styling. Build it against `api/fixtures.ts`; no model is needed. _Done:_
all three verdicts look right with fixture data, with component tests for each.

**T8 · Settings.** Override the API URL at runtime so testers don't need a rebuild,
and set an operator name, which spec §9 wants on every scan. Persist both.
_Done:_ the URL can be changed on a phone without restarting Metro.

**T9 · App identity.** Real icon, splash screen and display name. The current ones
are Expo's placeholders.

**T10 · E2E test.** A [Maestro](https://docs.expo.dev/eas/workflows/examples/e2e-tests.md)
flow: home → capture → label → submit → verdict visible. _Done:_ the flow runs
locally against `make api`.

**Not in M1** (spec §13): goods-in / purchase-order context (`po_id`,
`expected_fabric_id` in spec §6) arrives with sub-project 2 at M2.

**Ask of P2:** add CORS for `localhost` in development, so web preview can reach the API.
