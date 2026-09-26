# TexPilot app (P3)

One Expo codebase (SDK 57, React Native, TypeScript, Expo Router) that ships:

- **an iOS app and an Android app:** the fabric scanner
- **a website:** the same scanner in the browser, a supervisor dashboard, and a
  public landing page

**Docs in this folder:**

- `AGENTS.md`: rules for anyone, human or AI agent, changing the app
- `DESIGN.md`: product rules, surfaces and design system; read before any UI change
- `src/scanner/README.md`: the embeddable scanner core
- this file: running, building, and the task board

It works end-to-end today: photograph a fabric, type the care-label text, and get a
verdict back from the live API. Until P1 lands a model, that verdict is always
`INSUFFICIENT_EVIDENCE`. That is correct behaviour, not a bug.

| Surface              | URL          | Runs on                                             |
| -------------------- | ------------ | --------------------------------------------------- |
| Scanner              | `/scan`      | iOS, Android, web                                   |
| Supervisor dashboard | `/dashboard` | web                                                 |
| Landing page         | `/`          | web (the phone apps open straight into the scanner) |

## Run it

Use **Node 24 LTS** (`app/.nvmrc`; `nvm use` picks it up). CI runs the same.

```bash
# once
make setup          # repo root: Python venv for the API
make app-setup      # app JS deps
```

**In a browser (quickest):** from `app/`, run `npm run web` and open
http://localhost:8081. Visit `/`, `/scan` and `/dashboard`. The API has no CORS headers
yet, so the browser can't read its responses and the scanner shows "Unreachable".
Everything else works. For sample results, open `/scan/history` → **Load sample
results (dev)**.

**On a phone (the real scanner):**

1. Install **Expo Go** from the App Store or Play Store.
2. Point the app at your laptop. On a phone, `127.0.0.1` is the phone itself:
   ```bash
   cp app/.env.example app/.env.local
   ipconfig getifaddr en0          # your laptop's LAN IP, e.g. 192.168.1.23
   # set EXPO_PUBLIC_API_URL=http://192.168.1.23:8000 in .env.local
   ```
3. Two terminals, from the repo root: `make api-lan` (API reachable on your wifi) and
   `make app` (prints a QR code).
4. Scan the QR code with the iPhone camera, or from Expo Go on Android.

The scanner home screen shows the API URL and whether it is reachable; check it first
when something doesn't work. Phone and laptop must be on the same wifi, and
university networks often block device-to-device traffic. A phone hotspot works.

## Checks

```bash
npm run check        # typecheck + lint + format check + tests
npm run export:all   # bundle iOS, Android and web
```

CI runs both, plus a check that the generated API types match the Python contract.

## Build and ship

### Website

```bash
npm run web:build    # static site in dist/
npm run web:serve    # try the production build locally
npm run web:deploy   # export + deploy to EAS Hosting (needs an Expo account)
```

The site is a single-page app (Expo's default `web.output: "single"`). Any static host
works, as long as every path is rewritten to `/index.html`. Otherwise
`/dashboard/scans` 404s on reload. EAS Hosting handles that for you. For Netlify or
Vercel, see https://docs.expo.dev/guides/publishing-websites/.

### Native apps (EAS Build, in the cloud: no Xcode or Android Studio needed)

One-time setup, by whoever owns the Expo account:

```bash
npx eas-cli@latest login
npx eas-cli@latest init      # links the project; commit the projectId it adds to app.json
```

| Goal                                  | Command                                                                          | Needs                                 |
| ------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------- |
| Android app anyone can install (APK)  | `npm run build:android`                                                          | a free Expo account                   |
| iPhone app on registered test devices | `npm run build:ios` (register devices first: `npx eas-cli@latest device:create`) | Apple Developer Program ($99/yr)      |
| iOS Simulator build                   | `npx eas-cli@latest build -p ios --profile preview-simulator`                    | a Mac with Xcode to run the simulator |
| Store releases                        | `npx eas-cli@latest build --profile production`                                  | store developer accounts              |

Profiles live in `eas.json`. Until there's an Apple Developer account, iPhone testing
uses **Expo Go**, which covers everything the app does today. The first native module
that isn't in Expo Go (e.g. on-device OCR, T3) needs a `development` profile and
`expo-dev-client`. Add both then, not before, because installing `expo-dev-client`
changes how `expo start` behaves for everyone.

Bundle IDs are `pk.edu.iba.texpilot` (iOS and Android), set in `app.json`.

## Layout

```
src/
  app/                       ROUTES ONLY, one folder per surface
    _layout.tsx              root: configures the scanner, renders the active surface
    index.tsx                native: redirect to /scan
    index.web.tsx            web: landing page
    scan/                    scanner surface (all platforms): stack of capture steps
      _layout.tsx  index.tsx  surface.tsx  label.tsx  review.tsx
      result/[scanId].tsx    history.tsx
    dashboard/               supervisor dashboard
      _layout.tsx            native: redirect to /scan
      _layout.web.tsx        web: sidebar/top-bar shell
      index.tsx  scans/index.tsx  scans/[scanId].tsx
  scanner/                   EMBEDDABLE CORE; public API in index.ts, rules in README.md
    api/                     fetch client, endpoints, schema.gen.ts (GENERATED), fixtures
    capture/                 camera, framing guide, quality gate (T2)
    draft/                   the scan being assembled + useSubmitScan
    verdict/                 ScanResultView, VerdictBanner, VerdictBadge, copy
    queue/                   offline queue contract (T5)
    config.ts                configureScanner({ apiUrl })
  features/                  app-level features, each with an index.ts
    history/                 scans saved on this device/browser
    dashboard/               shell, pages, stats, scan table, data-source notice
    marketing/               landing page + its copy (content.ts)
  components/ui/             Button, Card, Screen, Text, TextField
  theme/                     colours, spacing, radius, type, breakpoints, layout
  hooks/                     useBreakpoint, useApiHealth
  config/env.ts              EXPO_PUBLIC_* config
eas.json                     native build profiles
```

## Conventions

Full list in `AGENTS.md`. The ones that shape the structure:

1. **Routes are thin**; logic lives in `src/scanner/` or `src/features/`.
2. **Modules are used through their index** (`@/scanner`, `@/features/dashboard`).
   ESLint enforces it.
3. **The scanner imports nothing app-specific** and never navigates, so it can later
   be embedded in other sites and services. ESLint enforces it.
4. **Web-only code** goes in `*.web.tsx` files, with a native fallback. Web-only
   _libraries_ go in platform-split components outside `src/app/`.
5. **No hard-coded colours or spacing**; everything comes from `@/theme`.
6. **The API contract is generated.** Run `npm run gen:api` when
   `services/api/schemas.py` changes.
7. **Never guess on the user's behalf.** `INSUFFICIENT_EVIDENCE` is a normal result
   with a neutral tone, and missing data is shown as missing.

## Task board

Branch as `feat/app-<thing>`. Each task names where the work goes and when it counts
as done. Spec references are to
`docs/superpowers/specs/2026-09-20-fabric-verification-scanner-design.md`.

**Scanner (M1)**

| #   | Task                               | Where                            | Size | Depends on      |
| --- | ---------------------------------- | -------------------------------- | ---- | --------------- |
| T1  | Camera polish                      | `scanner/capture/`               | S    | –               |
| T2  | **Capture-quality gate**           | `scanner/capture/quality.ts`     | L    | –               |
| T3  | Care-label photo + OCR             | `app/scan/label.tsx`, `scanner/` | L    | P2 contract     |
| T4  | Send capture metrics with the scan | `scanner/api/scan.ts`            | S    | T2, P2 contract |
| T5  | **Offline queue**                  | `scanner/queue/`                 | L    | T6              |
| T6  | Keep scan images on device         | `features/history/`              | M    | –               |
| T7  | Result screen detail               | `scanner/verdict/`               | M    | –               |
| T8  | Settings: API URL + operator       | new `app/scan/settings.tsx`      | S    | –               |
| T9  | App identity: icon, splash, name   | `app.json`, `assets/`            | S    | –               |
| T10 | E2E test of the scan flow          | `.maestro/`                      | M    | –               |

**Platforms and web**

| #   | Task                         | Where                                     | Size | Depends on                       |
| --- | ---------------------------- | ----------------------------------------- | ---- | -------------------------------- |
| T11 | First native builds          | `eas.json`, EAS account                   | S    | –                                |
| T12 | Put the website online       | EAS Hosting or a static host              | S    | –                                |
| T13 | Landing page design          | `features/marketing/`                     | M    | T9                               |
| T14 | **Server-backed dashboard**  | `features/dashboard/useDashboardScans.ts` | M    | P2: scan storage + list endpoint |
| T15 | Dashboard review workflow    | `features/dashboard/`, `app/dashboard/`   | M    | T14                              |
| T16 | Embeddable scanner (post-M1) | `scanner/`, new `packages/`               | L    | –                                |

**T1 · Camera polish.** Torch toggle, tap to focus. When permission is denied for
good, offer a button that opens system settings. _Done:_ usable in a dim
goods-in bay; a denied user has a way forward.

**T2 · Capture-quality gate** (spec §4.4, §7). This is the cheapest accuracy win in
the project. Replace the stub in `quality.ts`, keeping its signature. Blur is the
variance of the Laplacian on a downscaled greyscale copy (e.g. `expo-image-manipulator`
to ~256 px, then decode and compute in JS). Exposure comes from the luminance
histogram (clipped highlights and crushed shadows). Framing can start as "enough of
the frame is textured". Calibrate the thresholds on real phone captures, not guesses.
It must work on web too, where captures are `data:` URIs. _Done:_ the `test.todo`s in
`quality.test.ts` are real passing tests; a blurry photo is rejected with an
operator-facing reason and nothing is uploaded; `checked: true`.

**T3 · Care-label photo + OCR** (spec §4.2). Add a second capture for the label.
Agree with P2 first: on-device OCR (ML Kit / Apple Vision, which needs a dev build,
not Expo Go, and has no web version) or server-side (the API accepting
`label_image`, which works on every platform). Keep typed entry as a fallback.
_Done:_ a photographed label produces `stated_composition` without typing.

**T4 · Send capture metrics.** The request has no field for `capture_quality` yet.
Propose one to P2, then send `QualityReport.metrics`. _Done:_ the metrics are stored
server-side with the scan (spec §9).

**T5 · Offline queue** (spec §4.4, §7). The full contract is in
`scanner/queue/types.ts`. Retryable failures (`ApiError.isRetryable`) queue instead of
erroring. The queue persists across restarts, flushes on reconnect, uploads in order,
and never retries a 4xx. Hook it in at the `TODO(T5)` in
`scanner/draft/useSubmitScan.ts`, and keep it inside `src/scanner/`: queuing is part
of the embeddable core. _Done:_ in airplane mode a scan shows as pending; it uploads
by itself when the network returns, including after an app restart.

**T6 · Keep scan images on device.** Camera URIs are temporary cache files. Copy the
surface photo into app storage (`expo-file-system`) and store its path with the
history entry. Show thumbnails in history and on the result screen. Cap the disk
usage. On web, decide whether to keep images at all (browser storage is small).
_Done:_ images survive a restart. T5 relies on this.

**T7 · Result screen detail.** Expandable top-k per head, confidence bars, flag
severity styling. Build it against the fixtures; no model is needed. It shows on
the phone result screen and on the dashboard's scan detail. _Done:_ all three
verdicts look right with fixture data, with component tests for each.

**T8 · Settings.** Override the API URL at runtime, so testers don't need a rebuild,
by calling `configureScanner()` again. Also set an operator name, which spec §9 wants
on every scan. Persist both. _Done:_ the URL can be changed on a phone without
restarting Metro.

**T9 · App identity.** Real icon, splash screen, favicon and display name, plus the
brand the landing page and dashboard use. The current ones are Expo's placeholders.

**T10 · E2E test.** A [Maestro](https://docs.expo.dev/eas/workflows/examples/e2e-tests.md)
flow: scanner home → capture → label → submit → verdict visible. _Done:_ the flow
runs locally against `make api`.

**T11 · First native builds.** Do the one-time EAS setup above, build the Android
APK, and install it on a team phone. Get the iOS route decided: Apple Developer
account, or Expo Go until M4. _Done:_ the APK works on a real Android phone against
`make api-lan`; the iOS decision is written in `README.md`.

**T12 · Website online.** Deploy `npm run web:build` somewhere public (EAS Hosting is
one command). Check that deep links like `/dashboard/scans` survive a reload. The
public scanner needs the API reachable over HTTPS with CORS, so coordinate with P2.
_Done:_ a public URL serves the landing page and dashboard.

**T13 · Landing page design.** Visual design for `/`: brand, imagery, maybe a short
demo clip, for the Jan 2027 Open House. Keep the claims in `content.ts` honest
(`DESIGN.md` §2.4). Consider switching `web.output` to `static` for SEO. That needs
`generateStaticParams` for the dynamic routes. _Done:_ reviewed by the team at phone
and desktop widths.

**T14 · Server-backed dashboard.** Today the dashboard reads this browser's history.
P2 persists scans (spec §9) and adds a list endpoint (e.g. `GET /api/v1/scans`). Then
regenerate the types (`npm run gen:api`), implement `useDashboardScans()` against it,
and return `source: 'server'`. The notice then hides itself. _Done:_ scans from a
phone appear on the dashboard in a browser.

**T15 · Dashboard review workflow.** Filters (verdict, date), and marking a flagged
scan as reviewed (accepted / rejected, by whom). Needs server support from T14.

**T16 · Embeddable scanner** (post-M1). Make `src/scanner` usable outside this app.
The options are in `src/scanner/README.md`: an iframe `/embed/scan` route, an npm
package, or a Web Component. Start with the iframe; it's the least work.

**Not in M1** (spec §13): goods-in / purchase-order context (`po_id`,
`expected_fabric_id` in spec §6) arrives with sub-project 2 at M2.

**Asks of P2:**

- CORS for `localhost` in development, so the web scanner can reach the API
- scan storage and a list endpoint (T14)
- an HTTPS deployment of the API for the public website (T12)
