# Xiaoli Keyboard Gap Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a temporary, development-only readout to the real Xiaoli chat screen so the user can capture the geometry behind the Android keyboard gap.

**Architecture:** A separate `KeyboardGapProbe` component reads React Native and Keyboard Controller dimensions and displays values in an absolutely positioned, touch-transparent overlay. The chat screen supplies only its avoiding-view and composer layouts. The existing keyboard behavior stays unchanged, and all probe wiring can be removed together after physical-device validation.

**Tech Stack:** Expo SDK 54, React Native 0.81.5, react-native-keyboard-controller 1.18.5, Node.js test runner, Expo Go

---

## File structure

- Create `components/agent/KeyboardGapProbe.js`: diagnostic-only measurements and readout.
- Modify `screens/AgentChatScreen.js`: two `onLayout` captures and a `__DEV__`-gated probe render.
- Create `tests/client/keyboard-gap-probe.test.cjs`: temporary contract checking isolation and removability. This is not a physical-device regression test for the gap.

The chat screen and its current keyboard contract already contain pre-existing uncommitted changes. Preserve those changes and do not include them in a mixed commit.

### Task 1: Pin the temporary probe contract

**Files:**
- Create: `tests/client/keyboard-gap-probe.test.cjs`

- [ ] **Step 1: Add the following test file**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('temporary keyboard probe is isolated and development-only', () => {
  const componentPath = 'components/agent/KeyboardGapProbe.js';
  assert.equal(fs.existsSync(path.join(root, componentPath)), true);
  const probe = read(componentPath);
  const screen = read('screens/AgentChatScreen.js');

  assert.match(probe, /pointerEvents="none"/);
  assert.match(probe, /useKeyboardState/);
  assert.match(probe, /avoidingLayout\.height - \(composerLayout\.y \+ composerLayout\.height\)/);
  assert.match(screen, /import KeyboardGapProbe from '..\/components\/agent\/KeyboardGapProbe';/);
  assert.match(screen, /\{__DEV__ && \(/);
  assert.match(screen, /onLayout=\{__DEV__ \? recordAvoidingLayout : undefined\}/);
  assert.match(screen, /onLayout=\{__DEV__ \? recordComposerLayout : undefined\}/);
});
```

- [ ] **Step 2: Run `node --test tests/client/keyboard-gap-probe.test.cjs`**

Expected: one failure because the probe component does not yet exist.

### Task 2: Add the readout without changing layout policy

**Files:**
- Create: `components/agent/KeyboardGapProbe.js`
- Modify: `screens/AgentChatScreen.js`
- Test: `tests/client/keyboard-gap-probe.test.cjs`

- [ ] **Step 1: Add a standalone probe component**

Create `components/agent/KeyboardGapProbe.js` with this complete content:

```jsx
import React from 'react';
import { Dimensions, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import {
  useKeyboardState,
  useWindowDimensions as useControllerWindowDimensions,
} from 'react-native-keyboard-controller';

const dp = (value) => Number.isFinite(value) ? Math.round(value) : '—';

export default function KeyboardGapProbe({ avoidingLayout, composerLayout, headerHeight }) {
  const { height: rnWindowHeight } = useWindowDimensions();
  const { height: controllerWindowHeight } = useControllerWindowDimensions();
  const keyboard = useKeyboardState();
  const screenHeight = Dimensions.get('screen').height;
  const composerBottom = composerLayout ? composerLayout.y + composerLayout.height : NaN;
  const innerGap = avoidingLayout && composerLayout
    ? avoidingLayout.height - (composerLayout.y + composerLayout.height)
    : NaN;

  return (
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={styles.panel}>
      <Text style={styles.line}>诊断 键盘:{keyboard.isVisible ? '开' : '关'} 高:{dp(keyboard.height)}dp</Text>
      <Text style={styles.line}>屏:{dp(screenHeight)} RN窗:{dp(rnWindowHeight)} 控制窗:{dp(controllerWindowHeight)}</Text>
      <Text style={styles.line}>避让区高:{dp(avoidingLayout?.height)} 输入顶:{dp(composerLayout?.y)} 底:{dp(composerBottom)}</Text>
      <Text style={styles.line}>底部空白:{dp(innerGap)} 头部偏移:{dp(headerHeight)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute', top: 8, left: 8, right: 8,
    zIndex: 100, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6,
    backgroundColor: 'rgba(25, 22, 48, 0.92)',
  },
  line: { color: '#fff', fontSize: 11, lineHeight: 16 },
});
```

- [ ] **Step 2: Wire only layout captures and `__DEV__` rendering into Xiaoli**

Import `KeyboardGapProbe` in `screens/AgentChatScreen.js`. After `headerHeight`, add:

```jsx
const [avoidingLayout, setAvoidingLayout] = useState(null);
const [composerLayout, setComposerLayout] = useState(null);
const recordAvoidingLayout = useCallback(({ nativeEvent: { layout } }) => {
  const next = { y: layout.y, height: layout.height };
  setAvoidingLayout((current) => current?.y === next.y && current?.height === next.height ? current : next);
}, []);
const recordComposerLayout = useCallback(({ nativeEvent: { layout } }) => {
  const next = { y: layout.y, height: layout.height };
  setComposerLayout((current) => current?.y === next.y && current?.height === next.height ? current : next);
}, []);
```

Attach them to the existing avoiding view and composer bar respectively:

```jsx
onLayout={__DEV__ ? recordAvoidingLayout : undefined}
onLayout={__DEV__ ? recordComposerLayout : undefined}
```

Render the probe as an absolutely positioned child after the composer, gated by:

```jsx
{__DEV__ && (
  <KeyboardGapProbe
    avoidingLayout={avoidingLayout}
    composerLayout={composerLayout}
    headerHeight={headerHeight}
  />
)}
```

Do not change `behavior="padding"`, `keyboardVerticalOffset`, `styles.container`, the composer style, the login page, or keyboard dependencies.

- [ ] **Step 3: Re-run `node --test tests/client/keyboard-gap-probe.test.cjs`**

Expected: one pass.

### Task 3: Verify and hand off to Expo Go

**Files:**
- Test: `tests/client/keyboard-gap-probe.test.cjs`
- Test: `tests/client/keyboard-layout-contract.test.cjs`

- [ ] **Step 1: Run `npm run verify:agent-client`**

Expected: all agent-client and keyboard contracts pass. This checks source and logic only, not the physical gap.

- [ ] **Step 2: Parse both changed JSX files**

Use installed `@babel/parser` directly, without launching Metro or building an APK:

```powershell
node -e "const fs=require('node:fs'); const parser=require('@babel/parser'); for(const file of ['screens/AgentChatScreen.js','components/agent/KeyboardGapProbe.js']) { parser.parse(fs.readFileSync(file,'utf8'),{sourceType:'module',plugins:['jsx']}); process.stdout.write(file+' parsed\n'); }"
```

Expected: both files report `parsed`. `babel-preset-expo` is not installed in this workspace, so a preset-based transform is not the check used here.

- [ ] **Step 3: Check the diff and user-owned changes**

Run `git diff --check` and inspect `git status --short`. Confirm only the intended component, test, and chat-screen wiring were added, while the pre-existing keyboard behavior and test edits remain intact.

- [ ] **Step 4: Give the user a two-screenshot procedure**

Ask the user to manually start or refresh Expo Go, open Xiaoli, capture one screenshot with the keyboard closed, then focus the input, wait for the keyboard to settle, and capture one with it open. Both must show the probe. Do not claim the gap is fixed; compare readings first.

## Cleanup after the actual fix

Once the same device shows the composer directly above the keyboard and correctly returns after dismissal, delete the probe component and temporary contract, remove the chat-screen import/state/callbacks/layout props/render, and remove the temporary probe plan/spec. Re-run validation and search production source for remaining `KeyboardGapProbe` references.
