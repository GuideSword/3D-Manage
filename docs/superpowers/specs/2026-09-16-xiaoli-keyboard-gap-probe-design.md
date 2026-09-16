# Temporary Xiaoli Keyboard Gap Probe

**Date:** 2026-09-16

## Goal and scope

Measure the still-reproducible empty band between Xiaoli's composer and the Android keyboard in Expo Go. This is diagnostic instrumentation, not a keyboard-layout fix. Do not change the login screen, keyboard avoidance policy, composer sizing, Metro process, or APK build.

The probe is temporary: after the physical-device gap is fixed and verified, remove the probe component and its small chat-screen wiring. It must not become a permanent setting or production feature.

## Approaches considered

1. **Development-only overlay on the real chat screen — selected.** Both keyboard-open and keyboard-closed values appear in screenshots of the failing screen. An absolutely positioned, touch-transparent overlay does not participate in flex layout.
2. Console logs. Less intrusive visually, but the user would need to collect logs and correlate them with screenshots and keyboard transitions.
3. Separate diagnostics screen. Keeps chat visually clean but cannot reliably measure the exact failing chat layout.

## Design

Add a self-contained `components/agent/KeyboardGapProbe.js`. Render it only under `__DEV__` inside Xiaoli's existing avoiding view, positioned absolutely near the top with `pointerEvents="none"`. Its display must remain visible with the keyboard both open and closed; it must not add padding, margin, a flex item, or a keyboard handler that moves content.

Add only two `onLayout` measurements to `AgentChatScreen`: the avoiding view and the composer bar. Pass their rectangles plus the existing navigation-header offset to the probe. The probe reads React Native window/screen heights and Keyboard Controller's reported keyboard visibility/height. It displays labeled values in dp, including:

- screen and window heights;
- keyboard height and visibility;
- avoiding-view height;
- composer top and bottom within the avoiding view;
- computed space beneath the composer inside the avoiding view: `avoidingView.height - (composer.y + composer.height)`;
- navigation-header offset.

The inner space is the important discriminator. If it grows roughly by one keyboard height while the window/avoiding view also shrinks roughly by one keyboard height, that supports double avoidance. If the window does not shrink, a different offset source remains possible. Do not infer the root cause from one value alone.

No chat content, credentials, or message text is captured or displayed. Invalid/unmeasured values display as a dash. The overlay uses a compact opaque or near-opaque panel so screenshots remain readable.

## Usage and validation

The user manually starts or refreshes Expo Go, opens Xiaoli, and provides two screenshots from the same session: keyboard closed and keyboard fully open. Wait for the keyboard animation to settle before the open screenshot. The assistant compares the measurements and visible gap before selecting a fix. Do not declare the gap fixed from source-level tests alone.

Before delivery, run the existing agent-client tests and a JavaScript/Babel parse or equivalent bundle check without starting Metro or building an APK. Check that the overlay is development-only and does not change the chat's layout or five-line composer behavior. Physical-device confirmation depends on the user's screenshots.

After the fix is validated on the same device and keyboard, delete the probe component and remove its import, render, layout state, and `onLayout` wiring. Re-run checks and confirm no probe references remain. Only then is the temporary work complete.
