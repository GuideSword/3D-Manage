# Xiaoli Keyboard Gap Fix Design

**Date:** 2026-09-16

## Goal

Keep Xiaoli's attachment and composer area immediately above the Android virtual keyboard, with only the composer's existing internal padding. Preserve the fixed five-line maximum and internal text scrolling. Do not change the login screen or build an APK during this iteration.

## Observed Failure

In Expo Go on the user's Android device, the keyboard no longer covers the composer, but opening it leaves several hundred pixels of empty space between the composer and the keyboard.

The current chat screen uses Keyboard Controller's `KeyboardAvoidingView` with `behavior="translate-with-padding"`. In the installed `react-native-keyboard-controller@1.18.5`, Android keyboard movement updates the translation continuously, while the compensating padding is finalized in a later keyboard event. With the user's IME, the layout can remain in the translated state without the matching padding, moving the complete chat layout too far upward.

The deterministic diagnostic probe is the combination of:

- the real chat call site selecting `translate-with-padding`; and
- the installed Android animation hook updating `translate` but not `padding` during `onMove`.

Either condition being removed makes the probe green, so this is the minimal known trigger.

## Considered Approaches

### 1. Use `padding` behavior — selected

Keep the current Keyboard Controller wrapper and measured navigation-header offset, but change the chat behavior to `padding`.

This mode derives bottom padding directly from keyboard progress, so it does not depend on the two-stage translate-then-padding sequence. It is the smallest change and preserves the existing screen structure.

### 2. Move only the footer with `KeyboardStickyView`

Wrap the attachment area and composer in a sticky keyboard view. This offers finer control, but the message list would need matching bottom-inset management to avoid overlay and scroll-position regressions.

This is unnecessary unless the simpler padding behavior fails on the target device.

### 3. Shrink the screen with `height` behavior

Reduce the wrapper height as the keyboard opens. This can interact poorly with Android `adjustResize` and risks recreating the original coverage or partial-visibility problem.

## Approved Design

`AgentChatScreen` keeps one Keyboard Controller avoiding view around the message list, attachment area, and composer. Its behavior changes from `translate-with-padding` to `padding`.

The following remain unchanged:

- root `KeyboardProvider`;
- `useHeaderHeight()` and `keyboardVerticalOffset`;
- Android manifest `adjustResize` policy;
- attachment selection and preview behavior;
- controlled text draft;
- five-line maximum height;
- native scrolling inside the multiline input;
- login page `KeyboardAwareScrollView`.

The desired final layout is that the bottom edge of the composer area meets the top edge of the keyboard. No new external spacer is added; only the input bar's existing internal padding remains visible.

## Feedback Loop and Tests

Before the production change, update the keyboard layout contract so it requires `behavior="padding"` for Xiaoli and rejects `translate-with-padding` at that call site. Run the contract and confirm it fails against the current implementation.

After the change:

1. Re-run the deterministic diagnostic probe and confirm it is green.
2. Run the keyboard layout and agent composer contracts.
3. Run the normal agent-client verification entry point.
4. Check Expo dependency compatibility and export the Web bundle.
5. Re-test in Expo Go on the same Android device and IME.

The Expo Go acceptance sequence is:

1. Open Xiaoli and focus the composer.
2. Confirm the attachment area and composer sit directly above the keyboard.
3. Switch between letter, tools, and emoji keyboard panels.
4. Enter at least six lines and confirm the composer stops at five visible lines and scrolls internally.
5. Dismiss and reopen the keyboard, confirming there is no residual upward or downward offset.

## Scope and Fallback

This change is limited to Xiaoli's chat keyboard behavior and its regression tests. It does not alter login behavior, navigation, system bars, backend code, or release packaging.

If `padding` still leaves an incorrect gap on the target device, stop and capture a new recording before moving to the structural `KeyboardStickyView` fallback. Do not combine both approaches in one change.
