# D09 iOS verification — 14 November 2026

Only files under `yarnflow/ios/` were edited. No commit, dependency install, server, external service, trained model, release, signing identity or deployment was used.

Environment: Xcode 26.6 (17F113), macOS 26.5.2; iPhone 17 / iOS Simulator 26.5 (23F77), arm64. iPhone 16 is not installed. Destination UDID: `541B11E5-FC20-4928-81ED-5F7DB6330C48`.

Final XCTest counts: unit target reports 14 executed (13 passed, 0 failed, 1 skipped); UI target reports 2 executed (2 passed, 0 failed, 0 skipped). The one unit skip is `physical device required (G8): Simulator does not report NSFileProtectionKey`. Unsigned generic iOS build succeeded. The simulator used for these runs is confirmed Shutdown.

## Changes and proof

- The URLProtocol double reads both buffered and streamed request bodies; the exact login name/PIN assertion remains. Force-unwraps in the double are replaced with explicit XCTest failures. The test name explicitly identifies its protocol double; this is not a real Worker integration test.
- Draft storage still requests directory complete protection and atomic complete-file-protection writes. An injectable writer verifies the actual options supplied by save, then performs the real write/read/expiry/purge. A separate physical-device test retains the file attribute assertion and skips only on Simulator with the G8 reason.
- Both canonical fixture files are copied directly from `scanner/tests/fixtures/qc-v2/` by the test target resource phase, not maintained as duplicate source fixtures. Runtime loading uses the test bundle, with an XCTFail containing the expected path when absent. This removes the old build-machine absolute path dependency.
- Every valid fixture passes strict schema validation, Swift decoding, semantic checks, and JSON-value-equal re-encoding. Every invalid fixture is rejected. Per-type counts are printed and asserted. A separate explicitly derived unknown-field negative covers all 27 mirrored types.
- The maximum Dynamic Type UI test launches without `--qc`, scrolls to and taps the real login-screen Incoming fabric QC button, and reaches the QC screen without a server or fabricated workspace. Form controls are scrolled into view and must be hittable. Urdu still checks the debug entry. Both assert REVIEW ONLY, the signed-out connection state, reachable name/PIN/sign-in controls, disabled empty-credential sign-in, and no ACCEPT/HOLD or logout state.
- The QC screen now states that the server is not connected and sign-in is required to load QC; no result is loaded. New Urdu strings remain marked `needs_review` with the existing G8 review notice. No policy or authority logic was added.

## Red/green runs

Counts below are test cases, not assertion failures; executed includes XCTest skipped cases.

| Bundle | Unit executed / passed / failed / skipped | UI executed / passed / failed / skipped |
|---|---|---|
| d09-baseline | 11 / 9 / 2 / 0 | 2 / 1 / 1 / 0 |
| d09-red | 12 / 11 / 1 / 0 | 2 / 1 / 1 / 0 |
| d09-ui-red | 13 / 12 / 0 / 1 | 2 / 0 / 2 / 0 |
| d09-final | 13 / 12 / 0 / 1 | 2 / 2 / 0 / 0 |
| d09-fixture-red | 1 / 0 / 1 / 0 | 0 / 0 / 0 / 0 |
| d09-verified | 14 / 13 / 0 / 1 | 2 / 2 / 0 / 0 |

Baseline reproduced the login-body crash, simulator attribute failure and maximum Dynamic Type UI failure; Urdu passed in this run. `red` proves the body repair while protection and maximum-type assertions still failed. `ui-red` proves both new connection-state assertions failed before the UI text was implemented. `fixture-red` proves the new bundled-fixture test failed before resource wiring. `verified` is the final source state.

## Exact Xcode commands

Test/build commands were run from `/Users/zuhairmerchant/TexPilot/yarnflow`. Logs and result bundles below remain local under ignored `ios/.build/`.

```sh
xcodebuild -list -project ios/Yarnflow.xcodeproj
xcodebuild test -project ios/Yarnflow.xcodeproj -scheme Yarnflow -destination 'platform=iOS Simulator,id=541B11E5-FC20-4928-81ED-5F7DB6330C48' -parallel-testing-enabled NO -derivedDataPath ios/.build -resultBundlePath ios/.build/d09-baseline.xcresult > ios/.build/d09-baseline.log 2>&1
xcodebuild test -project ios/Yarnflow.xcodeproj -scheme Yarnflow -destination 'platform=iOS Simulator,id=541B11E5-FC20-4928-81ED-5F7DB6330C48' -parallel-testing-enabled NO -derivedDataPath ios/.build -resultBundlePath ios/.build/d09-red.xcresult > ios/.build/d09-red.log 2>&1
xcodebuild test -project ios/Yarnflow.xcodeproj -scheme Yarnflow -destination 'platform=iOS Simulator,id=541B11E5-FC20-4928-81ED-5F7DB6330C48' -parallel-testing-enabled NO -derivedDataPath ios/.build -resultBundlePath ios/.build/d09-ui-red.xcresult > ios/.build/d09-ui-red.log 2>&1
xcodebuild test -project ios/Yarnflow.xcodeproj -scheme Yarnflow -destination 'platform=iOS Simulator,id=541B11E5-FC20-4928-81ED-5F7DB6330C48' -parallel-testing-enabled NO -derivedDataPath ios/.build -resultBundlePath ios/.build/d09-final.xcresult > ios/.build/d09-final.log 2>&1
xcodebuild test -project ios/Yarnflow.xcodeproj -scheme Yarnflow -destination 'platform=iOS Simulator,id=541B11E5-FC20-4928-81ED-5F7DB6330C48' -parallel-testing-enabled NO -derivedDataPath ios/.build -only-testing:YarnflowTests/QCContractTests/testSharedFixturesAreBundled -resultBundlePath ios/.build/d09-fixture-red.xcresult > ios/.build/d09-fixture-red.log 2>&1
xcodebuild test -project ios/Yarnflow.xcodeproj -scheme Yarnflow -destination 'platform=iOS Simulator,id=541B11E5-FC20-4928-81ED-5F7DB6330C48' -parallel-testing-enabled NO -derivedDataPath ios/.build -resultBundlePath ios/.build/d09-verified.xcresult > ios/.build/d09-verified.log 2>&1
xcodebuild build -project ios/Yarnflow.xcodeproj -scheme Yarnflow -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO -derivedDataPath ios/.build > ios/.build/d09-device-build.log 2>&1
```

Also ran `xcodebuild -list -project yarnflow/ios/Yarnflow.xcodeproj` from the repository root, `xcodebuild -version`, `git diff --check -- ios` from yarnflow (clean), `xcrun simctl list devices`, `xcrun simctl list devices booted`, `xcrun simctl list devices --json`, and `xcrun xcresulttool get test-results tests/summary --path <each result bundle>` to read case counts. No test counts apply to list/build/diff/simulator inspection commands. The final shutdown check only shuts down the recorded UDID if it is Booted; it was already Shutdown. Node/Python suites were not run for these native-only edits.

## Fixture counts

Shared rows exercised, by type. A dash means that canonical invalid.json contains no row for that type, not a skipped assertion. The separate derived-invalid test exercises and prints a positive count for every type.

| Type | Valid | Invalid | Derived invalid |
|---|---:|---:|---:|
| AcquisitionAttestation | 2 | — | 2 |
| Adjudication | 3 | 2 | 3 |
| AnalysisCandidate | 1 | — | 1 |
| AnalyzeRequest | 1 | 3 | 1 |
| AssertionClaims | 1 | 3 | 1 |
| AxisRegistration | 1 | 1 | 1 |
| CalibrationProfile | 1 | 2 | 1 |
| Capture | 2 | 4 | 2 |
| CaptureSet | 2 | 4 | 2 |
| ConsentAuthority | 1 | 1 | 1 |
| Decision | 2 | 1 | 2 |
| DecisionDraft | 4 | 5 | 4 |
| DensitySpec | 2 | — | 2 |
| DomainManifest | 1 | 2 | 1 |
| ErrorEnvelope | 1 | 2 | 1 |
| EvaluationContext | 1 | 2 | 1 |
| Evidence | 3 | 22 | 3 |
| Policy | 2 | 3 | 2 |
| Provenance | 2 | 1 | 2 |
| PurchaseSpec | 3 | 18 | 3 |
| QCResult | 7 | 6 | 7 |
| Readiness | 1 | 3 | 1 |
| Release | 2 | 3 | 2 |
| Sample | 3 | 4 | 3 |
| SamplingSelection | 2 | 2 | 2 |
| ScaleReference | 1 | — | 1 |
| ValidatedCapture | 1 | 2 | 1 |

Totals: 53 valid rows / 27 types; 96 invalid rows / 23 types; 53 derived invalid rows / 27 types. No shared fixture was skipped.

Bundled bytes were also compared to the canonical files and matched exactly:

- valid.json SHA-256: `4fb67c8097391c16db263c7f5bebeb2f8baab4dbee2a496a97867ae8ac4452e1`
- invalid.json SHA-256: `eb50fe62c820b919720bd306fe817a643f1d8935ab4d8d0bdc3f8da6ece61338`

## Unproven requirements / external work

- G8 physical device/signing access is not available: no signed install, actual device file-protection enforcement, real camera/Photos permission/capture, VoiceOver or low-connectivity phone proof. The generic device build and Simulator tests do not establish these.
- Fluent textile-QC English/Urdu review and real-device RTL/units/region-list accessibility evidence are not yet collected / external gate G8. New translations are draft, not approved.
- Real native Worker cookie acquisition/upload, Keychain/device security, fixed Origin acceptance, revocation/cancel races, and server-backed workflow integration are not established by URLProtocol/credential doubles; no server/network was used in this task. Those T08/G8 integration gates remain external.
- No change outside the owned directory is required for the D09 repair. Optional canonical fixture follow-up for the lead: add invalid rows for AcquisitionAttestation, AnalysisCandidate, DensitySpec and ScaleReference; those four currently have only valid shared rows. Their unknown-field rejection is covered by derived negatives here; the frozen shared files were untouched.
- Existing generic-build warnings remain: AVCaptureSession is captured by Sendable closures, the Info.plist UIDeviceFamily is overwritten by TARGETED_DEVICE_FAMILY, and AppIntents metadata extraction has no framework dependency. No warnings were suppressed or baseline tests weakened.
- The broader T08 signed operational/device acceptance and external gates remain incomplete; this report closes the requested simulator test repair, not the full native production milestone.
