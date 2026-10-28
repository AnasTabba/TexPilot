#!/bin/zsh
set -euo pipefail
APP_ROOT="${0:A:h:h}"
BUILD_ROOT="$APP_ROOT/build"
APP_BUNDLE="$BUILD_ROOT/Yarnflow.app"
mkdir -p "$APP_BUNDLE"
SDK_PATH=$(xcrun --sdk iphonesimulator --show-sdk-path)
xcrun swiftc -swift-version 5 -D DEBUG -parse-as-library -sdk "$SDK_PATH" -target arm64-apple-ios17.0-simulator -module-name Yarnflow -O -g "$APP_ROOT"/Yarnflow/*.swift -o "$APP_BUNDLE/Yarnflow"
mkdir -p "$APP_BUNDLE/ScannerArt"
for source in "$APP_ROOT"/../artwork/scanner-outcomes/still/*.webp; do
  stem="${source:t:r}"
  if [[ ! -f "$APP_BUNDLE/ScannerArt/$stem.png" ]]; then sips -s format png "$source" --out "$APP_BUNDLE/ScannerArt/$stem.png" >/dev/null; fi
done
cp "$APP_ROOT/../artwork/scanner-outcomes/manifest.json" "$APP_BUNDLE/scanner-artwork.json"
cp "$APP_ROOT/Info.plist" "$APP_BUNDLE/Info.plist"
cp "$APP_ROOT"/Resources/*.png "$APP_BUNDLE/"
printf 'APPL????' > "$APP_BUNDLE/PkgInfo"
codesign --force --sign - "$APP_BUNDLE"
echo "$APP_BUNDLE"
