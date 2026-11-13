# Independent reviewer 16 — native/mobile/capture/accessibility/Urdu

Recommendation: revise before executing T07/T08. No P0 identified. This is a source review of proposed behavior, not evidence of shipped v2 or physical validation. Existing legacy limitations below matter because task acceptance does not yet make their replacement concrete.

## Findings

### P1 — Capture profile identity is not proof that this capture used that profile

Evidence: design §3 `Capture` records device_profile_id, dimensions and calibration_id, while §§5/15 require matching lens, focus, distance and processing and fail closed on lens switching/autofocus drift. Existing `yarnflow/ios/Yarnflow/Workflows.swift:83–86` uses UIImagePickerController and encodes originalImage as JPEG at 0.9; `:76` encodes again at 0.86. Existing `yarnflow/src/Scanner.tsx:260–285` captures a video frame into a canvas capped at 1600 pixels. Neither mechanism supplies the required acquisition-state binding. T07/T08 test original hashes/preservation, which alone cannot establish lens/focus/profile compatibility even for byte-perfect uploads.

Correction: define the capture acquisition/processing attestation fields and their server validation in T01/T04, then explicitly make T07/T08 consume them. Use a capture API capable of recording the required state where available; imported photos or browser capture with unobservable required state must remain review-only unless separately physically validated as a permitted acquisition mode. Do not treat a user-selected profile ID as measured compatibility.

Test assertion: an unchanged image hash with an unknown lens, changed zoom/focus or absent required acquisition metadata cannot obtain automatic ACCEPT/HOLD under a profile requiring those fields; a legacy reencoded/canvas image cannot claim the original profile. G3 remains an external physical validation gate, not something metadata tests can approve.

### P1 — Native authenticated upload depends on an unassigned sign-in/session lifecycle

Evidence: `yarnflow/ios/Yarnflow/Models.swift:55–67` requests `/api/workspace` through URLSession.shared and clears shared cookies on signOut, but has no login/session acquisition or expiry recovery. `yarnflow/ios/Yarnflow/Workflows.swift:41` explicitly says native hosted authentication needs its own deployment configuration. `yarnflow/server/auth.mjs:18–34` accepts the yf_session cookie (HttpOnly/SameSite=Strict); this is not a generic bearer contract. T08 names an authenticated Worker path and Keychain credentials, but its only produced interface is analyze; it does not assign acquisition, renewal/reauthentication, credential type, or the native Origin/CSRF behavior required by design §§9–10.

Correction: assign native sign-in/session acquisition and logout/revocation to T08's existing AppStore boundary, explicitly reuse the server's actual session contract, and document the native Origin/service-auth handoff. Store only the credential type actually supported; do not invent a second bearer endpoint implicitly. Record the G8 deployment/security decision before production use.

Test assertion: starting with an empty native cookie/credential store, a real Worker login establishes a session and uploads as the correct actor/workspace; expiry pauses the protected draft for reauthentication, cancellation never uploads, account switch cancels pending work and purges prior accessible drafts, and a revoked session cannot complete analysis. A mocked authenticated request is insufficient proof of login interoperability.

### P2 — Native real-phone proof has no buildable device artifact assigned

Evidence: there is no ios/Yarnflow.xcodeproj in the inspected file inventory. `yarnflow/ios/scripts/build.sh:7–8` compiles directly for arm64-apple-ios17.0-simulator and ad-hoc signs the bundle; `yarnflow/ios/Info.plist` declares only iPhoneSimulator in CFBundleSupportedPlatforms. T08 acknowledges an absent test target/scheme, but only assigns Swift files and says to add a target/scheme; its verification command assumes the absent project. T08/T12 nevertheless require real-phone camera and VoiceOver proof. A simulator scheme alone does not create a deployable device target.

Correction: explicitly assign a minimal project/device target/shared test scheme and Info.plist/build integration to T08, with simulator and device procedures separated. Device signing/provisioning availability is an external execution prerequisite; no purchase or fabricated successful device evidence is warranted.

Test assertion: list the actual shared scheme, compile its simulator test target, compile a generic iOS device target, and record installation plus camera/permission/VoiceOver results on a named physical device. Mark physical evidence blocked if authorized signing/device access is unavailable instead of substituting simulator results.

### P2 — Native Urdu and accessibility acceptance is bundled into a non-UI contract test

Evidence: T08 assigns all assertions, including “VoiceOver/Urdu on real phone,” to YarnflowTests/QCContractTests.swift and an xcodebuild test invocation. Existing native `yarnflow/ios/Yarnflow/Workflows.swift:40–68` uses English literals throughout settings and capture; `yarnflow/ios/Yarnflow/YarnflowApp.swift:69–92` likewise owns English navigation/accessibility labels. There is no inspected native language/catalog ownership. Design §10 requires translated technical instructions validated by a fluent reviewer, RTL, isolated Latin units/numbers and an accessible defect-region alternative. T07 owns qc-reasons.ts only for web, which does not supply a Swift localization resource or UI behavior.

Correction: give T08 explicit native reason/instruction catalog and locale/layout ownership, with parity against canonical reason codes rather than duplicated policy. Separate Codable unit tests, native UI tests, and a recorded fluent-reviewer/VoiceOver device checklist; specify that the surrounding route, status announcements and region-list actions are included in the QC task's localized surface.

Test assertion: every Reason and every QC capture/error/retry state has reviewed English/Urdu text; switching to Urdu renders RTL while sample IDs, count/in and numeric intervals retain reading order; maximum Dynamic Type preserves actionable controls; VoiceOver announces the current sample status and can reach each capture-owned defect region without interpreting an image. Human linguistic/VoiceOver acceptance cannot be inferred from Codable tests or web axe.

## Inspected paths and proof limits

- `scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md` (including integrated §§14–16) and `scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md` (especially T01/T04/T07/T08/T12/T13).
- `yarnflow/ios/Yarnflow/{Models,Workflows,YarnflowApp,ScannerOutcomeArtwork}.swift`, `yarnflow/ios/Info.plist`, `yarnflow/ios/scripts/build.sh`; recursive native file inventory.
- `yarnflow/src/{Scanner,SpecScan,InspectArrival}.tsx`, `yarnflow/src/scanner-client.ts`, `yarnflow/server/auth.mjs`.

Read-only source tracing and file inventory were sufficient for this review; no product tests, device tests, installation, training, deployment or purchases were performed. Preserve the drafts' existing review-only default, original-evidence separation, sample-only scope and external G1–G8 gates; revise the concrete task ownership/proof above before claiming mobile/native completion.
