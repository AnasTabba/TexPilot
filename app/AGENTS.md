# TexPilot app — agent guide

You are working on the phone client of TexPilot's **fabric verification scanner** (the
P3 workstream). This file is the rulebook for any change in `app/`. The repo-wide
rules in `../AGENTS.md` also apply.

**Read before you start:**

1. This file.
2. `DESIGN.md` for **any** change a user can see. It holds the product rules (three
   verdicts, abstaining is not an error, never claim fibre from a photo) and the
   design system.
3. `README.md` for how to run the app, and the **task board** (T1–T10). If the user
   names a task number, the scope and "done" criteria are there.

## What exists today

The app works end-to-end against the live API: fabric photo → typed care-label text →
submit → verdict → history. The API has no trained model yet, so **every real scan
returns `INSUFFICIENT_EVIDENCE`**. That is correct, not a bug; don't "fix" it. Use
**History → Load sample results (dev)** to see PASS and FLAG.

Stubs that are real tasks, not bugs:

- `src/features/capture/quality.ts`: the quality gate passes everything, with `checked: false` (T2).
- `src/features/queue/`: the offline queue exists only as a contract (T5).
- `src/app/scan/label.tsx`: label text is typed, pending photo + OCR (T3).

## Stack

Expo SDK 57 · React Native 0.86 · React 19.2 · TypeScript 6 (strict,
`noUncheckedIndexedAccess`) · Expo Router (typed routes) · zustand 5 · Jest via
`jest-expo` + React Native Testing Library 14 · ESLint 9 flat config
(`eslint-config-expo`) + Prettier.

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
npm run check               # typecheck + lint + format check + tests. Must pass before you say "done".
npm test                    # jest only
npm run format              # prettier --write
npm run gen:api             # regenerate src/api/schema.gen.ts from the Python API
npx expo start              # dev server (make app)
npm run web                 # browser preview
npx expo install <package>  # ALWAYS use this to add packages; it resolves SDK-compatible versions
npx expo-doctor             # diagnose dependency/config issues
```

## Where things go

| You need to…                                  | Put it in                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| Add a screen                                  | `src/app/<route>.tsx` + a `<Stack.Screen>` entry with a title in `src/app/_layout.tsx` |
| Add logic, state or a scan-specific component | `src/features/<feature>/`, exported from its `index.ts`                                |
| Add a generic UI building block               | `src/components/ui/`, exported from its `index.ts`                                     |
| Change colours, spacing, type                 | `src/theme/index.ts` only                                                              |
| Call the API                                  | `src/api/` (`client.ts` handles timeouts and errors, `scan.ts` the endpoints)          |
| Use an API type                               | `import type { ScanResult } from '@/api'`; the shapes are generated                    |
| Sample data for UI or tests                   | `src/api/fixtures.ts`                                                                  |
| Read config                                   | `src/config/env.ts` (`EXPO_PUBLIC_*` vars)                                             |
| A hook shared across features                 | `src/hooks/`                                                                           |

Current features: `capture` (camera, framing guide, quality gate), `scan` (in-progress
draft + submit), `verdict` (rendering a result), `history` (persisted results),
`queue` (contract only).

## Hard rules

1. **Screens are thin.** Files in `src/app/` compose features and navigate. No
   business logic, no API calls, no reusable components there.
2. **Nothing but routes in `src/app/`.** Every file there becomes a route, including
   tests and helpers. Tests go next to the code they test, outside `src/app/`.
3. **Import features through their index.** `@/features/verdict`, never
   `@/features/verdict/components/X`; ESLint blocks it. Inside a feature, use
   relative imports.
4. **No hard-coded colours or spacing.** Always `@/theme`.
5. **Never edit `src/api/schema.gen.ts` by hand.** It is generated from
   `services/api/schemas.py`, the shared contract between all three workstreams. If
   the app needs a contract change (a new request field, say), stop and tell the
   user: it has to be agreed in a PR that P1 and P2 review. After an agreed change,
   run `npm run gen:api` and commit the result. CI fails when the two drift.
6. **Don't change the backend (`../services/`) from app work.** If the app needs
   something from the API, report it rather than editing Python. Known ask: CORS for
   web preview.
7. **Never guess on the user's behalf.** No default labels, no hidden `null`s, no
   fallback composition. See `DESIGN.md` §2.
8. **Native directories are generated.** Never create or edit `ios/` or `android/`.
   Configure native behaviour through `app.json` and config plugins. Expo Go only
   includes Expo's bundled native modules; anything else needs a dev build
   (`npx expo run:ios|android`). Say so when you add such a package.
9. **Env vars must be read literally**, as `process.env.EXPO_PUBLIC_X`. Expo inlines
   them at build time; destructuring or `process.env[name]` silently yields
   `undefined`. Never put secrets in `EXPO_PUBLIC_*`: they ship in the app bundle.

## Testing

- Tests first for logic: stores, quality checks, formatting, API handling.
- Components: `await render(<X />)`. In RNTL 14 `render` is **async**. Then query
  through `screen`. Matchers like `toBeOnTheScreen()` are built in, no setup needed.
  Use `queryBy*` only with `.not.toBeOnTheScreen()`.
- Nested `<Text>` merges into one string: `<Text>Denim <Text>(91%)</Text></Text>`
  is found by `getByText('Denim (91%)')`, not `'Denim'`.
- Feed components `passResult` / `flagResult` / `abstainResult` from
  `@/api/fixtures`. Any change to result rendering must hold for all three.
- Native modules need mocks in `jest.setup.ts` (AsyncStorage is already there).
- Mock the network with `globalThis.fetch = jest.fn()`. See `src/api/client.test.ts`.

## Gotchas

- **Phone can't reach the API?** On the phone, `127.0.0.1` is the phone itself. Set
  `EXPO_PUBLIC_API_URL` to the laptop's LAN IP in `.env.local` and run `make api-lan`.
  The home screen shows the URL and whether it is reachable.
- **Web preview can't reach the API.** There's no CORS on the backend yet, so this is
  expected. Phones are unaffected.
- **One camera preview at a time.** `CaptureCamera` unmounts its viewfinder when the
  screen loses focus. Keep that behaviour when you touch it.
- **Camera URIs are temporary** cache files. Copy anything you need to keep into app
  storage (T6).
- **Node 24 LTS** (`.nvmrc`), matching CI. If you change dependencies, commit the
  `package-lock.json` your npm produced, and check that `npm ci` still passes. CI fails
  on an out-of-sync lockfile (some npm 11 releases before 11.19 drop optional
  `@emnapi/*` entries).
- **Typed routes** are generated into `.expo/types/` when `expo start` runs. Before
  that, route typing is looser. Use the object form for dynamic routes:
  `router.push({ pathname: '/result/[scanId]', params: { scanId } })`.
- **openapi-typescript** runs through a pinned `npx` in `scripts/gen-api-types.sh`,
  not as a dependency: it peer-depends on TypeScript 5 and the app is on 6. Don't
  "fix" this by installing it with `--legacy-peer-deps`.
- The React Compiler lint rules are on. Don't call `setState` synchronously inside
  `useEffect`; derive the state, or restructure (see how `CaptureCamera` mounts
  `Viewfinder`).

## Workflow and definition of done

- Branch from `main` as `feat/app-<thing>` (e.g. `feat/app-quality-gate`). `main` is
  protected: open a PR, and someone else merges it.
- Never commit `.env.local`, `node_modules/`, `.expo/`, `ios/` or `android/`.
- **Done means:** `npm run check` passes; new logic has tests; UI changes were looked
  at on a device or in web preview, in every state listed in `DESIGN.md` §3 that
  they touch; the `README.md` task board is updated if scope changed.
