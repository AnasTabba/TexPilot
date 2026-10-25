# Yarnflow native iOS app

A separate SwiftUI application, not a web view. Requires Xcode and an Apple Silicon Mac.

```sh
./ios/scripts/build.sh
xcrun simctl boot 4166467C-9C8F-434D-B0F7-932A7BCC428A
xcrun simctl install booted ios/build/Yarnflow.app
xcrun simctl launch booted com.texpilot.yarnflow
open -a Simulator
```

Open local workspace connects to the development API at `http://127.0.0.1:8788`.
Explore design review is an explicitly separate in-memory workspace. Review mode
never writes to the connected ledger. Server failures never substitute sample data.

Includes login, sidebar, overview, inventory, materials, production, dispatch,
quality, scanner, activity, reports, people, settings, and help/privacy. Stock forms
validate and offer review before saving. Dispatch requires QC approval. Native
camera capture is device-only; Photos picker and label entry work in the simulator.
The model endpoint is configured separately and does not invent inspection results.

The native app uses Dynamic Type, semantic colors, native controls, safe-area
layout, reduced-motion support, and 44-point minimum controls. Physical-device,
VoiceOver, largest Dynamic Type, landscape, and camera acceptance remain to be
completed. This build script produces a simulator app. Device signing and App Store
packaging are separate work. Hosted native authentication is not configured;
local development login is explicitly labeled. Hosted web authentication remains
with the existing account provider.

Debug-only review launch: `xcrun simctl launch booted com.texpilot.yarnflow --review`.
Review a page directly: append `--page inventory` (or any AppPage raw value).
