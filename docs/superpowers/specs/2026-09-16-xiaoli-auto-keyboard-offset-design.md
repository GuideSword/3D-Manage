# Xiaoli Automatic Keyboard Offset Design

**Date:** 2026-09-16

## Goal

Keep Xiaoli's attachment/composer footer immediately above the Android keyboard without a fixed device-specific offset. Preserve the five-line composer and its internal scrolling. Validate first in Expo Go; do not start Metro or build an APK on the user's behalf.

## Evidence and corrected diagnosis

The user supplied two physical-device screenshots with the temporary geometry probe:

| State | Screen/window height | Avoiding-view height | Keyboard height | Inner bottom space | Offset passed to controller |
| --- | ---: | ---: | ---: | ---: | ---: |
| Closed | 792 dp | 696 dp | 0 dp | 0 dp | 335 dp |
| Open | 792 dp | 696 dp | 303 dp | 542 dp | 335 dp |

The window and avoiding view did not shrink, so native resize plus component avoidance is not the explanation in this Expo Go run. Keyboard Controller's installed formula predicts the observed space exactly: `696 - (792 - 303 - 335) = 542`. The screen-space offset of the avoiding view is instead `792 - 696 = 96 dp`; using that value would yield `696 - (792 - 303 - 96) = 303 dp`, matching the keyboard height. The 239 dp offset error matches the visible gap. The 335 value is also approximately 96 multiplied by the device's pixel density, but this design does not depend on proving where that upstream unit mismatch originated.

The previous source-contract pass did not prove the physical layout was fixed. The temporary probe remains until the user verifies this change on the device.

## Approaches considered

1. **Measure the actual avoiding-view position in the controller's window coordinate system — selected.** Derive the offset from current window height and avoiding-view layout on every relevant layout change. No device-specific dimension is embedded in code.
2. Divide `useHeaderHeight()` by pixel density. It fits this one screenshot but assumes the header hook always reports physical pixels; it could under-correct on other hosts.
3. Remove Keyboard Controller and rely on native window resize. The captured Expo Go window stayed at 792 dp while the keyboard opened, so this would likely recreate keyboard coverage there.

## Design

Keep Xiaoli's current `KeyboardControllerAvoidingView` with `behavior="padding"`. Use the same `useWindowDimensions` hook exported by Keyboard Controller that its avoiding view uses internally. Keep an `onLayout` measurement of the avoiding view in both development and production. Compute its current vertical offset as `max(0, controllerWindowHeight - (avoidingLayout.y + avoidingLayout.height))`; use 0 only until a valid measurement is available. Recompute when the controller window or layout changes. Remove `useHeaderHeight()` from this screen's keyboard calculation.

This offset is geometry-derived, not a fixed 96 dp, pixel-ratio conversion, or keyboard-height constant. It aims to make the component's padding equal to the reported keyboard height when the avoiding view reaches the bottom of the window. Keep the existing diagnostic overlay in development and change its label to show the calculated offset. The overlay's composer measurement remains development-only and removable.

Do not change the login screen, root keyboard provider, Android native configuration, chat message list, image attachment behavior, or composer height limit.

## Validation and cleanup

Add a regression test at the layout-calculation seam using the captured 792/696/303 values: the old 335 offset must reproduce 542 dp; the new derived offset must be 96 dp and produce 303 dp of padding. Test other window/layout combinations to prove the offset follows geometry instead of staying at 96. Verify that the actual chat call site uses the dynamic value. Run existing agent-client checks and parse the changed JSX without launching Metro or building an APK.

Then the user manually refreshes Expo Go and captures keyboard-closed and keyboard-open screenshots. Acceptance requires the diagnostic `底部空白` to track keyboard height, the visible footer to touch the keyboard without a large blank band, and the footer to return to the bottom when the keyboard closes. Also try a longer-than-five-line draft and an alternate keyboard panel. Do not declare completion from unit/source tests alone.

After physical-device confirmation, remove the temporary probe component, its development-only composer measurement and test, and temporary probe documentation. The geometry measurement needed for the automatic offset remains as production behavior. A later APK build must be checked separately because its native host may report different window-resize behavior from Expo Go.
