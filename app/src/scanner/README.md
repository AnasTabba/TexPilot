# `src/scanner` — the scanner core

Everything needed to **capture a fabric, send it to the TexPilot API and show the
verdict**, and nothing else. Today it runs inside this app. The long-term plan is to
offer the scanner as a feature other websites and services can embed. This folder is
the part that would ship, so it is kept separable from day one.

## The boundary (ESLint enforces it)

- **Outside code imports only `@/scanner`** (the public `index.ts`) or
  `@/scanner/testing` (fixtures). Deep imports like `@/scanner/verdict/...` fail lint.
- **The scanner imports nothing app-specific.** It may use:
  - its own files (relative imports)
  - `@/theme` and `@/components/ui`
  - npm packages

  It must not use `@/features/*`, `@/config/*`, `@/hooks/*` or routes. Lint fails
  otherwise.

- **The host passes in configuration.** `configureScanner({ apiUrl })` is called by
  the app at startup (`src/app/_layout.tsx`). The scanner never reads env vars or
  settings itself.
- **The host receives results and decides what to do with them.**
  `useSubmitScan().submit()` returns the `ScanResult`. Storing it (history), navigating,
  or reporting it to a host page is the caller's job.
- **No navigation inside the scanner.** Components take callbacks (`onAccepted`,
  `onPress`); routes in `src/app/scan/` do the navigating.

If something you're building needs to break one of these rules, it probably belongs
in `src/features/` instead.

## What's inside

| Folder      | Holds                                                                         |
| ----------- | ----------------------------------------------------------------------------- |
| `api/`      | fetch client, endpoints, generated contract types (`schema.gen.ts`), fixtures |
| `capture/`  | camera + framing guide, capture-quality gate (T2)                             |
| `draft/`    | the scan being assembled, and submitting it                                   |
| `verdict/`  | rendering a `ScanResult`: banner, badge, predictions, composition, flags      |
| `queue/`    | offline queue contract (T5)                                                   |
| `config.ts` | `configureScanner` / `getScannerConfig`                                       |

## Path to "embed it anywhere" (post-M1, not started)

For **services**, the integration point is the REST API (`services/api`). Nothing in
this folder is needed.

For **websites and apps**, three options, roughly in order of effort:

1. **Hosted page + iframe.** Serve a chrome-less `/embed/scan` route. The host page
   iframes it and receives the `ScanResult` via `postMessage`. Works on any website,
   whatever its framework. The least work.
2. **npm package for React / React Native hosts.** Move this folder into
   `packages/scanner`. Take theme tokens as a prop or provider instead of importing
   `@/theme`, and move the UI primitives it uses into the package.
3. **Web Component** (`<texpilot-scanner>`) wrapping option 2, for non-React websites.

Whichever is chosen, the rules above are what make it a move rather than a rewrite.
