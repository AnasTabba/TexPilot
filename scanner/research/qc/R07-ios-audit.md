# R07: Native iOS client audit, incoming-fabric QC v2

Date: 14 Nov 2026
Scope: `yarnflow/ios/` QC code (`QCTypes.swift`, `QCClient.swift`, `QCCapture.swift`, `QCWorkflow.swift`, the QC parts of `Models.swift`, `Workflows.swift`, `YarnflowApp.swift`, `Localizable.xcstrings`, `Info.plist`), tests (`YarnflowTests/QCContractTests.swift`, `YarnflowUITests/QCWorkflowTests.swift`), and the contract (`scanner/contracts/qc-v2.schema.json`, `scanner/services/api/qc_schemas.py`), plus the design spec and plan T08.
Method: read-only. No source file was edited, committed or pushed. Scratch harnesses lived outside the repo.

## Execution status

- Xcode is not installed. `xcodebuild`, the XCTest target and the XCUITest target were not run.
- `swiftc` 6.4 on this Mac: `QCTypes.swift` typechecks (exit 0, no diagnostics). `QCClient.swift` typechecks with a verbatim copy of `QCText` and `QCCrypto` as shims, because those live in SwiftUI/UIKit files (exit 0).
- Executed harnesses (copies of the app code compiled unchanged, outside the repo):
  - `QCTypes.swift` decoder over `scanner/tests/fixtures/qc-v2/valid.json`: 53/53 rows round-trip to identical JSON.
  - Same decoder over `invalid.json`: 107/107 rejected (51 by the JSON-Schema validator, 56 by the Swift cross-field rules).
  - Unknown-field probe on every valid row: 0/53 accepted.
  - Default-path invalid check with no bundled schema: all 107 "throw", but for `contractUnavailable`, so the invalid-fixture assertion cannot tell a real rejection from a missing schema (see P2-13).
  - `QCClient` against a `URLProtocol` double: 429/503/504 retried with one Idempotency-Key and delays 1, 2, 4 s; 409 not retried; lost connection on POST gives four attempts with one key, then `unknownOutcome`; two separate taps on "create selection" use two keys.
  - `permitsCapture` timestamp comparison reproduced verbatim.
- Python on the schema: all 40 mirrored decoders checked for property names, nullability and `additionalProperties`; all 27 reason values and 13 error codes compared; keyword coverage checked.
- The string catalog was checked with a script for all 171 QC keys used in code.
- Not executed: `QCWorkflow.swift` and `QCCapture.swift` (need SwiftUI/UIKit/AVFoundation/PhotosUI), the `@MainActor` model in `QCWorkflow.swift`, the XCTest and XCUITest suites, and everything device-only.

Severity: **P0** wrong or foreign decision can be displayed, or stale data can leak across sign-ins. **P1** contract mismatch, lost update or double-submit risk. **P2** hardening, accessibility, test quality.

---

## Defects

### P0

**P0-1. A tap on another sample while an operation is in flight displays that other sample's result.** Verified by reading only.

`QCWorkflow.swift:228` (the samples list is not disabled while busy):
```swift
Section(QCText.t("qc.samples")) { ForEach(model.samples) { sample in Button { Task { await model.open(sample.id) } } label: { ... } } }
```
`QCWorkflow.swift:89-91` (`open` clears the screen before the busy guard):
```swift
func open(_ id: String) async {
    result = nil; familyHistory = []; await client?.bindScreen(nil)
    await run {
```
`QCWorkflow.swift:58` (`run` drops the operation silently when busy):
```swift
guard !busy else { return }
```
`QCWorkflow.swift:100-104` (`install` writes whatever came back, with no check that the screen still matches):
```swift
result = value
let set = value.capture_sets.last
await client?.bindScreen(QCExpectation(sampleID: value.sample.id, ...))
```

Why it is wrong: a 60 s analysis poll or an upload is in flight. The operator taps sample B. `open(B)` clears the screen and unbinds it, then `run` returns without doing anything. When the in-flight call finishes, `install` at lines 112, 129, 140, 148 and 170 sets `result` to sample A and rebinds the screen to A. The operator sees A's decision or evidence while believing B is open. Subsequent writes (upload, close, adjudicate) use `result`, so they target A. Only `analyze()` has a guard (`QCWorkflow.swift:161`, which checks epoch and sample id).

Fix: disable sample buttons while `busy`, and make every mutation path apply its result only when `epoch` and `result?.sample.id` still match the operation's start, as `analyze()` already does at line 161.

### P1

**P1-1. Retrying after an unknown outcome creates a new idempotency key, so the server cannot deduplicate.** Verified by reading and by executing `QCClient` (two taps produced two distinct keys).

`QCWorkflow.swift:111-112`:
```swift
let selection = try await client.createSelection(input, idempotencyKey: UUID())
try await install(client.createSample(QCSampleInput(...), idempotencyKey: UUID()))
```
The same pattern is at `:120` (linked evaluation), `:129` (capture set), `:148` (close) and `:170` (adjudication). Only `analyze()` (`:153-154`) and the upload key (`QCClient.swift:341`, derived from the capture ID) are stable across taps.

Why it is wrong: the app promises a retry replays the same key (`qc.error.UNKNOWN_OUTCOME`: "repeating is safe"; `qc.retry_same_key`). Each tap of "Create sample" after a lost answer makes a new selection and a new sample. `createSelection` has no revision guard. The schema makes `Family` per `selection_id` with `attempts_max` fixed at 3 (`qc-v2.schema.json`, `Family.attempts_max` const 3). A duplicate selection therefore starts a fresh attempt budget, which defeats the attempt limit. Server behaviour for this case was not verified.

Fix: store the key with the pending action (as `analysisKey` does) and reuse it until the action succeeds or the operator explicitly abandons it. Better still, reload the sample by `GET` before offering the same action again.

**P1-2. Late successful results are installed after sign-out or account change.** Verified by reading.

`QCWorkflow.swift:57-63` checks the epoch only on the error path:
```swift
do { try await operation() }
catch { if epoch == current { self.error = ...; state = ... } }
```
The success paths have no check: `load()` (`:73-78`), `choose` (`:86`), `open` (`:93-104`), `createSelection`/`linkedEvaluation`/`beginCaptureSet`/`upload`/`close`/`adjudicate` (`:112`, `:122`, `:129`, `:140`, `:148`, `:170`), and `install` (`:102`) writes `result` unconditionally.

`logout()` (`:52-56`) calls `clear()` (epoch+1, `result = nil`) and starts `Task { await client?.signOut() }`. The client's generation check (`QCClient.swift:257`, `:270`, `:360`, `:369`) only drops responses that reach the client after the bump. A response that passed the client check before logout can resume on the main actor after `clear()`, and `install` then sets `result` from the previous account. The next sign-in clears it, so the leak window is the stretch between the client check and the main-actor resumption. It is narrow but real, and it breaks the spec rule that late results are ignored unless sample, spec, capture hash and revision match (design §10, line 151).

Fix: capture `epoch` before each awaited call and drop the result in `install` (or in each caller) when it differs.

**P1-3. Capture attestation `processing` is a hard-coded constant, so every camera capture passes the native-capture gate.** Verified by reading.

`QCCapture.swift:136`:
```swift
observed = QCAcquisitionAttestation(image_sha256: "", capture_mode: .NATIVE_CAMERA, device_model: Self.hardwareModel, ..., processing: "AVCapturePhotoOutput JPEG; device processing", captured_at: ...)
```
`QCTypes.swift:350-352` makes `isReviewOnly` false when every field is non-nil. The `processing` string is a fixed claim about a pipeline step, not something observed on this capture. The attestation must bind what the device actually observed (design §18; spec line 240, "binds ... observable state"). The server's own attestation rules (`qc_schemas.py:414-431`) use `null` for "not observed", so a fixed string is a false positive.

Fix: set `processing` to `nil` unless the device reports the processing it applied, so a native capture without observed processing stays review-only.

**P1-4. The release origin is a loopback development address.** Verified by reading (Info.plist and code).

`Info.plist:67-68`:
```xml
<key>YFQCAppOrigin</key>
<string>http://127.0.0.1:8788</string>
```
`QCClient.swift:16-17` accepts `http` for `127.0.0.1` and `localhost` in every build:
```swift
scheme == "https" || (scheme == "http" && ["127.0.0.1", "localhost"].contains(host))
```
On a phone, `127.0.0.1` is the phone itself, so QC cannot reach the Worker in a release build. The client fails closed (no decision is shown), so this is not a wrong-decision risk, but the build is not shippable as configured. The spec requires a G8 proof for the fixed origin (plan T08, "Fixed native Origin behavior needs G8 integration proof").

Fix: separate per-configuration origins. Release uses the HTTPS Worker origin only, and the `http` loopback allowance is compiled out of release builds (`#if DEBUG`).

### P2

**P2-1. Consent records are compared as strings for time.** Verified by execution (`permitsCapture` logic reproduced verbatim).

`QCTypes.swift:373-376`:
```swift
let stamp = QCTime.string(now)
return operational_capture && withdrawn_at == nil && valid_from <= stamp && stamp < expires_at
```
The schema allows fractional seconds in these timestamps (`captured_at` and `valid_from` patterns allow 1-6 digits). Lexical comparison gives: a consent with `valid_from` `10:00:00.250Z`, checked at `10:00:00Z`, is offered as permitted (wrong). A consent with `expires_at` `10:00:00.500Z`, checked at `10:00:00Z`, is refused (fail-closed). The server checks again, so the impact is a wrong offer in the picker, not a wrong capture. Fix: parse with `QCTime.date(_:)` (`QCTypes.swift:627`) and compare `Date` values.

**P2-2. An internal reviewer note is shown to Urdu users.** Verified by reading.

`QCWorkflow.swift:211`: `if Locale.current.language.languageCode?.identifier == "ur" { Text(QCText.t("qc.urdu_review")) }`. The catalog value is "Urdu wording needs fluent textile-QC review." (Urdu translation of the same). This is a development note in the user interface. Fix: remove the line and get the fluent review before release.

**P2-3. Some user-facing text bypasses the catalog, and system errors show in English.** Verified by reading.

- Glue text and punctuation are hard-coded: `QCWorkflow.swift:223` (`"\(...) \(...)"`), `:282`, `:295` (`" · "`), `:311` (`": "`), `:318-321`, `:329`. Word order and separators are not translatable and can read wrongly in RTL.
- `QCWorkflow.swift:236` shows `model.error` built from `error.localizedDescription`. `QCWorkflow.swift:373` does the same for draft-store failures. Non-`QCError` errors (for example `CancellationError` from `Task.checkCancellation`, `QCClient.swift:254`, or file errors from `QCDraftStore.save`) therefore show English system text.

Fix: map every error to a catalog key, including a generic fallback, and move the separators into catalog format strings.

**P2-4. Operations dropped while busy leave a stuck state label and can drop a photo reference.** Verified by reading.

`QCWorkflow.swift:135` sets `state = "qc.state.uploading"` before `run`, and `run` (`:58`) can return without running. The upload button then runs `if model.error.isEmpty { originalID = nil }` (`:362`), which clears the photo reference even though nothing was uploaded; the draft stays on disk until expiry, with no message. The button is disabled while busy, so this needs a race, but the code allows it. Fix: check `busy` before changing state, and only clear `originalID` when the upload succeeded.

**P2-5. Form state survives sign-out.** Verified by reading.

`QCWorkflow.swift:177-198` keeps `reason`, `references`, `intervention`, `consent`, `profile`, `plan`, `lot` and similar fields in `@State`. `QCWorkflow.swift:246-251` clears only `photo`, `originalID` and the camera. A second operator signing in on the same device sees the previous operator's typed adjudication reason and references. Fix: clear all QC form fields in the `signedIn` change handler.

**P2-6. Authority-changing client methods are compiled in with no UI caller.** Verified by reading and grep.

`QCClient.swift:389-414` defines `confirmSpec`, `registerConsentAuthority`, `registerRelease`, `activateRelease`, `suspendRelease` and `reauthenticate`, which take caller-built JSON bodies. Nothing calls them. The design says the native app only lists releases. These are latent authority surface. Fix: delete them from the iOS target, or compile them out.

**P2-7. Server-supplied identifiers are interpolated into request paths without validation.** Verified by reading.

`QCClient.swift:295` (`"/specs/\(id)"`), `:305` (`"/samples/\(id)"`), `:364` (`"/requests/\(pending.request_id)"`), `:398` (`"/captures/\(Self.lower(id))/original"` uses a UUID and is safe), and `:409`/`:412` (UUIDs, safe). The string-typed ones take server text unchanged, so a value containing `/` or `?` changes the endpoint, sent with the session cookie. Risk is low because the origin is fixed and the server is trusted, but there is no need to rely on that. Fix: accept only UUID-formatted identifiers, or percent-encode each path segment.

**P2-8. 504 is retried, which the spec does not list.** Verified by reading.

`QCClient.swift:150`: `static let retryStatuses: Set<Int> = [429, 503, 504]`. Spec line 153 says "backoff 1,2,4 seconds then explicit retry for retryable transport/429/503 only". Replaying with the same key is safe, but this departs from the written rule. Fix: remove 504 from the automatic retry set, or amend the spec.

**P2-9. No total time limit on mutations.** Verified by reading.

`QCClient.swift:172` sets only `timeoutIntervalForRequest = 60`, which is an idle timeout. There is no `timeoutIntervalForResource`, so a trickling 48 MiB upload has no ceiling, and a POST with retries can run for roughly four minutes. Fix: set `timeoutIntervalForResource` and use the 60 s deadline for each logical request.

**P2-10. The session credential survives app deletion and reinstall.** Verified by reading.

`QCClient.swift:68-82` stores the session in the Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. Keychain items on iOS persist after the app is deleted, so an old session token can be reused after reinstall until the server expires it. Fix: on first launch with no install marker, delete the session item (a non-secret flag in UserDefaults is acceptable).

**P2-11. Conflict and unknown-outcome errors do not reload the screen.** Verified by reading and execution.

`QCWorkflow.swift:62` sets `state = "qc.state.failed"` and stops. The copy for `CONFLICT` says "Reload the sample to see the current state" (`qc.error.CONFLICT`), but no automatic reload happens and no reload control is shown in the result view. A 409 without an error envelope surfaces as `unexpected(409)` (executed), which tells the operator nothing. Fix: on 409 or unknown outcome, reload with `GET /samples/{id}` and show the current state.

**P2-12. The "strict" claim does not cover nine public API shapes.** Verified by reading.

The header (`QCTypes.swift:6-10`) says decoding is strict. But `QCStatus` (`:600`), `QCPurchaseOrderItem` (`:605`), `QCSampleSummary` (`:610`), `QCItems` (`:614`), `QCSpecEnvelope` (`:615`), `QCRequestState` (`:616`), `QCPending` (`:619`), `QCClient.Reauth` and `QCClient.Releases` use plain `Decodable` with no schema validation. Unknown fields are accepted silently. `QCRequestState.result` is still strict, because it decodes through `QCResult.init`. Fix: either validate these shapes against a schema entry or correct the header.

**P2-13. Several tests would pass regardless of the implementation.** Verified by reading and execution.

- `QCContractTests.swift:29` and `:32` increment `expected` and `exercised` together, so the counts at `:47-50` are always equal. Only the set check at `:44` is meaningful.
- `QCContractTests.swift:40` asserts only that `roundTrip` throws. Executed with no bundled schema: all 107 invalid rows throw `contractUnavailable`, so the test passes without any schema rejection. The valid-row test would fail in that case, but the invalid-row test cannot detect it.
- `QCContractTests.swift:62` (unknown-field probe) also accepts any thrown error.
- `QCContractTests.swift:86-87`: the HEIC test passes for any error (the input is not an image, so the error is `unsupported`, not `heic`). `QCText.t(...).isEmpty` is always false, because `NSLocalizedString` returns the key when the entry is missing.
- `QCWorkflowTests.swift:26-27` checks `ACCEPT`/`HOLD` text that is never shown in the signed-out state. `:44` only checks that the Urdu banner differs from an English string, not that Urdu text is present.
- No test covers `analyze()` (the 202 polling path, `QCClient.swift:353-377`), `QCWorkflowModel`, the stale-install path (P1-2), or key reuse across taps (P1-1).

Fix: assert the error case (`QCContractError.schema` versus `.semantic`), add tests for the listed paths, and make the counters independent.

**P2-14. Resolution and orientation semantics are unconfirmed, and two attestation fields depend on enum debug text.** Needs confirmation.

`QCCapture.swift:41-45` records width and height as stored pixel dimensions and the raw EXIF orientation tag. Spec line 220 requires an upright original raster with the EXIF transform and source dimensions recorded. The contract does not say whether `resolution` is pre-rotation. `QCCapture.swift:136` uses `String(describing: device.focusMode)` and `exposureMode` for attestation fields; the output format of imported AVFoundation enums is not guaranteed and must be checked on a device.

**P2-15. Accessibility gaps against the spec.** Verified by reading.

- Spec line 155 requires "text plus icons" for status. The decision status is text only (`QCWorkflow.swift:304`). Text is present, so colour is not the sole cue, but the icon requirement is not met.
- The decision heading (`:303-304`) has no heading trait, so VoiceOver users cannot jump to it.
- Region rows read raw arrays aloud (`QCWorkflow.swift:329`: `\(region.box)`), and UUIDs are read character by character (`:281`, `:295`).
- The state change is not announced; only the error has `.updatesFrequently` (`:236`).

**P2-16. Imported originals keep their metadata, including location.** Design decision to confirm.

`QCCapture.swift:47-50` loads the picker bytes unchanged and uploads them unchanged (spec: originals untouched). Library photos can carry GPS EXIF. Spec line 139 says to strip GPS from derived artifacts and protect originals, so this follows the letter of the spec. Confirm that GPS in retained originals is accepted.

**P2-17. Unused catalog keys.** `qc.error.ABORTED`, `qc.error.BAD_RESPONSE`, `qc.error.STALE_SESSION`, `qc.error.TRANSPORT` and `qc.error.UNKNOWN_OUTCOME` are never referenced (the code uses lower-case keys). Harmless, but they will drift. Remove them.

---

## Checked and sound

**A. Contract parity (QCTypes.swift against qc-v2.schema.json)**

- Field names: for all 40 mirrored decoders (`validateDecoder` call sites, `QCTypes.swift:659-1450`), the Swift property set equals the schema property set, and the schema has `additionalProperties: false` on all 45 definitions. No field is missing or extra.
- Nullability: all 348 compared fields have Swift optionality equal to schema nullability.
- Required fields: the schema's `required` list is enforced before decoding (`QCTypes.swift:157-158`, `:161`). Optional decoders accept absent or null, which the pre-validation then limits to the schema's rules.
- DomainManifest: `fabric_artifact_sha256` and `defect_artifact_sha256` are declared (`QCTypes.swift:506`), decoded (`:1224-1225`) and encoded (`:1245-1246`), matching the 14 Nov change.
- Enums: the 27 `QCReason` cases match the schema reason list in order. The 13 `QCErrorCode` cases match. `QCDecisionStatus`, `QCStageState`, `QCStageName`, `QCAxis`, `QCDensityUnit`, `QCConstruction`, `QCCaptureRole`, `QCProvenanceSource`, `QCFace`, `QCCohort`, `QCDisposition`, `QCCaptureMode`, `QCMediaType`, `QCOriginalState`, `QCCaptureSetState`, `QCMode`, `QCAdjudicationOutcome`, `QCReleaseState` and `QCPhysicalIndicator` match their schema enums.
- Schema keywords: every keyword the schema uses (`type`, `pattern`, `minimum`, `maximum`, `exclusiveMinimum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `enum`, `const`, `anyOf`, `$ref`, `items`, `prefixItems`, `required`, `additionalProperties`) is handled by `QCSchema.check` (`QCTypes.swift:108-165`). No schema uses `oneOf`, `allOf`, `not`, `if` or type arrays.
- Limits: `QCLimits` (`QCTypes.swift:286-294`) equals `x-limits`: 12 MiB per original, 48 MiB per set, 16,000,000 pixels, 4 originals per set, 3 capture sets, 60 s deadline.
- Unknown enum and unknown field: an unknown status or reason makes the whole record fail to decode (`QCTypes.swift:251-284` are raw-value enums, `:180` converts to `malformed`), which surfaces as `qc.error.contract` ("no decision can be displayed"). Nothing is mapped to ACCEPT and nothing is dropped. Unknown fields are rejected (executed: 0/53 accepted).
- Executed fixture parity: 53/53 valid rows round-trip exactly; 107/107 invalid rows are rejected (51 by schema, 56 by the Swift cross-field rules, which the JSON Schema cannot express but the Python models enforce).

**B. Authority**

- No Swift code computes a decision status, the `automatic` flag or the mode. `draftRules` (`QCTypes.swift:450-454`), `QCDecisionDraft.check` (`:457`) and `QCDecision.check` (`:463-466`) only validate what the server returned.
- Request bodies carry no workspace id, actor, status, automatic or mode field: `createSelection` (`QCWorkflow.swift:110`, `QCClient.swift:310`), `createSample` (`QCClient.swift:315-316`), `uploadCapture` (`:332-334`), `closeCaptureSet` (`:347`), `analyze` (`:359`: only `expected_revision` and `capture_set_id`), `adjudicate` (`:380`). Identity comes from the session cookie, as the design requires.
- `QCWorkflow.swift:110` sends `cohort: .OPERATIONAL` as a constant. The web client does the same (`yarnflow/src/IncomingFabricQC.tsx:116`), so this is consistent, not a Swift-only default.
- `QCWorkflow.swift:355` filters consent records with `permitsCapture` for display only; the server checks again (P2-1 covers the comparison bug).
- `QCAcquisitionAttestation.isReviewOnly` is used for the operator's guidance text (`QCWorkflow.swift:372`, `:361`) and does not change any decision. Its input is affected by P1-3.
- The legacy inventory code (`Models.swift:32`, `:50`, `:69`; `Workflows.swift:42`; `YarnflowApp.swift:57`, `:72`, `:82`, `:125`) contains no QC decision wiring. `--qc` is compiled only under `#if DEBUG` (`YarnflowApp.swift:56-59`).

**C. Stale and foreign responses, storage**

- Client generation check: every `send` compares the generation before and after the await (`QCClient.swift:244`, `:257`, `:270`). `analyze` drops results for another binding (`:355-360`, `:369`). `invalidate()` (`:220-226`) bumps the generation, cancels the session, deletes the Keychain item and calls the purge handler.
- Purge: `QCWorkflowModel.initialize` wires the handler to purge the draft store and clear the model (`QCWorkflow.swift:41-43`). `clear()` purges again (`:48-51`). `logout()` (`:52-56`) and `login()` (`:64-66`) both go through `clear()`. A 401 invalidates (`QCClient.swift:265`).
- Drafts: removed after a successful upload (`QCWorkflow.swift:141`); expired on each read (`QCCapture.swift:85-87`) and on a 30 s timer (`QCWorkflow.swift:243-244`); the protection class is `.complete` (`QCCapture.swift:64`, `:78`); excluded from backup (`:66-67`).
- Storage: no QC data goes to UserDefaults, AppStorage, SceneStorage, NSCache, Caches or URLCache (grep over the four QC source files). The only UserDefaults use in the app is the legacy inventory server URL (`Models.swift:53-55`), which QC does not use.
- URLCache and cookies: the QC session is ephemeral with `urlCache = nil`, no cookie storage, `.never` accept policy and no credential storage (`QCClient.swift:170-172`). Redirects are refused (`:83-86`). The session cookie is set by hand (`:246`).
- Photo library: read-only. `PhotosPicker` is used for import (`QCWorkflow.swift:358`), and `Photos` is used only to read the authorisation status (`:250`). Nothing is written to the library (no `performChanges`).
- The `Done` button does not purge drafts (`QCWorkflow.swift:240`). That is intended: drafts last 24 h by design, and sign-out purges them.

**D. Requests**

- Idempotency-Key is set on every non-GET request inside `send` (`QCClient.swift:247-250`). Within one logical call it is reused across retries (`:249` is set once; `:261`, `:266`).
- `expected_revision` is sent on capture-set creation (`:326`), upload (`:332`), close (`:347`), analyze (`:359`) and adjudication (`:380`). The server bumps the revision on finalise (`yarnflow/server/qc-store.mjs:621`), and the client expects `expected + 1` for analyze (`QCClient.swift:357`), which matches.
- Retry policy: 429, 503 and 504 retry with the same key; `Retry-After` is honoured and capped at 60 s (`:236-239`, `:266`). Delays are 1, 2, 4 s (`:149`). Transport failure on POST retries with the same key and then returns `unknownOutcome` (`:261`), never a guess. 401 invalidates. 409 is not retried (executed).
- 202 IN_PROGRESS: `analyze` reads `request_id` and polls `GET /requests/{id}` with a 60 s deadline and 2 s sleeps (`:362-376`). It does not trust `status_url` (the server's path is `/api/qc/v2/requests/{id}`, `yarnflow/server/qc.mjs:151`, so the client path matches). Analyze reuses one key per (sample, capture set, revision) (`QCWorkflow.swift:153-154`).
- Upload key: derived from the capture ID (`QCClient.swift:341`), so a retry is the same upload. Original bytes are checked against their hash before sending (`:331`).
- Sign-in: `POST /api/auth/login` carries Origin, sends no Authorization header and stores only the session cookie (`:188-207`). The PIN is cleared from the view before the call (`QCWorkflow.swift:269`) and never stored (`QCContractTests.swift:205`).

**E. Capture**

- No re-encoding: `QCOriginal` keeps the encoded bytes (`QCCapture.swift:39-40`). The camera uses `fileDataRepresentation()` (`:141`) without transformation. The hash is computed on those bytes (`:41-42`), checked again on draft load (`:88`) and before upload (`QCClient.swift:331`).
- HEIC is refused (`QCCapture.swift:32`). Unsupported and oversize images are refused (`:27-39`).
- Real device data, not hard-coded: `device_model` from `uname` (`QCCapture.swift:148`), `lens_id` from `device.uniqueID`, `zoom_factor` from `device.videoZoomFactor` (`:136`), `captured_at` as the tap time (`:136`). Only `processing` is constant (P1-3).
- Timestamps: `QCTime.string` produces `YYYY-MM-DDTHH:MM:SSZ`, which matches the schema pattern for `captured_at` and `taken_at` (`QCTypes.swift:623-626`; executed output `2026-11-14T10:00:00Z`).

**F. Accessibility and language**

- Localisation: all 171 QC keys used in code exist in `Localizable.xcstrings` with `en` and `ur` values. Every `ur` value contains Arabic-script text, so none is left in English. The five unused keys are noted in P2-17.
- Unicode isolates wrap identifiers, units and numbers (`QCWorkflow.swift:11`, used throughout), as the spec asks for RTL.
- Status is conveyed by text: decision status is `Text` (`:304`), stage states are text (`:311`), the error is red and text (`:236`). No state is colour-only.
- Targets: buttons have `minHeight: 48` (`:255`, `:257`, `:357-358`). No fixed-height frames or `lineLimit(1)` are used in QC views, so Dynamic Type can grow the layout.
- Labels: the camera preview has a label (`:255`); stage and density rows and region rows are grouped with `accessibilityElement(children: .combine)` (`:311`, `:322`, `:329`); the review banner and connection state have identifiers used by the UI test (`:206`, `:209`).

**G. Tests that do check something**

- `QCContractTests.swift:89-112`: original preservation, protection options passed to the writer, expiry on `load`, and purge. Real assertions.
- `:127-133`: stale-result rejection for session, spec version and minimum revision (`QCResultGuard`). Real.
- `:182-209`: login path, Origin header, no Authorization header, body shape, PIN absent from stored credentials. Real.
- `:210-231`: retry set, same Idempotency-Key, delays `[1,2,4]`. Real (and confirmed by execution).
- `:232-242`: 409 not retried. Real.
- `:243-259`: transport loss, same key, `.unknownOutcome`. Real.
- `:260-289`: 401 and account switch purge the session and drafts. Real.
- `:113-126`: draft protection attribute on a device. Skipped on Simulator, so it is not evidence yet.

**Other checks**

- Limits and origin validation: `QCConfig` refuses paths, queries, fragments and credentials (`QCClient.swift:15-19`).
- The `Stage` wrapper validates each stage with `OK` requiring value and artifact (`QCTypes.swift:381-389`), and the parent `Evidence` is schema-validated, so stage-level fields are covered.

---

## Could not verify without Xcode or a device

- Whether `QCWorkflow.swift` and `QCCapture.swift` compile against the iOS SDK, and whether `QCWorkflowModel` behaves as read (P0-1, P1-1, P1-2, P2-4, P2-5 are reading-only).
- The XCTest and XCUITest results, including whether `QCSchema.bundled` is found in the test host (`Localizable.xcstrings`, `valid.json`, `invalid.json` and the schema are referenced in `project.pbxproj`; the wiring was not built).
- Draft file protection attribute on a device (`QCContractTests.swift:113-126`, G8).
- Keychain persistence across reinstall (P2-10) and the session behaviour after a reboot.
- `String(describing:)` output for AVFoundation focus and exposure modes on a real iPhone (P2-14).
- How `PhotosPicker` with `preferredItemEncoding: .current` delivers HEIC or edited photos, and whether it transcodes (affects P2-16 and the "no re-encoding" claim).
- Whether the server uses `resolution` as pre-rotation dimensions (P2-14).
- Real-device VoiceOver order and labels, Dynamic Type at the largest accessibility size, RTL rendering of the Urdu strings, and contrast. The spec requires a fluent reviewer and a device checklist (plan T08).
- The app-switcher snapshot may show a decision or evidence. Not addressed in code; no privacy cover is applied.
- The fixed origin reaches the Worker over HTTPS with the expected cookie flags (G8 proof).
- Server behaviour for lost responses after a commit (replay by key or by GET), which P1-1 depends on. The Worker stores idempotency records (`qc-store.mjs`) but this audit did not trace the replay path.
