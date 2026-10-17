# Android touch port: initial development work

This fork is not yet a validated Android release. No APK has been built or tested as part of this commit. Preserve the upstream COPYING and source-license notices.

## Implemented in this first commit

- Refresh drafting targets on primary touch-down before draggable and editing handlers run. This removes the need for a preceding hover event when starting an edit.
- In Members mode, tap one joint and then a second joint to request a member using the existing material and section selection. Tap empty space or the same endpoint to cancel. Existing connected endpoints are excluded. Moving more than 12 CSS pixels between down and up is not treated as a tap.
- Forward pointer cancellation to handlers; Members mode clears its pending touch endpoint on cancellation.
- Disable browser scrolling and text selection on the cursor canvas. This is not a pinch-zoom implementation.
- Add Capacitor configuration for the Angular browser output. Capacitor dependencies and the generated native Android project have NOT been added.

## Known incomplete areas

- Existing browser warnings still require a mouse and a 1280x720 screen. They are intentionally retained until phone usability is validated.
- Phone layouts, dialogs, toolbar target sizes, and larger drafting hit targets still need implementation and testing.
- Select-mode and guide dragging cancellation need a full audit; forwarding pointercancel does not by itself implement cancellation in those services.
- No two-finger pan or pinch zoom is implemented.
- Tap-to-place joints and joint dragging need device tests, including finger occlusion and precision placement.
- Touch alternatives for context actions, keyboard modifiers, and keyboard joint nudging remain to be audited.
- Opening, saving, sharing, PDF export, WebGL2, and WebAssembly need Android WebView tests.
- Changing edit mode and bridge document while a member endpoint is pending needs regression tests.

## Packaging preparation

Use a development computer with Node/npm and an Android Studio toolchain compatible with the selected Capacitor release. Select a supported Capacitor major and install matching versions of @capacitor/core, @capacitor/android, and @capacitor/cli; commit package.json and package-lock.json together. Build with `npx ng build --base-href ./` and verify that dist/bridge-designer/browser/index.html exists. Then generate the Android project with `npx cap add android`, synchronize using `npx cap sync android`, and open it with `npx cap open android`. The configuration does not load a remote site. This sequence has not been executed or verified for this fork.

## Required validation before release

1. Run the existing automated tests and production build.
2. Add automated tests for fresh touch targets, two-tap member creation, duplicate and self endpoints, movement threshold, cancellation, and mouse regression.
3. On a phone with no mouse or pen, create a bridge, place joints, connect members, move and erase elements, undo/redo, run a load test, and save/reopen the bridge.
4. Test portrait and landscape layouts, dialog access, app background/resume, interrupted drags, multiple fingers, and screen-edge gestures.
5. Verify offline assets, Android file handling, licensing, and reproducible APK builds before distributing a release.
