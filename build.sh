#!/bin/zsh
LAMP_USAGE='  <key>NSMicrophoneUsageDescription</key><string>Go To Ann Arbor listens to your microphone.</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>Go To Ann Arbor turns your speech into text.</string>
  <key>NSCameraUsageDescription</key><string>Go To Ann Arbor uses your camera.</string>
  <key>NSPhotoLibraryUsageDescription</key><string>Go To Ann Arbor uses your photos.</string>
  <key>NSPhotoLibraryAddUsageDescription</key><string>Go To Ann Arbor saves pictures to your photos.</string>
  <key>NSCalendarsFullAccessUsageDescription</key><string>Go To Ann Arbor reads and adds calendar events.</string>
  <key>NSRemindersFullAccessUsageDescription</key><string>Go To Ann Arbor reads and adds reminders.</string>
  <key>NSContactsUsageDescription</key><string>Go To Ann Arbor looks up people in your contacts.</string>
  <key>NSLocationWhenInUseUsageDescription</key><string>Go To Ann Arbor uses your location.</string>
  <key>NSLocationAlwaysAndWhenInUseUsageDescription</key><string>Go To Ann Arbor uses your location, also in the background.</string>
  <key>NSMotionUsageDescription</key><string>Go To Ann Arbor uses the motion sensors and your step count.</string>
  <key>NSBluetoothAlwaysUsageDescription</key><string>Go To Ann Arbor connects to Bluetooth devices.</string>
  <key>NSFaceIDUsageDescription</key><string>Go To Ann Arbor unlocks with Face ID.</string>
  <key>NSHealthShareUsageDescription</key><string>Go To Ann Arbor reads your health data.</string>
  <key>NSHealthUpdateUsageDescription</key><string>Go To Ann Arbor saves health data.</string>
  <key>NFCReaderUsageDescription</key><string>Go To Ann Arbor reads NFC tags.</string>
  <key>NSSiriUsageDescription</key><string>Go To Ann Arbor works with Siri and Shortcuts.</string>
  <key>NSNearbyInteractionUsageDescription</key><string>Go To Ann Arbor finds nearby devices.</string>
  <key>NSLocalNetworkUsageDescription</key><string>Go To Ann Arbor talks to Lamp on your Mac and to devices on your network.</string>
  <key>NSAppleMusicUsageDescription</key><string>Go To Ann Arbor plays music from your library.</string>
  <key>NSHomeKitUsageDescription</key><string>Go To Ann Arbor reads and controls your home.</string>'
LAMP_MAC_USAGE='  <key>NSMicrophoneUsageDescription</key><string>Go To Ann Arbor listens to your microphone.</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>Go To Ann Arbor turns your speech into text.</string>
  <key>NSCameraUsageDescription</key><string>Go To Ann Arbor uses your camera.</string>
  <key>NSPhotoLibraryUsageDescription</key><string>Go To Ann Arbor uses your photos.</string>
  <key>NSPhotoLibraryAddUsageDescription</key><string>Go To Ann Arbor saves pictures to your photos.</string>
  <key>NSCalendarsFullAccessUsageDescription</key><string>Go To Ann Arbor reads and adds calendar events.</string>
  <key>NSRemindersFullAccessUsageDescription</key><string>Go To Ann Arbor reads and adds reminders.</string>
  <key>NSContactsUsageDescription</key><string>Go To Ann Arbor looks up people in your contacts.</string>
  <key>NSBluetoothAlwaysUsageDescription</key><string>Go To Ann Arbor connects to Bluetooth devices.</string>
  <key>NSAppleEventsUsageDescription</key><string>Go To Ann Arbor reads your email and drafts replies through Mail.</string>
  <key>NSLocalNetworkUsageDescription</key><string>Go To Ann Arbor looks for printers and other devices on your network.</string>
  <key>NSLocationUsageDescription</key><string>Go To Ann Arbor uses your location.</string>
  <key>NSLocationWhenInUseUsageDescription</key><string>Go To Ann Arbor uses your location.</string>
  <key>NSAppleMusicUsageDescription</key><string>Go To Ann Arbor plays music from your library.</string>'
LAMP_APP_NAME='Go To Ann Arbor'
# Builds the game for this Mac (./build.sh mac, build/NewYork3.app), the iPhone and iPad simulator (./build.sh ios,
# build/iOS/NewYork3.app) or Android (./build.sh android): the Swift around the page, with the page copied in.
set -euo pipefail
cd "$(dirname "$0")"
PLACE="${1:-mac}"
# dyld ignores DYLD_INSERT_LIBRARIES and the like for a binary with a __RESTRICT segment: the agent's shell can
# start the installed app, and Lamp answers its secrets calls only to the app itself, so nothing may ride into it.
mkdir -p .build
: > .build/restrict
RESTRICT=(-Xlinker -sectcreate -Xlinker __RESTRICT -Xlinker __restrict -Xlinker "$PWD/.build/restrict")
stage_page() {
  if find Web -type l | grep -q .; then echo "Web/ holds a shortcut to another file. Put the file itself there." >&2; exit 1; fi
  rm -rf "$1"
  mkdir -p "$(dirname "$1")"
  cp -Rp Web "$1"
  if [ -f "$1/lamp-game.js" ]; then
    if [ -z "${LAMP_PAGE_DEVICE:-}" ]; then echo "Lamp builds the game, saying which device its page is for: build it from Lamp." >&2; exit 1; fi
    printf '%s' "$LAMP_PAGE_DEVICE" > "$1/lamp-device.js"
    BUILD="$(cd "$1" && find . -type f ! -name lamp-device.js ! -name lamp-build.js -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -c1-16)"
    printf '%s"%s";\n' "export default " "$BUILD" > "$1/lamp-build.js"
  fi
}
if [[ "$PLACE" == "android" ]]; then
  if [ -z "${LAMP_GRADLE:-}" ] || [ -z "${ANDROID_HOME:-}" ]; then
    echo "Android's tools aren't set up. Open the game in Lamp to download them." >&2
    exit 1
  fi
  stage_page build/android-assets/Web
  # The game's icon, once Lamp has drawn it; until then the system's own for an app.
  ICON=".lamp/AppIcon-square.png"
  [ -f "$ICON" ] || ICON=/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns
  mkdir -p build/android-res/mipmap-xxxhdpi
  /usr/bin/sips -s format png -z 432 432 "$ICON" --out build/android-res/mipmap-xxxhdpi/ic_launcher.png > /dev/null
  cd Lamp/Android
  printf 'sdk.dir=%s\n' "$ANDROID_HOME" > local.properties
  exec "$LAMP_GRADLE" --console=plain -q "-Dlamp.app=newyork3" assembleDebug
fi
if [[ "$PLACE" == "ios" ]]; then
  SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"
  FLAGS=(-c debug --triple "$(uname -m)-apple-ios17.0-simulator" --sdk "$SDK" --scratch-path .build/ios)
  APP="build/iOS/NewYork3.app"
else
  FLAGS=(-c release "${RESTRICT[@]}")
  APP="build/NewYork3.app"
fi
# On this Mac, Lamp's player when Lamp hands it over (LAMP_PLAYER): copied, not compiled, so nothing of Apple's tools runs.
PLAYER="${LAMP_PLAYER:-}"
[[ "$PLACE" == "ios" ]] && PLAYER=""
if [[ -z "$PLAYER" ]]; then
  # Lamp says the Swift and the tools are as they were at its last Mac build (LAMP_SWIFT_BUILT, a change of the page
  # alone): the binary that build made, where it said it was, rather than a second or two of swift build doing nothing.
  if [[ "$PLACE" != "ios" && -n "${LAMP_SWIFT_BUILT:-}" && -f .build/lamp-mac-bin ]] && BIN="$(<.build/lamp-mac-bin)" && [[ -x "$BIN" ]]; then
    :
  else
    # Lamp's own Swift is kept beside what it builds, written before each build of Lamp's.
    if [[ ! -f build/lamp-swift/LampSupport.swift ]]; then echo "Lamp's own Swift isn't in build/lamp-swift: build the app from Lamp, which writes it first." >&2; exit 1; fi
    BIN="$(swift build "${FLAGS[@]}" --show-bin-path)/NewYork3"
    swift build "${FLAGS[@]}" 2>&1
    [[ "$PLACE" == "ios" ]] || print -r -- "$BIN" > .build/lamp-mac-bin
  fi
fi
rm -rf "$APP"
if [[ "$PLACE" == "ios" ]]; then
  mkdir -p "$APP"
  cp "$BIN" "$APP/NewYork3"
  cat > "$APP/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>NewYork3</string>
  <key>CFBundleIdentifier</key><string>dev.lamp.nightly.app.newyork3</string>
  <key>CFBundleName</key><string>${LAMP_APP_NAME}</string>
  <key>CFBundleDisplayName</key><string>${LAMP_APP_NAME}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSRequiresIPhoneOS</key><true/>
  <key>MinimumOSVersion</key><string>17.0</string>
  <key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
  <key>UILaunchScreen</key><dict/>
  <key>UIRequiresFullScreen</key><true/>
  <key>UIStatusBarHidden</key><true/>
  <key>UISupportedInterfaceOrientations</key><array><string>UIInterfaceOrientationLandscapeRight</string><string>UIInterfaceOrientationLandscapeLeft</string></array>
  <key>UISupportedInterfaceOrientations~ipad</key><array><string>UIInterfaceOrientationLandscapeRight</string><string>UIInterfaceOrientationLandscapeLeft</string></array>
  <key>GCSupportsControllerUserInteraction</key><true/>
  <key>GCSupportedGameControllers</key><array><dict><key>ProfileName</key><string>ExtendedGamepad</string></dict></array>
${LAMP_USAGE}
  <key>DTPlatformName</key><string>iphonesimulator</string>
  <key>CFBundleSupportedPlatforms</key><array><string>iPhoneSimulator</string></array>
</dict></plist>
PLIST
else
  PLAYED=""
  if [[ -n "$PLAYER" ]]; then
    mkdir -p "$(dirname "$APP")"
    cp -Rp "$PLAYER" "$APP"
    mv "$APP/Contents/MacOS/LampPlayer" "$APP/Contents/MacOS/NewYork3"
    PLAYED="<key>LampPlayerVersion</key><string>${LAMP_PLAYER_VERSION:-}</string>"
  else
    mkdir -p "$APP/Contents/MacOS"
    cp "$BIN" "$APP/Contents/MacOS/NewYork3"
    # The copy names the SDK it was really built with (see a Mac app's build.sh), so macOS draws it as that SDK does.
    if SDKVER="$(xcrun --sdk macosx --show-sdk-version 2>/dev/null)" \
      && MINOS="$(otool -l "$APP/Contents/MacOS/NewYork3" | awk '/minos/ {print $2; exit}')" && [ -n "$MINOS" ]; then
      xcrun vtool -set-build-version macos "$MINOS" "$SDKVER" -replace -output "$APP/Contents/MacOS/NewYork3" "$APP/Contents/MacOS/NewYork3" >/dev/null 2>&1 || true
    fi
  fi
  cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>NewYork3</string>
  <key>CFBundleIdentifier</key><string>dev.lamp.nightly.app.newyork3</string>
  <key>CFBundleName</key><string>${LAMP_APP_NAME}</string>
  <key>CFBundleDisplayName</key><string>${LAMP_APP_NAME}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.games</string>
  <key>GCSupportsGameMode</key><true/>
${LAMP_MAC_USAGE}
  <key>LampPlayer</key><dict><key>kind</key><string>game</string><key>scheme</key><string>lamp-game</string></dict>
  $PLAYED
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
fi
if [[ "$PLACE" == "ios" ]]; then stage_page "$APP/Web"; else stage_page "$APP/Contents/Resources/Web"; fi
codesign --force -s - "$APP"
echo "Built $APP"
