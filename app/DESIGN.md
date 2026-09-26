# TexPilot app — design guide

Read this before changing anything a user can see. It has two kinds of rules:

- **Product rules.** These come from the approved spec and are not a matter of taste.
  Changing one is a team decision, not a design decision.
- **Design system.** The current look is a working placeholder. The designer owns it:
  colours, type, spacing, components, icons, motion. Change freely, through the
  tokens and primitives described below.

Spec: `../docs/superpowers/specs/2026-09-20-fabric-verification-scanner-design.md`
(§2 on what the system claims, §3 on the three outcomes, §4.4 on the app, §7 on
error handling).

---

## 1. Three surfaces, three audiences

One codebase serves all three. Each surface has its own audience and its own layout,
but they share one design system.

| Surface                      | Who                                                         | Where                                | Design for                                                         |
| ---------------------------- | ----------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| **Scanner** (`/scan`)        | QC operator at the factory's goods-in desk                  | iPhone/Android app; also any browser | One hand, poor light, repetition, patchy wifi                      |
| **Dashboard** (`/dashboard`) | Supervisor / QC lead reviewing what came in                 | Desktop browser (works narrow too)   | Scanning many results fast, spotting flags, drilling into evidence |
| **Landing page** (`/`)       | Visitors: advisors, the Jan 2027 Open House, future clients | Any browser                          | Explaining the idea honestly in under a minute                     |

### The scanner's setting

Fabric arrives against a purchase order. The operator photographs it and its care
label and gets a verdict. Design for that setting, not for an office:

| Condition                         | Consequence for the UI                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| Standing, one hand holding fabric | Primary actions at the bottom, in thumb reach. Big targets (≥ 48 pt; buttons are 52). |
| Uneven, often poor lighting       | Camera guidance matters more than chrome. High contrast everywhere.                   |
| Repetitive, time-pressured        | Fewest possible taps per scan. Verdict readable at a glance, from arm's length.       |
| Wifi comes and goes               | Offline is a normal state, not an error (queue lands in T5).                          |
| Typing is slow and error-prone    | Prefer capture over typing. Typed label text is a stop-gap until OCR (T3).            |

### The scanner is meant to be embedded later

The long-term plan is to offer the scanner as a feature other websites and services can
drop in (`src/scanner/README.md`). So design scanner components to **look right inside
someone else's page**:

- they take their colours from tokens and draw no page chrome of their own
- they don't assume they fill the whole screen

App-only chrome (headers, navigation, the dashboard shell) lives outside
`src/scanner/`.

## 2. Product rules (do not change without the team)

1. **Three verdicts, all first-class.** `PASS`, `FLAG`, `INSUFFICIENT_EVIDENCE`.
2. **Abstaining is not an error.** `INSUFFICIENT_EVIDENCE` is an expected, normal
   outcome. It gets a **neutral** tone: never red, never an error icon, never
   "failed". It tells the operator what to do next (rescan in better light, add the
   label). Today the API returns it for _every_ scan, so this is the screen people see
   most.
3. **Red means the app failed, not the fabric.** Reserve the danger colour for
   system problems: server unreachable, camera error. A `FLAG` is a finding about the
   fabric and uses its own tone (currently amber).
4. **Never claim what the system does not know.** No surface ever shows a fibre
   composition _derived from the photo_. The image gives only **structure**,
   **surface treatment** and **fibre family** (cellulosic / protein / synthetic /
   blend). Exact composition comes _only_ from the care label. Don't write copy like
   "Cotton detected", including on the landing page.
5. **Show missing answers plainly.** A head the model declined is `null`. Render it
   as "Not determined", never hide the row or fill in a default. An unreadable label
   shows as no composition, never a guess.
6. **Verdict first, then evidence.** A result reads top to bottom: verdict → why it
   was flagged → what it looks like → what the label claims → provenance (model
   version, KB version, scan id). Provenance stays visible because every scan is audit
   evidence (spec §9). The dashboard's scan detail uses the same component.
7. **Bad captures are stopped before upload.** When the quality gate (T2) rejects a
   photo, the operator is told why in plain words and re-shoots on the same screen.
8. **Say where data comes from.** Until the server stores scans (T14), the dashboard
   shows only this browser's scans, and it says so on screen. Never present partial
   data as the whole picture.
9. **Rates exclude abstentions.** "Flag rate" is flags ÷ (passes + flags). Counting
   abstentions would make the scanner look more lenient than it is. With no decided
   scans, show "—", not "0%".

## 3. Screens and their states

### Scanner (`/scan/*`): iOS, Android, web

| Route                   | Purpose                                               | States to design                                                      |
| ----------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| `/scan`                 | Start a scan, see server status                       | server checking / connected / unreachable                             |
| `/scan/surface`         | Photograph the fabric (10–20 cm)                      | permission pending / denied / camera live / capture rejected (T2)     |
| `/scan/label`           | Care-label composition (typed now, photo + OCR in T3) | empty / filled / skipped                                              |
| `/scan/review`          | Confirm and submit                                    | ready / submitting / error                                            |
| `/scan/result/[scanId]` | The verdict and its evidence                          | PASS / FLAG / INSUFFICIENT_EVIDENCE, each with and without label data |
| `/scan/history`         | Past scans on this device                             | empty / list                                                          |

Planned: settings (T8), pending-upload state for queued scans (T5), label photo
capture (T3).

### Dashboard (`/dashboard/*`): web

| Route                       | Purpose                       | States to design                              |
| --------------------------- | ----------------------------- | --------------------------------------------- |
| `/dashboard`                | Totals per verdict, flag rate | no scans / some scans / data-source notice    |
| `/dashboard/scans`          | Every scan, newest first      | empty / table (wide) / stacked cards (narrow) |
| `/dashboard/scans/[scanId]` | One scan's full evidence      | found / not found                             |

Planned (T15): filters (verdict, date), flag review ("checked, accepted/rejected").

### Landing page (`/`): web

One page:

- header links
- hero with two calls to action (scanner, dashboard)
- how it works (3 steps)
- the three verdicts
- what it does not do
- footer

Copy lives in `src/features/marketing/content.ts`. Every claim must hold up in a
viva, so check it against the root `README.md`.

## 4. Layout across screen sizes

Breakpoints are tokens (`breakpoints` in `src/theme`), read through `useBreakpoint()`:

| Breakpoint | Width    | Typical device                  |
| ---------- | -------- | ------------------------------- |
| `compact`  | < 600    | phones                          |
| `medium`   | 600–1023 | tablets, narrow browser windows |
| `expanded` | ≥ 1024   | laptops and up                  |

- **Scanner screens** are a single column, capped at `layout.contentMaxWidth` (640)
  and centred. On a laptop they read like a focused form, not a stretched phone.
- **Dashboard:** a sidebar at `expanded`, a top bar below it. The table becomes
  stacked cards at `compact`. Content is capped at `layout.pageMaxWidth`.
- **Landing page:** card rows at `medium` and up, a single column at `compact`.
  Capped at `layout.pageMaxWidth`.
- Check every web page at about 390 px and about 1280 px wide.

## 5. Copy

- Plain words an operator uses: "fabric", "care label", "rescan". No ML jargon in
  primary copy ("inference", "head", "model output"). Confidence may appear as a
  percentage next to a prediction.
- Sentence case everywhere except the small uppercase card eyebrows.
- Every negative state says what to do next.
- Verdict copy lives in `src/scanner/verdict/presentation.ts`, and landing copy in
  `src/features/marketing/content.ts`. Change it there and keep the tests passing.

## 6. Design system

### Tokens — `src/theme/index.ts`

`colors`, `spacing`, `radius`, `typography` (`display` / `title` / `heading` / `body` /
`caption`), `breakpoints`, `layout`. **Every colour and spacing value in the app comes
from here**, including camera overlays (`scrim`, `shutterRing`). To restyle the app,
change the tokens first.

Verdict colours are tokens too, as a strong/soft pair per verdict: `pass` / `passSoft`,
`flag` / `flagSoft`, `abstain` / `abstainSoft`. Keep the rules in §2 when you pick
new values, and check contrast (WCAG AA: 4.5:1 for body text) on both the strong
colour against the soft background and text against surface.

The app is light-mode only (`userInterfaceStyle: "light"` in `app.json`). Dark mode
would mean a second token set; it is not planned for M1.

### Primitives — `src/components/ui/`

| Component   | Use                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `Screen`    | Scanner page shell: safe area, centred column, optional pinned `footer` for the primary action                 |
| `Text`      | All text. `variant` as above; `muted` for secondary                                                            |
| `Button`    | `primary` / `secondary`, `loading`, `disabled`. Inside `<Link href asChild>` it becomes a real link on the web |
| `Card`      | Grouped content with an optional eyebrow `title`                                                               |
| `TextField` | Labelled text input                                                                                            |

Domain components live with their domain:

| Where                     | Components                                                                     |
| ------------------------- | ------------------------------------------------------------------------------ |
| `src/scanner/`            | `ScanResultView`, `VerdictBanner`, `VerdictBadge`, `CaptureCamera`             |
| `src/features/dashboard/` | `DashboardShell`, `DashboardPage`, `StatTile`, `ScanTable`, `DataSourceNotice` |
| `src/features/marketing/` | `LandingPage`                                                                  |

Add a primitive to `components/ui` only when it knows nothing about TexPilot.

### Icons, fonts, images

No icon set or custom font has been chosen yet. That's the designer's call. Install
with `npx expo install <package>`, prefer Expo-maintained packages, and check they
work on iOS, Android **and** web (and in Expo Go; native-only packages need a dev
build). The app icon and splash screen are Expo placeholders in `assets/`,
configured in `app.json` (task T9).

## 7. Accessibility checklist

- Touch targets ≥ 48 × 48 pt.
- Every `Pressable` has `accessibilityRole`, and an `accessibilityLabel` when it has
  no visible text (e.g. the shutter, table rows).
- Disabled, busy and selected states are set in `accessibilityState`, not only drawn.
- Colour is never the only signal. Every verdict has a title in words, not just a
  colour.
- Text scales with the system font size; don't fix heights on text containers.
- Web: navigation uses real links (`Link`), and page regions have roles
  (`navigation`, `main`, `banner`, `contentinfo`). Every page sets a title.

## 8. Seeing your work

- **All three verdicts, no backend or model needed:** open `/scan/history` and tap
  **Load sample results (dev)**. It only appears in development builds. The samples
  then also fill the dashboard. The data comes from `src/scanner/api/fixtures.ts`.
- **In a browser:** `npm run web`, then open `/`, `/scan` and `/dashboard`. Resize
  the window to check each breakpoint. The API has no CORS yet, so the scanner shows
  "Unreachable" in the browser. That's expected.
- **On a phone:** `make api-lan` + `make app`, then scan the QR code with Expo Go
  (setup in `README.md`). The phone opens straight into the scanner.
- The camera needs a real device. In a browser it uses the laptop webcam.
