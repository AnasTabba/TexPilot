# W4: native iOS P0/P1 fixes (R07)

Date: 16 Nov 2026
Scope: `yarnflow/ios/**` only. Xcode is not installed; no XCTest/XCUITest/build was run and no deploy or network call was made.

## Status summary

| Finding | Status | Where |
| --- | --- | --- |
| P0-1 foreign sample result while busy | fixed (already in working tree at start of pass, verified) | `QCWorkflow.swift` |
| P1-1 retry makes a new idempotency key | fixed (already in working tree, verified) | `QCWorkflow.swift` |
| P1-2 late result installed after sign-out | fixed (already in working tree, verified); extra test added | `QCWorkflow.swift`, tests |
| P1-3 constant `processing` attestation | fixed (already in working tree, verified by reading) | `QCCapture.swift` |
| P1-4 loopback release origin | fixed in this pass | `QCClient.swift`, `Info.plist`, tests |

No P0/P1 was skipped. P2 items were not in scope and were not changed except where they were already present in the working tree at the start of this pass (`QCTypes.swift` consent instants, `QCContractTests.swift` fixture assertions) and are noted below so the lead is not surprised by them.

## Per finding

### P0-1 - a tap on another sample while busy shows the other sample's result

Fixed. `open(_:)` now returns before clearing the screen when `busy` (`QCWorkflow.swift:115-117`), the sample buttons are `.disabled(model.busy)` (`:271`), `open` refuses an answer whose sample ID is not the requested one (`:122`), and `install` checks `alive(current)` before and after the `bindScreen` await and before writing `result` (`:132-140`).

Tests: `QCWorkflowModelTests.testTapWhileBusyIsIgnoredAndOnlyTheOpenSampleInstalls`, `testOpenRefusesResultWithDifferentSampleID`, `testEntryPointsDoNothingWhileBusy`. Also executed as scratch-harness checks (below): "P0-1 only sample A is installed", "P0-1 tap B sent no request", "refuse mismatched sample id", "busy entry points keep the screen" - all PASS.

### P1-1 - a retry after an unknown outcome creates a new key

Fixed. `keyed(_:)` stores one key per action signature and reuses it across taps; it drops the key only after a definitive server refusal (`4xx`/failed request) because nothing was committed (`QCWorkflow.swift:72-84`). All mutations now go through it: selection (kept until the sample exists, `:146-151`), sample, linked evaluation, capture set, close, adjudicate, analyze. The upload key remains derived from the capture ID (`QCClient.swift:341`).

Test: `QCWorkflowModelTests.testRetriesReuseOneKeyAndRefusalDropsIt`. Harness checks: "P1-1 ten requests", "retries reuse one key", "tap after unknown reuses the key", "refusal allows a new key" - all PASS.

### P1-2 - late successful results installed after sign-out

Fixed. Every mutation path now captures `epoch` in `run` and calls `alive(current)` after each await; success writes are gated (`QCWorkflow.swift:63-71`, `:95-100`, `:105-140`, `:141-215`). The error path keeps its existing epoch check. `install` re-checks after the client await and before writing (`:132-140`).

Tests: `testAnswerThatArrivesAfterClearWritesNothing` (status/load path) and the new `testSampleAnswerThatArrivesAfterClearIsNotInstalled` (install path: sample answer released after `clear()` must leave `result`, `specification` and `familyHistory` empty and must not fetch the spec). Harness: "P1-2 late status writes nothing", "P1-2 stale op sends no next request", "P1-2 late sample is not installed", "P1-2 no spec fetch after clear" - all PASS.

### P1-3 - constant `processing` makes every native capture non-review-only

Fixed. `QCCamera.capture()` now records `processing: nil` with the reason in a comment; `QCAcquisitionAttestation.isReviewOnly` therefore stays true for a camera capture whose processing was not observed (`QCCapture.swift:136-137`, `QCTypes.swift:350-352`). No other attestation field is fabricated; `device_model`, `lens_id`, `zoom_factor`, focus/exposure and timestamp still come from the device.

Test: **skipped**. Exercising `QCCamera.capture()` needs `AVCaptureDevice`/`AVCapturePhotoOutput` on hardware (or at least an iOS SDK build), and there is no seam that observes the attestation without a capture. Verified by reading only: line 137 passes `processing: nil`. No threshold or validation was relaxed.

### P1-4 - release origin is a loopback development address

Fixed in this pass.

- `QCConfig` now has a build policy. `Policy.current` is `.development` with `-D DEBUG` and `.release` otherwise (`QCClient.swift:10-24`). `permits(scheme:host:policy:)` accepts HTTPS always, and in debug accepts HTTP only for `127.0.0.1`/`localhost` when the policy is `.development`; the `#else` branch of the release build returns false for every HTTP origin, so the allowance is compiled out (`:28-36`). `bundled()` reads `YFQCAppOrigin` in release and `YFQCAppOriginDebug` in development (`:37-41`).
- `Info.plist`: `YFQCAppOrigin` is now `https://yarnflow.yarnflow-workspace.workers.dev`; the existing loopback address moved to the debug-only key `YFQCAppOriginDebug`. The URL is the deployed Worker recorded in `NEXT_SESSION.md`; it must be confirmed against the live deployment (G8) before release.
- Test: `QCContractTests.testReleaseOriginIsHTTPSOnly` (rejects loopback and non-loopback HTTP under `.release`, accepts HTTPS, allows loopback only under `.development`, and asserts the two bundled plist keys).

## Commands and results

XCTest: **not run** (no Xcode, no iOS SDK). The XCTest target and `@testable import` cannot be built with the command-line toolchain on this Mac. Tests below are written/registered but have not executed.

1. `swiftc --version` -> Swift 6.4.
2. `swiftc -typecheck yarnflow/ios/Yarnflow/QCTypes.swift` -> exit 0.
3. `plutil -lint yarnflow/ios/Info.plist` -> OK; `plutil -extract YFQCAppOrigin raw ...` -> `https://yarnflow.yarnflow-workspace.workers.dev`; `plutil -extract YFQCAppOriginDebug raw ...` -> `http://127.0.0.1:8788`.
4. Scratch config harness (`/tmp/qc-harness.*`, unchanged copies of `QCTypes.swift` + `QCClient.swift` + a `QCText`/`QCCrypto` shim), compiled with `swiftc -swift-version 5 -D DEBUG ...`: **9/9 PASS** (release rejects 127.0.0.1/localhost/other HTTP, release accepts HTTPS, development accepts both loopback forms, development rejects non-loopback HTTP and path/query, default policy is development).
5. Same config harness compiled **without** `-D DEBUG`: **6/6 PASS** (release policy selected; HTTP loopback rejected even when `.development` is passed; HTTPS accepted; both plist key names correct).
6. Scratch model harness (`/tmp/qc-model-harness.*`): the model part of `QCWorkflow.swift` (lines 1-216, copied unchanged) + `QCTypes.swift` + `QCClient.swift` + scenario stubs, compiled with `swiftc -swift-version 5 -D DEBUG -parse-as-library`, built-in schema and fixtures copied beside the binary. **25/25 PASS**, 0 failed: P0-1 (5), mismatch refusal (1), busy entry points (1), P1-2 status (2), P1-2 install (2), P1-1 (4), P2-1 consent instants (7), plus "operation reached the gate" checks (3). No production file was patched for the harness.
7. `swiftc -typecheck` of the model part plus `QCTypes.swift`/`QCClient.swift` and stubs -> exit 0 (only stub-induced warning about a non-throwing `QCDraftStore` stub).

Not verified: the SwiftUI view body (`QCWorkflow.swift:218+`) and `QCCapture.swift`/`QCCamera` were not compiled (UIKit/AVFoundation, no iOS SDK); the XCTest/XCUITest suites were not run; the release origin reaching the Worker over HTTPS, its cookie flags and the app-switcher/privacy behaviour are unverified (G8, needs a device and network).

## Files changed

Changed in this pass (P1-4):
- `yarnflow/ios/Yarnflow/QCClient.swift`
- `yarnflow/ios/Info.plist`
- `yarnflow/ios/YarnflowTests/QCContractTests.swift` (added `testReleaseOriginIsHTTPSOnly`)
- `yarnflow/ios/YarnflowTests/QCWorkflowModelTests.swift` (added `testSampleAnswerThatArrivesAfterClearIsNotInstalled`; fixed the consent helper to send explicit `withdrawn_at: null` and to build date-only/unparsable records directly, since the contract decoder refuses those shapes)

Already modified in the working tree when this pass started (carries P0-1, P1-1, P1-2, P1-3 and the P2-1/P2-13 work; verified, not re-edited except the test file above):
- `yarnflow/ios/Yarnflow/QCWorkflow.swift`
- `yarnflow/ios/Yarnflow/QCCapture.swift`
- `yarnflow/ios/Yarnflow/QCTypes.swift`
- `yarnflow/ios/YarnflowTests/QCContractTests.swift` (fixture assertion hardening)
- `yarnflow/ios/YarnflowTests/QCWorkflowModelTests.swift` (new file)
- `yarnflow/ios/Yarnflow.xcodeproj/project.pbxproj` (registers `QCWorkflowModelTests.swift`; **not edited in this pass**)

No other file was touched, and no git write command was run.
