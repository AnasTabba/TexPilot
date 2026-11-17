# Design System: Yarnflow ("Denim")

Chosen by the owner on 17 Nov 2026. It replaces Cone Code and every earlier look (lime/charcoal,
espresso/orange, blue/teal with magenta). Do not bring those back.

## Who it is for

Mill owners, supervisors and floor operators of every age and level of schooling. Many read Urdu, not
English. Most hold a cheap Android phone in one hand on a factory floor; examiners see the app on a laptop
and a projector. A first-time user of any age must get the job done without being shown.

The look is plain on purpose: white ground, near-black text, one deep denim indigo for everything you can
press and for the sidebar. Colour other than indigo always means a status.

## Colours

Use them only through the CSS custom properties in `src/yarnflow.css`. Never write a hex in a screen's CSS.

| Token | Value | Use |
|---|---|---|
| `--ground` | `#F4F6FA` | page behind cards |
| `--sheet`, `--panel`, `--paper`, `--chip` | `#FFFFFF` | cards, sheets, fields |
| `--raised`, `--tint`, `--sheen`, `--paper-end` | `#EEF2FF` | selected row, soft indigo fill |
| `--sunken`, `--bar` | `#E8ECF3` | disabled fill, bar track |
| `--line` | `#D5DBE7` | card and field border |
| `--line-strong`, `--control` | `#6B7892` | field border on hover, control outline (3:1 on white) |
| `--ink` | `#111827` | text, headings |
| `--ink-2`, `--muted` | `#374151` | secondary text |
| `--ink-3`, `--placeholder` | `#4B5563` | hints, placeholders (still 4.5:1) |
| `--brand`, `--brand-ink`, `--pop`, `--rail` | `#1E3A8A` | primary button, links, sidebar, active states |
| `--pop-hover`, `--ink-hover` | `#172E6E` | pressed and hover on indigo |
| `--rail-ink`, `--on-ink` | `#FFFFFF` | text on indigo |
| `--rail-muted`, `--rail-soft` | `#C7D2FE` | quiet text on indigo |
| `--rail-line` | `#3350A8` | divider on indigo |
| `--focus` | `#2563EB` | focus ring, 3 px, 2 px offset |
| `--selection` | `#C7D2FE` | text selection |
| `--ok` / `--ok-bg` | `#166534` / `#DCFCE7` | good, passed, saved |
| `--warn` / `--warn-bg` | `#92400E` / `#FEF3C7` | needs attention, waiting |
| `--bad` / `--bad-bg` | `#B91C1C` / `#FEE2E2` | failed, rejected, on hold |
| `--kraft`, `--star` | `#92400E` | rating stars, raw-material accent |

Rules:
- Indigo means "you can press this" or "you are here". Nothing decorative is indigo.
- Green, amber and red mean status only, and always come with an icon and a word.
- Material cone colours (`materialHue`) stay: they identify a material, like a label colour.
- No gradients, glows, glass blur, drop shadows or thick one-side accent borders. One exception: a 1 px
  hairline above the phone bottom bar and below the top bar.

## Type

Figtree (already installed), upright only: no italic headings.

| Role | Size / weight |
|---|---|
| Page title | 28 px / 700 (24 px on phones) |
| Section title | 20 px / 700 |
| The answer or key number | 28 to 40 px / 700 |
| Body, buttons, inputs | 16 px / 400 to 600 |
| Secondary, labels | 14 px / 500 |

Nothing under 14 px. Line height 1.4 or more. Lines no longer than 70 characters. Sentence case, no
letter-spaced capitals.

## Shape and space

- Radius: 12 px for buttons and fields (`--r-control`), 16 px for cards and rows (`--r-row`, `--r-field`),
  20 px for sheets (`--r-sheet`), pill only for chips and status tags.
- Cards are white with a 1 px `--line` border. Space separates groups: 24 px between sections, 16 px inside
  cards, 8 px between neighbours.
- Every tappable thing is at least 48 x 48 px.

## Components

- **Primary button**: solid indigo, white text, 52 px tall on phones (48 px desktop), 16 px / 600, icon plus
  verb ("Save batch"). One per screen. On phones it is full width and pinned to the bottom, above the bar.
- **Secondary button**: white, 1.5 px indigo border, indigo text. **Quiet button**: text only, indigo.
  **Danger**: red text and border; solid red only on the final confirm.
- **Field**: label above (14 px / 600), 48 px tall, 16 px text, 1.5 px `--line-strong` border, error in red
  with an icon under the field.
- **Status tag**: pill with icon and word on its status background.
- **Row**: a full-width card, 64 px or taller, with a leading icon or cone, title, one line of detail, a
  status tag and a chevron when it opens something.
- **Sidebar (desktop)**: solid indigo, white text, sections grouped by job under plain group names; the
  active item is a white pill with indigo text and icon.
- **Bottom bar (phone)**: white with a hairline, five items at most, icon above a 14 px label; Scan is the
  raised centre button in indigo; the rest sits under "More", a sheet of large rows.
- **Top bar**: where you are, then search, notifications and settings.
- **Steps**: numbered circles with the name beside each; done is indigo with a tick, current is an indigo
  ring, later is grey. Only the current step is open.
- **Empty, loading, failed**: every list has all three; empty says what to do next and carries the button.
- **Details**: anything technical sits behind a native `<details>` labelled "Details".

## Scan answer

The answer comes first and large. Four rows: Garment, Fabric, Composition, Finish. Each shows the answer in
trade words and how sure the model is as a word, the percentage and a bar, from the real confidence value:

| Confidence | Word | Colour |
|---|---|---|
| 85% and above | Very sure | green |
| 60% to 84% | Fairly sure | amber |
| under 60% | Not sure | red |

The fault check is one block: "No fault found" (green) or "Possible fault: look at the marked area" (amber)
with the photo and its heat map. The label check is one plain sentence. Then one primary next step. Only
real model output appears on screen.

## Words

Plain, short, the trade's own. Buttons are verbs. No codes, IDs or internal names unless the person must
read them out. Numbers carry units. One name per thing: Home, Scan, Stock, batch, photo, Analyze.
English and Urdu are equal: every string through `t('English', 'اردو')`, layout with logical properties.

## Motion

Small and useful, 200 ms or less, off under `prefers-reduced-motion`. The floating scan pictures may stay.

## Short screens

On phones and short laptop screens the Scan page starts at the camera: the camera button must sit above
the bottom bar at 375 x 548.
