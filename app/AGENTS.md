# TexPilot app — agent guide

You are working on the TexPilot frontend (the P3 workstream): **one Expo codebase that
ships an iOS app, an Android app and a website**. This file is the rulebook for any
change in `app/`. The repo-wide rules in `../AGENTS.md` also apply.

**Read before you start:**

1. This file.
2. `DESIGN.md` for **any** change a user can see. It holds the product rules (three
   verdicts, abstaining is not an error, never claim fibre from a photo), the three
   surfaces, and the design system.
3. `README.md` for running and building on each platform, and the **task board**. If
   the user names a task number (T1…), its scope and "done" criteria are there.
4. `src/scanner/README.md` before touching anything in `src/scanner/`.

## The three surfaces

| Surface                                | URL            | Platforms                         | Code                                               |
| -------------------------------------- | -------------- | --------------------------------- | -------------------------------------------------- |
| **Scanner:** capture → label → verdict | `/scan/*`      | iOS, Android, web                 | routes in `src/app/scan/`, logic in `src/scanner/` |
| **Supervisor dashboard:** review scans | `/dashboard/*` | web (native redirects to `/scan`) | `src/app/dashboard/`, `src/features/dashboard/`    |
| **Landing page:** public project page  | `/`            | web (native redirects to `/scan`) | `src/app/index.web.tsx`, `src/features/marketing/` |

The phone apps are the scanner. The website serves all three.

## What exists today

- **Scanner** works end-to-end against the live API: fabric photo → typed care-label
  text → submit → verdict → history. The API has no trained model yet, so **every
  real scan returns `INSUFFICIENT_EVIDENCE`**. That is correct, not a bug; don't
  "fix" it.
- **Dashboard** shows overview stats, a scans table and scan detail. For now it
  reads _this browser's_ scan history and says so on screen; server-backed data
  is T14.
- **Landing page:** structure and honest copy; visual design is open.
- **Sample data:** `/scan/history` → **Load sample results (dev)** seeds a PASS, a
  FLAG and an abstain result, which then also fill the dashboard.

Stubs that are tasks, not bugs: the capture-quality gate (`src/scanner/capture/quality.ts`,
T2), the offline queue (`src/scanner/queue/`, T5), and typed label text instead of a
photo plus OCR (T3).

## Stack

Expo SDK 57 · React Native 0.86 · React 19.2 · react-native-web · TypeScript 6
(strict, `noUncheckedIndexedAccess`) · Expo Router 57 (typed routes, platform route
files) · zustand 5 · Jest via `jest-expo` + React Native Testing Library 14 · ESLint 9
flat config (`eslint-config-expo`) + Prettier · EAS for native builds.

### Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed,
moved or removed. Before writing code that touches an Expo, EAS or React Native API:

1. Check the major version of `expo` in `package.json` (57).
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v57.0.0/`
   (append `.md` to any docs URL for markdown).
3. For anything else, fetch https://docs.expo.dev/llms.txt, the docs index with
   corrections to common LLM misconceptions. Never answer from memory.

The same goes for RNTL 14: its docs ship in
`node_modules/@testing-library/react-native/docs/` (see `guides/llm-guidelines.md`).

## Commands

Run from `app/` (or use the `make app*` targets from the repo root).

```bash
npm run check               # typecheck + lint + format check + tests. Must pass before "done".
npm run export:all          # bundle iOS, Android and web; CI runs this too
npm test                    # jest only
npm run format              # prettier --write
npm run gen:api             # regenerate src/scanner/api/schema.gen.ts from the Python API

npx expo start              # dev server; phone via Expo Go (make app)
npm run web                 # browser, http://localhost:8081
npm run web:build           # static website into dist/  (npm run web:serve to try it)
npm run build:android       # installable APK via EAS (see README "Native builds")
npm run build:ios           # iOS build via EAS (needs an Apple Developer account)

npx expo install <package>  # ALWAYS use this to add packages; it resolves SDK-compatible versions
npx expo-doctor             # diagnose dependency/config issues
```

## Where things go

```
src/
  app/            ROUTES ONLY, one folder per surface (see table above)
  scanner/        the embeddable scanner core: api, capture, draft, verdict, queue
  features/       app-level features: history, dashboard, marketing
  components/ui/  design-system primitives shared by every surface
  theme/          tokens: colours, spacing, radius, type, breakpoints, layout
  hooks/          shared hooks: useBreakpoint, useApiHealth
  config/env.ts   EXPO_PUBLIC_* config (only the app reads it; the scanner is configured)
```

| You need to…                                                | Put it in                                                                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Add a scanner step or screen                                | `src/app/scan/<name>.tsx` + a `<Stack.Screen>` title in `src/app/scan/_layout.tsx`                        |
| Add a dashboard page                                        | `src/app/dashboard/<name>.tsx`, wrapped in `<DashboardPage title=…>`; add it to `NAV` in `DashboardShell` |
| Add a landing/marketing page                                | `src/app/<name>.web.tsx` **plus** a native fallback `src/app/<name>.tsx` (redirect)                       |
| Change anything about capturing, sending or showing a scan  | `src/scanner/`, exported from `src/scanner/index.ts`                                                      |
| Add app-level logic (storage, dashboard data, site content) | `src/features/<feature>/`, exported from its `index.ts`                                                   |
| Add a generic UI building block                             | `src/components/ui/`, exported from its `index.ts`                                                        |
| Change colours, spacing, type, breakpoints                  | `src/theme/index.ts` only                                                                                 |
| Vary layout by screen size                                  | `useBreakpoint()` from `@/hooks/useBreakpoint` (`compact` / `medium` / `expanded`)                        |
| Vary behaviour by platform                                  | a `Foo.web.tsx` + `Foo.tsx` pair (see rule 11), or `Platform.OS` for one-liners                           |
| Use an API type                                             | `import type { ScanResult } from '@/scanner'` (generated shapes)                                          |
| Sample data for UI or tests                                 | `import { passResult, flagResult, abstainResult } from '@/scanner/testing'`                               |

## Hard rules

1. **Routes are thin.** Files in `src/app/` compose features and navigate. No
   business logic, no API calls, no reusable components there.
2. **Nothing but routes in `src/app/`.** Every file there becomes a route, including
   tests and helpers. Tests sit next to the code they test, outside `src/app/`.
3. **Use modules through their public index.** `@/scanner`, `@/features/dashboard`,
   never a file inside them. ESLint enforces this. Inside a module, use relative imports.
4. **The scanner stays embeddable** (`src/scanner/README.md`). It must not import from
   `@/features`, `@/config`, `@/hooks`, `@/app` or `expo-router`; ESLint enforces this.
   It gets its API URL from `configureScanner()`, hands results back to the caller,
   and never navigates. If you need to break this, the code belongs in `src/features/`.
5. **No hard-coded colours or spacing.** Always `@/theme`, and that includes camera
   overlays.
6. **Never edit `src/scanner/api/schema.gen.ts` by hand.** It is generated from
   `services/api/schemas.py`, the shared contract between all three workstreams. If
   the app needs a contract change (a new field or endpoint), stop and tell the user:
   it has to be agreed in a PR that P1 and P2 review. After an agreed change, run
   `npm run gen:api` and commit the result. CI fails when the two drift.
7. **Don't change the backend (`../services/`) from app work.** Report what the app
   needs instead. Known asks: CORS for web preview; a scan list endpoint for the
   dashboard (T14).
8. **Never guess on the user's behalf.** No default labels, no hidden `null`s, no
   fallback composition, no unlabelled data source. See `DESIGN.md` §2.
9. **Native directories are generated.** Never create or edit `ios/` or `android/`.
   Configure native behaviour through `app.json` and config plugins. Expo Go only
   includes Expo's bundled native modules; anything else needs a dev build. Say so
   when you add such a package.
10. **Env vars must be read literally**, as `process.env.EXPO_PUBLIC_X`, and only in
    `src/config/env.ts`. Never put secrets in `EXPO_PUBLIC_*`: they ship in the bundle.
11. **Web-only code stays out of native bundles.** A `.web.tsx` _route_ in `src/app/`
    is still bundled into iOS and Android; it just isn't routed there. So anything
    that touches `window` or `document`, or a web-only library, goes in a
    platform-split component _outside_ `src/app/` (`Hero.web.tsx` + `Hero.tsx`).
    Metro then leaves the other platform's file out entirely.
12. **Every change must bundle on all three platforms.** Run `npm run export:all` when
    you touch routes, platform files or dependencies.

## Testing

- Tests first for logic: stores, quality checks, summaries, formatting, API handling.
- Components: `await render(<X />)`. In RNTL 14 `render` is **async**. Then query
  through `screen`. Matchers like `toBeOnTheScreen()` are built in. Use `queryBy*`
  only with `.not.toBeOnTheScreen()`.
- Nested `<Text>` merges into one string: `<Text>Denim <Text>(91%)</Text></Text>`
  is found by `getByText('Denim (91%)')`, not `'Denim'`.
- Feed result UIs all three fixtures from `@/scanner/testing`.
- **Routing tests** use the real `src/app` (see `src/routing.test.tsx`; Jest runs as
  iOS). With RNTL 14, `expect(screen).toHavePathname()` does **not** work. Await
  `renderRouter(...)` and read `.getPathname()` from its return value.
- Native modules need mocks in `jest.setup.ts` (AsyncStorage is there).
- Mock the network with `globalThis.fetch = jest.fn()`. The scanner must be configured
  first (`configureScanner(...)` in `beforeAll`); see `src/scanner/api/client.test.ts`.
- Don't add a `transformIgnorePatterns` override to the Jest config. jest-expo's
  default is maintained for the current SDK; the list in older Expo docs breaks
  expo-router.

## Gotchas

- **Phone can't reach the API?** On the phone, `127.0.0.1` is the phone itself. Set
  `EXPO_PUBLIC_API_URL` to the laptop's LAN IP in `.env.local` and run `make api-lan`.
  The scanner home screen shows the URL in use and whether it is reachable.
- **Web preview can't reach the API.** There's no CORS on the backend yet, so this is
  expected. Phones are unaffected. The dashboard and landing page don't need the API.
- **`<Link asChild>` children must not get a style array.** expo-router throws and
  the whole page renders blank. Wrap the style in `StyleSheet.flatten([...])` (see
  `DashboardShell`). `Button` is safe to use inside `Link asChild`.
- **Metro can miss file changes** (no watchman). If the browser shows old behaviour,
  restart with `npx expo start --clear`.
- **On web, earlier stack screens stay in the DOM** (hidden). In browser tests, wait
  on the URL rather than on text that an earlier screen also contains.
- **One camera preview at a time.** Pass `active={useIsFocused()}` to
  `CaptureCamera` from the route, as `src/app/scan/surface.tsx` does.
- **Camera URIs are temporary** cache files. Copy anything you need to keep (T6).
- **Node 24 LTS** (`.nvmrc`), matching CI. If you change dependencies, commit the
  `package-lock.json` your npm produced, and check that `npm ci` passes. Some npm 11
  releases before 11.19 drop optional `@emnapi/*` entries, and CI then fails.
- **Typed routes** are generated into `.expo/types/` when `expo start` runs. After
  moving routes, start the dev server once before `npm run typecheck`. Use the
  object form for dynamic routes:
  `router.push({ pathname: '/scan/result/[scanId]', params: { scanId } })`.
- **openapi-typescript** runs through a pinned `npx` in `scripts/gen-api-types.sh`,
  not as a dependency: it peer-depends on TypeScript 5 and the app is on 6. Don't
  install it with `--legacy-peer-deps`.
- **React Compiler lint rules are on.** Don't call `setState` synchronously inside
  `useEffect`; derive the state, or restructure (see how `CaptureCamera` mounts
  `Viewfinder`).
- **Web output is a single-page app** (Expo's default). Hosting needs every path
  rewritten to `index.html`; see README "Website".

## Workflow and definition of done

- Branch from `main` as `feat/app-<thing>` (e.g. `feat/app-quality-gate`). `main` is
  protected: open a PR, and someone else merges it.
- Never commit `.env.local`, `node_modules/`, `.expo/`, `dist/`, `ios/` or `android/`.
- **Done means:**
  - `npm run check` passes.
  - `npm run export:all` passes whenever routes, platform files or dependencies
    changed.
  - New logic has tests.
  - UI changes were looked at on every platform they touch, in every state listed
    in `DESIGN.md` §3. Web pages at phone width (~390 px) and desktop width
    (~1280 px).
  - The `README.md` task board is updated if scope changed.
