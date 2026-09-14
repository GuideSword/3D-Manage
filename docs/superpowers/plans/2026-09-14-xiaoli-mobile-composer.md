# Xiaoli Mobile Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Xiaoli's composer visible above the mobile software keyboard and make text beyond five visible lines scroll inside the composer.

**Architecture:** Preserve the existing `KeyboardAvoidingView` and multiline `TextInput` structure in `AgentChatScreen`. Keep the five-line dimensions and platform keyboard policy in a pure CommonJS strategy module, then wire those values into the screen and enable native inner scrolling without changing message, attachment, or send state.

**Tech Stack:** React Native 0.81, Expo 54, Node.js built-in test runner

---

## File Structure

- Add `utils/agentComposerLayoutCore.cjs`: expose the five-line dimensions, computed maximum height, and platform keyboard policy through a directly testable public interface.
- Modify `screens/AgentChatScreen.js`: consume the shared policy, enable Android keyboard avoidance, and configure the multiline input's five-line height and native scrolling.
- Modify `tests/client/agent-chat-contract.test.cjs`: test the pure strategy directly and retain a narrow source-level contract for the real screen wiring.

The repository has no mobile UI automation harness capable of opening a native software keyboard. The automated regression test therefore locks down the exact React Native configuration at the real call site; final device verification covers the native keyboard and gesture behavior.

### Task 1: Add the failing mobile composer contract

**Files:**
- Modify: `tests/client/agent-chat-contract.test.cjs`
- Test: `tests/client/agent-chat-contract.test.cjs`

- [ ] **Step 1: Add the regression test**

After the existing `root` and `read` helpers, add the strategy import and both complete regression tests:

```js
const composerLayout = require('../../utils/agentComposerLayoutCore.cjs');

test('chat composer layout exposes the approved five-line and keyboard policies', () => {
  assert.equal(composerLayout.COMPOSER_MAX_VISIBLE_LINES, 5);
  assert.equal(composerLayout.COMPOSER_LINE_HEIGHT, 20);
  assert.equal(composerLayout.COMPOSER_VERTICAL_PADDING, 16);
  assert.equal(composerLayout.COMPOSER_MAX_HEIGHT, 116);
  assert.deepEqual(composerLayout.getKeyboardAvoidance('ios'), {
    behavior: 'padding',
    keyboardVerticalOffset: 88,
  });
  assert.deepEqual(composerLayout.getKeyboardAvoidance('android'), {
    behavior: 'height',
    keyboardVerticalOffset: 0,
  });
  assert.deepEqual(composerLayout.getKeyboardAvoidance('web'), {
    behavior: undefined,
    keyboardVerticalOffset: 0,
  });
  assert.deepEqual(composerLayout.getKeyboardAvoidance('unknown'), {
    behavior: undefined,
    keyboardVerticalOffset: 0,
  });
});

test('chat composer wires the shared layout policy to the real text input', () => {
  const screen = read('screens/AgentChatScreen.js');
  const composerInput = screen.match(
    /<TextInput\b(?:(?!\/>)[\s\S])*?placeholder="问我关于订单\/模型\/库存的问题…"(?:(?!\/>)[\s\S])*?\/>/,
  )?.[0];
  const composerInputStyle = screen.match(
    /\r?\n  input: \{[\s\S]*?\r?\n  \},/,
  )?.[0];

  assert.ok(composerInput, 'the composer TextInput should remain identifiable');
  assert.ok(composerInputStyle, 'the composer input style should remain identifiable');
  assert.match(screen, /require\('\.\.\/utils\/agentComposerLayoutCore\.cjs'\)/);
  assert.match(screen, /const keyboardAvoidance = getKeyboardAvoidance\(Platform\.OS\);/);
  assert.match(screen, /behavior=\{keyboardAvoidance\.behavior\}/);
  assert.match(screen, /keyboardVerticalOffset=\{keyboardAvoidance\.keyboardVerticalOffset\}/);
  assert.match(composerInput, /\bmultiline\b/);
  assert.match(composerInput, /\bscrollEnabled\b/);
  assert.match(composerInput, /textAlignVertical="top"/);
  assert.doesNotMatch(composerInput, /\ballowFontScaling\b/);
  assert.doesNotMatch(composerInput, /\bnestedScrollEnabled\b/);
  assert.match(composerInputStyle, /maxHeight:\s*COMPOSER_MAX_HEIGHT/);
  assert.match(composerInputStyle, /lineHeight:\s*COMPOSER_LINE_HEIGHT/);
  assert.match(
    composerInputStyle,
    /paddingVertical:\s*COMPOSER_VERTICAL_PADDING \/ 2/,
  );
  assert.match(composerInputStyle, /includeFontPadding:\s*false/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails for the reported behavior**

Run:

```powershell
node --test tests/client/agent-chat-contract.test.cjs
```

Expected: the new test fails because the pure strategy module does not yet exist.

### Task 2: Implement keyboard avoidance and five-line scrolling

**Files:**
- Add: `utils/agentComposerLayoutCore.cjs`
- Modify: `screens/AgentChatScreen.js:1-340`
- Test: `tests/client/agent-chat-contract.test.cjs`

- [ ] **Step 1: Define the pure composer layout strategy**

Create `utils/agentComposerLayoutCore.cjs` with this complete content:

```js
'use strict';

const COMPOSER_MAX_VISIBLE_LINES = 5;
const COMPOSER_LINE_HEIGHT = 20;
const COMPOSER_VERTICAL_PADDING = 16;
const COMPOSER_MAX_HEIGHT =
  COMPOSER_LINE_HEIGHT * COMPOSER_MAX_VISIBLE_LINES + COMPOSER_VERTICAL_PADDING;

const IOS_KEYBOARD_AVOIDANCE = Object.freeze({
  behavior: 'padding',
  keyboardVerticalOffset: 88,
});

const ANDROID_KEYBOARD_AVOIDANCE = Object.freeze({
  behavior: 'height',
  keyboardVerticalOffset: 0,
});

const NEUTRAL_KEYBOARD_AVOIDANCE = Object.freeze({
  behavior: undefined,
  keyboardVerticalOffset: 0,
});

function getKeyboardAvoidance(platform) {
  if (platform === 'ios') return IOS_KEYBOARD_AVOIDANCE;
  if (platform === 'android') return ANDROID_KEYBOARD_AVOIDANCE;
  return NEUTRAL_KEYBOARD_AVOIDANCE;
}

module.exports = {
  COMPOSER_MAX_VISIBLE_LINES,
  COMPOSER_LINE_HEIGHT,
  COMPOSER_VERTICAL_PADDING,
  COMPOSER_MAX_HEIGHT,
  getKeyboardAvoidance,
};
```

These values preserve the existing 8-point top and bottom padding and make the five-line limit directly testable without loading React Native.

- [ ] **Step 2: Enable keyboard avoidance on Android**

Load the strategy in `AgentChatScreen` and pass its resolved `behavior` and `keyboardVerticalOffset` to `KeyboardAvoidingView`.

```jsx
<KeyboardAvoidingView
  style={styles.container}
  behavior={keyboardAvoidance.behavior}
  keyboardVerticalOffset={keyboardAvoidance.keyboardVerticalOffset}
>
```

Keep `keyboardVerticalOffset` unchanged because Android already uses the native `adjustResize` window mode and does not need the iOS navigation-header offset.

- [ ] **Step 3: Configure native long-text scrolling on the real input**

Update the existing composer `TextInput` to include these properties while keeping its current value, placeholder, editability, submission, and blur behavior:

```jsx
<TextInput
  style={styles.input}
  value={input}
  onChangeText={setInput}
  placeholder="问我关于订单/模型/库存的问题…"
  placeholderTextColor={colors.textTertiary}
  multiline
  scrollEnabled
  textAlignVertical="top"
  editable={!sending && !preparingImages}
  onSubmitEditing={send}
  blurOnSubmit={false}
/>
```

- [ ] **Step 4: Calculate the maximum height from five visible lines**

Use the strategy's exported maximum height in the existing input style:

```js
input: {
  flex: 1,
  minHeight: 40,
  maxHeight: COMPOSER_MAX_HEIGHT,
  paddingHorizontal: 10,
  paddingVertical: COMPOSER_VERTICAL_PADDING / 2,
  backgroundColor: colors.surfaceMuted,
  borderRadius: 16,
  fontSize: 15,
  lineHeight: COMPOSER_LINE_HEIGHT,
  includeFontPadding: false,
  color: colors.text,
},
```

Do not set `allowFontScaling`; retain React Native's accessible default. Five lines are an upper-bound height budget: system large text may show fewer than five lines, with the remaining text available through inner scrolling. `includeFontPadding: false` prevents Android's extra font padding from consuming the default-size five-line budget.

- [ ] **Step 5: Run the focused regression test**

Run:

```powershell
node --test tests/client/agent-chat-contract.test.cjs
```

Expected: all tests in the file pass, including the pure layout-policy behavior test and the narrowly scoped screen-wiring contract.

- [ ] **Step 6: Re-run the original symptom check**

Run:

```powershell
node -e "const fs=require('fs');const s=fs.readFileSync('screens/AgentChatScreen.js','utf8');const checks=[['共享键盘策略',/behavior=\{keyboardAvoidance\.behavior\}/.test(s)],['长文本输入框滚动',/scrollEnabled/.test(s)&&!/nestedScrollEnabled/.test(s)]];for(const [n,ok] of checks)console.log((ok?'PASS':'FAIL')+' '+n);if(checks.some(([,ok])=>!ok))process.exit(1)"
```

Expected:

```text
PASS 共享键盘策略
PASS 长文本输入框滚动
```

- [ ] **Step 7: Commit the implementation and regression test**

```powershell
git add -- utils/agentComposerLayoutCore.cjs screens/AgentChatScreen.js tests/client/agent-chat-contract.test.cjs
git commit -m "fix: keep xiaoli composer above mobile keyboard"
```

Before committing, confirm that only the intended hunks from these already-modified files are staged; do not stage unrelated user changes.

### Task 3: Verify surrounding Xiaoli behavior

**Files:**
- Verify: `screens/AgentChatScreen.js`
- Test: `tests/client/agent-chat-contract.test.cjs`
- Test: `tests/client/agent-image-core.test.cjs`

- [ ] **Step 1: Run the complete agent client verification command**

Run:

```powershell
npm run verify:agent-client
```

Expected: all agent image and chat contract tests pass, confirming that attachment handling, image-only sends, settings contracts, and the composer regression remain intact.

- [ ] **Step 2: Check the final diff for unrelated edits and whitespace errors**

Run:

```powershell
git diff --check
git diff -- utils/agentComposerLayoutCore.cjs screens/AgentChatScreen.js tests/client/agent-chat-contract.test.cjs
```

Expected: `git diff --check` reports no errors. The targeted diff shows only the composer constants, keyboard behavior, input scrolling properties, input typography, and the new regression test in addition to the user's pre-existing changes.

- [ ] **Step 3: Perform mobile device verification when a simulator or device is available**

On both Android and iOS:

1. Open 小鲤 and focus the text input.
2. Confirm the composer and send button remain fully above the software keyboard.
3. At the default system font size, enter one through five lines and confirm the composer grows with the text.
4. Enter a sixth line and confirm the composer stops growing.
5. Swipe vertically inside the input and confirm all draft text can be reviewed and edited.
6. Swipe the message list and confirm it still scrolls independently.
7. Send the draft and confirm the composer returns to its minimum height.

Expected: both platforms satisfy all seven checks without changing attachment or send behavior.

With a large accessibility font size, the composer may show fewer than five lines; confirm it respects the same height ceiling and all text remains reachable by scrolling.
