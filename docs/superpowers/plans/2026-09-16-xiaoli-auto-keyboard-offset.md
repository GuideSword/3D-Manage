# Xiaoli Automatic Keyboard Offset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized Xiaoli keyboard offset with a value derived from current window and avoiding-view geometry, then verify on the user's device.

**Architecture:** A small pure function calculates the offset from the Keyboard Controller window height and the avoiding view's layout. `AgentChatScreen` supplies live measurements to the existing `KeyboardControllerAvoidingView`. The temporary probe remains development-only until the user confirms the visible gap is gone.

**Tech Stack:** Expo SDK 54, React Native 0.81.5, react-native-keyboard-controller 1.18.5, Node.js tests, Expo Go

---

## File structure

- Create `utils/agentKeyboardOffsetCore.cjs`: pure geometry calculation.
- Create `tests/client/agent-keyboard-offset.test.cjs`: captured trace and changing-geometry regression.
- Modify `screens/AgentChatScreen.js`: use live controller window/layout instead of `useHeaderHeight()`; keep its current `behavior="padding"` and existing diagnostic overlay.
- Modify `components/agent/KeyboardGapProbe.js`: display actual calculated offset instead of the stale header value.
- Modify `tests/client/keyboard-layout-contract.test.cjs`: require dynamic wiring at the call site.
- Modify `package.json`: include the new regression test in `verify:agent-client`.

The screen and keyboard contract already contain user-owned uncommitted edits. Preserve them. Do not stage a mixed code commit without separating those edits.

### Task 1: Capture the real failing geometry

**Files:** Create `tests/client/agent-keyboard-offset.test.cjs`

- [ ] **Step 1: Add the following test file**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getKeyboardVerticalOffset } = require('../../utils/agentKeyboardOffsetCore.cjs');

const controllerPadding = (windowHeight, keyboardHeight, offset, layout) =>
  Math.max(layout.y + layout.height - (windowHeight - keyboardHeight - offset), 0);

test('captured Expo Go trace no longer adds 239dp of empty space', () => {
  const layout = { y: 0, height: 696 };
  assert.equal(controllerPadding(792, 303, 335, layout), 542);
  const offset = getKeyboardVerticalOffset(792, layout);
  assert.equal(offset, 96);
  assert.equal(controllerPadding(792, 303, offset, layout), 303);
});

test('offset follows changing layout and window dimensions', () => {
  assert.equal(getKeyboardVerticalOffset(900, { y: 0, height: 780 }), 120);
  assert.equal(getKeyboardVerticalOffset(640, { y: 0, height: 600 }), 40);
  assert.equal(getKeyboardVerticalOffset(640, { y: 12, height: 600 }), 28);
  assert.equal(getKeyboardVerticalOffset(792, null), 0);
  assert.equal(getKeyboardVerticalOffset(792, { y: 0, height: 0 }), 0);
});
```

- [ ] **Step 2: Run `node --test tests/client/agent-keyboard-offset.test.cjs`**

Expected: fail because `agentKeyboardOffsetCore.cjs` does not yet exist.

### Task 2: Implement the automatic offset

**Files:** Create `utils/agentKeyboardOffsetCore.cjs`; modify `screens/AgentChatScreen.js`, `components/agent/KeyboardGapProbe.js`, `tests/client/keyboard-layout-contract.test.cjs`, and `package.json`.

- [ ] **Step 1: Add the complete pure helper**

```js
'use strict';

function getKeyboardVerticalOffset(windowHeight, layout) {
  if (!Number.isFinite(windowHeight) || !layout ||
      !Number.isFinite(layout.y) || !Number.isFinite(layout.height) || layout.height <= 0) {
    return 0;
  }

  return Math.max(0, windowHeight - (layout.y + layout.height));
}

module.exports = { getKeyboardVerticalOffset };
```

- [ ] **Step 2: Replace the Xiaoli call-site offset**

In `screens/AgentChatScreen.js`, delete the `useHeaderHeight` import and `const headerHeight = useHeaderHeight()`. Extend the Keyboard Controller import to include its `useWindowDimensions as useControllerWindowDimensions` hook, and import `getKeyboardVerticalOffset` from `../utils/agentKeyboardOffsetCore.cjs`. After creating `styles`, add:

```jsx
const { height: controllerWindowHeight } = useControllerWindowDimensions();
const [avoidingLayout, setAvoidingLayout] = useState(null);
const keyboardVerticalOffset = getKeyboardVerticalOffset(controllerWindowHeight, avoidingLayout);
```

Remove the old duplicate `avoidingLayout` declaration. Set `keyboardVerticalOffset={keyboardVerticalOffset}` on the existing avoiding view and `onLayout={recordAvoidingLayout}` without a `__DEV__` guard. Pass `keyboardVerticalOffset={keyboardVerticalOffset}` to the development-only probe. Keep the composer `onLayout` development-only.

- [ ] **Step 3: Update the probe readout**

Change the probe parameter from `headerHeight` to `keyboardVerticalOffset`, and change the last label to:

```jsx
<Text style={styles.line}>底部空白:{dp(innerGap)} 自动偏移:{dp(keyboardVerticalOffset)}</Text>
```

- [ ] **Step 4: Update the source contract and standard command**

In `tests/client/keyboard-layout-contract.test.cjs`, replace the two `useHeaderHeight` assertions with assertions that Xiaoli imports `useControllerWindowDimensions` and `getKeyboardVerticalOffset`, computes the offset from `controllerWindowHeight` and `avoidingLayout`, passes it to the avoiding view, and attaches `onLayout={recordAvoidingLayout}`. Reject `useHeaderHeight` in that screen. In `package.json`, append `tests/client/agent-keyboard-offset.test.cjs` to the `verify:agent-client` command.

- [ ] **Step 5: Run `node --test tests/client/agent-keyboard-offset.test.cjs tests/client/keyboard-layout-contract.test.cjs tests/client/keyboard-gap-probe.test.cjs`**

Expected: all focused tests pass.

### Task 3: Verify without claiming device success

**Files:** test and source files above.

- [ ] **Step 1: Run `npm run verify:agent-client` and `npm run verify:client`**

Expected: both pass, including the five-line composer contract.

- [ ] **Step 2: Parse both changed JSX files using installed `@babel/parser`**

```powershell
node -e "const fs=require('node:fs'); const parser=require('@babel/parser'); for(const file of ['screens/AgentChatScreen.js','components/agent/KeyboardGapProbe.js']) { parser.parse(fs.readFileSync(file,'utf8'),{sourceType:'module',plugins:['jsx']}); process.stdout.write(file+' parsed\n'); }"
```

- [ ] **Step 3: Inspect `git diff --check` and targeted diff**

Expected: no whitespace errors; pre-existing changes remain untouched. Do not start Expo or build an APK.

- [ ] **Step 4: Ask for two new Expo Go screenshots**

The user manually reloads Xiaoli and captures keyboard closed/open with the probe visible. Compare `底部空白`, keyboard height, and `自动偏移`. Physical-device acceptance is required before removing the temporary probe or claiming the gap is fixed.
