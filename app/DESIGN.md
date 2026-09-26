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

## 1. Who uses it, and where

A quality-control operator at a garment factory's **goods-in desk**. Fabric arrives
against a purchase order; they photograph it and its care label and get a verdict.

Design for that setting, not for an office:

| Condition                         | Consequence for the UI                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| Standing, one hand holding fabric | Primary actions at the bottom, in thumb reach. Big targets (≥ 48 pt; buttons are 52). |
| Uneven, often poor lighting       | Camera guidance matters more than chrome. High contrast everywhere.                   |
| Repetitive, time-pressured        | Fewest possible taps per scan. Verdict readable at a glance, from arm's length.       |
| Wifi comes and goes               | Offline is a normal state, not an error (queue lands in T5).                          |
| Typing is slow and error-prone    | Prefer capture over typing. Typed label text is a stop-gap until OCR (T3).            |

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
4. **Never claim what the system does not know.** The app never shows a fibre
   composition _derived from the photo_. The image gives only **structure**,
   **surface treatment** and **fibre family** (cellulosic / protein / synthetic /
   blend). Exact composition comes _only_ from the care label. Don't write copy like
   "Cotton detected".
5. **Show missing answers plainly.** A head the model declined is `null`. Render it
   as "Not determined", never hide the row or fill in a default. An unreadable label
   shows as no composition, never a guess.
6. **Verdict first, then evidence.** The result screen reads top to bottom:
   verdict → why it was flagged → what it looks like → what the label claims →
   provenance (model version, KB version, scan id). Provenance stays visible because
   every scan is audit evidence (spec §9).
7. **Bad captures are stopped before upload.** When the quality gate (T2) rejects a
   photo, the operator is told why in plain words and re-shoots on the same screen.

## 3. Screens and their states

| Route              | Purpose                                               | States to design                                                      |
| ------------------ | ----------------------------------------------------- | --------------------------------------------------------------------- |
| `/` home           | Start a scan, see server status                       | server checking / connected / unreachable                             |
| `/scan/surface`    | Photograph the fabric (10–20 cm)                      | permission pending / denied / camera live / capture rejected (T2)     |
| `/scan/label`      | Care-label composition (typed now, photo + OCR in T3) | empty / filled / skipped                                              |
| `/scan/review`     | Confirm and submit                                    | ready / submitting / error                                            |
| `/result/[scanId]` | The verdict and its evidence                          | PASS / FLAG / INSUFFICIENT_EVIDENCE, each with and without label data |
| `/history`         | Past scans on this device                             | empty / list                                                          |

Planned: settings (T8), pending-upload state for queued scans (T5), label photo
capture (T3).

## 4. Copy

- Plain words an operator uses: "fabric", "care label", "rescan". No ML jargon in
  primary copy ("inference", "head", "model output"). Confidence may appear as a
  percentage next to a prediction.
- Sentence case everywhere except the small uppercase card eyebrows.
- Every negative state says what to do next.
- Current verdict copy lives in `src/features/verdict/presentation.ts`. Change it
  there, and keep its tests passing.

## 5. Design system

### Tokens — `src/theme/index.ts`

`colors`, `spacing`, `radius`, `typography`. **Every colour and spacing value in
the app comes from here.** Screens and components never hard-code one. To restyle
the app, change the tokens first.

Verdict colours are tokens too, as a strong/soft pair per verdict: `pass` / `passSoft`,
`flag` / `flagSoft`, `abstain` / `abstainSoft`. Keep the rules in §2 when you pick
new values, and check contrast (WCAG AA: 4.5:1 for body text) on both the strong
colour against the soft background and text against surface.

The app is light-mode only (`userInterfaceStyle: "light"` in `app.json`). Dark mode
would mean a second token set; it is not planned for M1.

### Primitives — `src/components/ui/`

| Component   | Use                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------- |
| `Screen`    | Page shell: safe area, background, padding, optional pinned `footer` for the primary action |
| `Text`      | All text. `variant`: `title` / `heading` / `body` / `caption`; `muted` for secondary        |
| `Button`    | `primary` / `secondary`, `loading`, `disabled`                                              |
| `Card`      | Grouped content with an optional eyebrow `title`                                            |
| `TextField` | Labelled text input                                                                         |

Add a new primitive here when it is generic (no TexPilot knowledge). A component that
knows about scans or verdicts belongs in its feature folder, e.g.
`src/features/verdict/components/`. Export new primitives from
`src/components/ui/index.ts`.

### Icons, fonts, images

No icon set or custom font has been chosen yet. That's the designer's call. Install
with `npx expo install <package>`, prefer Expo-maintained packages, and check they
run in Expo Go (native-only packages need a dev build). The app icon and splash
screen are Expo placeholders in `assets/`, configured in `app.json` (task T9).

## 6. Accessibility checklist

- Touch targets ≥ 48 × 48 pt.
- Every `Pressable` has `accessibilityRole`, and an `accessibilityLabel` when it has
  no visible text (e.g. the shutter).
- Disabled and busy states are set in `accessibilityState`, not only drawn.
- Colour is never the only signal. Every verdict has a title in words, not just a
  colour.
- Text scales with the system font size; don't fix heights on text containers.

## 7. Seeing your work

- **All three verdicts, no backend needed:** open History and tap **Load sample
  results (dev)**. It only appears in development builds. The data comes from
  `src/api/fixtures.ts`.
- **On a phone:** `make api-lan` + `make app`, then scan the QR code with Expo Go
  (setup in `README.md`).
- **In a browser:** `npm run web`. Good for layout work. The API has no CORS yet, so
  the home screen shows "Unreachable" and submitting fails in the browser. That's
  expected; phones are unaffected.
- The camera needs a real device. In a browser it uses the laptop webcam.
