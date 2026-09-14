# Xiaoli Mobile Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Xiaoli's composer visible above the mobile software keyboard and make text beyond five visible lines scroll inside the composer.

**Architecture:** Preserve the existing `KeyboardAvoidingView` and multiline `TextInput` structure in `AgentChatScreen`. Configure platform-specific keyboard avoidance, express the five-line height limit through named layout constants, and enable native inner scrolling without changing message, attachment, or send state.

**Tech Stack:** React Native 0.81, Expo 54, Node.js built-in test runner

---

## File Structure

- Modify `screens/AgentChatScreen.js`: define composer typography constants, enable Android keyboard avoidance, and configure the multiline input's five-line height and native scrolling.
- Modify `tests/client/agent-chat-contract.test.cjs`: add a source-level regression contract for keyboard avoidance and five-line composer behavior, following the existing test style in this repository.

The repository has no mobile UI automation harness capable of opening a native software keyboard. The automated regression test therefore locks down the exact React Native configuration at the real call site; final device verification covers the native keyboard and gesture behavior.

### Task 1: Add the failing mobile composer contract

**Files:**
- Modify: `tests/client/agent-chat-contract.test.cjs`
- Test: `tests/client/agent-chat-contract.test.cjs`

- [ ] **Step 1: Add the regression test**

Append this test to `tests/client/agent-chat-contract.test.cjs`:

```js
test('chat composer avoids the mobile keyboard and scrolls beyond five lines', () => {
  const screen = read('screens/AgentChatScreen.js');

  assert.match(screen, /const COMPOSER_MAX_VISIBLE_LINES = 5;/);
  assert.match(screen, /behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/);
  assert.match(screen, /<TextInput[\s\S]*scrollEnabled[\s\S]*nestedScrollEnabled=\{Platform\.OS === 'android'\}/);
  assert.match(screen, /textAlignVertical="top"/);
  assert.match(
    screen,
    /maxHeight:\s*COMPOSER_LINE_HEIGHT \* COMPOSER_MAX_VISIBLE_LINES \+ COMPOSER_VERTICAL_PADDING/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails for the reported behavior**

Run:

```powershell
node --test tests/client/agent-chat-contract.test.cjs
```

Expected: the new test fails because the current screen has no `COMPOSER_MAX_VISIBLE_LINES`, uses no Android `height` behavior, and does not configure inner input scrolling.

### Task 2: Implement keyboard avoidance and five-line scrolling

**Files:**
- Modify: `screens/AgentChatScreen.js:1-340`
- Test: `tests/client/agent-chat-contract.test.cjs`

- [ ] **Step 1: Define named composer layout constants**

Add these constants after the imports and before the screen documentation comment:

```js
const COMPOSER_MAX_VISIBLE_LINES = 5;
const COMPOSER_LINE_HEIGHT = 20;
const COMPOSER_VERTICAL_PADDING = 16;
```

These values preserve the existing 8-point top and bottom padding and make the five-line limit explicit.

- [ ] **Step 2: Enable keyboard avoidance on Android**

Replace the current `KeyboardAvoidingView` behavior with:

```jsx
<KeyboardAvoidingView
  style={styles.container}
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
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
  nestedScrollEnabled={Platform.OS === 'android'}
  textAlignVertical="top"
  editable={!sending && !preparingImages}
  onSubmitEditing={send}
  blurOnSubmit={false}
/>
```

- [ ] **Step 4: Calculate the maximum height from five visible lines**

Replace the existing input style with this version:

```js
input: {
  flex: 1,
  minHeight: 40,
  maxHeight: COMPOSER_LINE_HEIGHT * COMPOSER_MAX_VISIBLE_LINES + COMPOSER_VERTICAL_PADDING,
  paddingHorizontal: 10,
  paddingVertical: COMPOSER_VERTICAL_PADDING / 2,
  backgroundColor: colors.surfaceMuted,
  borderRadius: 16,
  fontSize: 15,
  lineHeight: COMPOSER_LINE_HEIGHT,
  color: colors.text,
},
```

- [ ] **Step 5: Run the focused regression test**

Run:

```powershell
node --test tests/client/agent-chat-contract.test.cjs
```

Expected: all tests in the file pass, including `chat composer avoids the mobile keyboard and scrolls beyond five lines`.

- [ ] **Step 6: Re-run the original symptom check**

Run:

```powershell
node -e "const fs=require('fs');const s=fs.readFileSync('screens/AgentChatScreen.js','utf8');const checks=[['Android 键盘避让',/behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/.test(s)],['长文本输入框滚动',/scrollEnabled/.test(s)&&/nestedScrollEnabled/.test(s)]];for(const [n,ok] of checks)console.log((ok?'PASS':'FAIL')+' '+n);if(checks.some(([,ok])=>!ok))process.exit(1)"
```

Expected:

```text
PASS Android 键盘避让
PASS 长文本输入框滚动
```

- [ ] **Step 7: Commit the implementation and regression test**

```powershell
git add -- screens/AgentChatScreen.js tests/client/agent-chat-contract.test.cjs
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
git diff -- screens/AgentChatScreen.js tests/client/agent-chat-contract.test.cjs
```

Expected: `git diff --check` reports no errors. The targeted diff shows only the composer constants, keyboard behavior, input scrolling properties, input typography, and the new regression test in addition to the user's pre-existing changes.

- [ ] **Step 3: Perform mobile device verification when a simulator or device is available**

On both Android and iOS:

1. Open 小鲤 and focus the text input.
2. Confirm the composer and send button remain fully above the software keyboard.
3. Enter one through five lines and confirm the composer grows with the text.
4. Enter a sixth line and confirm the composer stops growing.
5. Swipe vertically inside the input and confirm all draft text can be reviewed and edited.
6. Swipe the message list and confirm it still scrolls independently.
7. Send the draft and confirm the composer returns to its minimum height.

Expected: both platforms satisfy all seven checks without changing attachment or send behavior.
