# Xiaoli Keyboard Gap Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Xiaoli's attachment and composer area directly above the Android virtual keyboard without the large blank gap caused by hybrid translation.

**Architecture:** Preserve the existing root Keyboard Controller provider, measured navigation-header offset, chat layout, and five-line composer. Change only Xiaoli's avoiding-view behavior from the two-stage `translate-with-padding` mode to continuously derived `padding`, and lock the call site with a regression contract.

**Tech Stack:** Expo SDK 54, React Native 0.81.5, react-native-keyboard-controller 1.18.5, Node.js test runner, Expo Go

---

## File Structure

- Modify `tests/client/keyboard-layout-contract.test.cjs`: require Xiaoli's real wrapper to use `padding` and reject the failing hybrid behavior.
- Modify `screens/AgentChatScreen.js`: select `padding` on the existing Keyboard Controller avoiding view.

No provider, dependency, login, manifest, composer sizing, backend, or packaging file changes are required.

### Task 1: Capture the excessive-gap regression

**Files:**
- Modify: `tests/client/keyboard-layout-contract.test.cjs:28-42`
- Test: `tests/client/keyboard-layout-contract.test.cjs`

- [ ] **Step 1: Replace the Xiaoli wrapper contract with the approved behavior**

Replace the existing `Xiaoli uses...` test with:

```js
test('Xiaoli continuously pads the composer above the keyboard', () => {
  const screen = read('screens/AgentChatScreen.js');

  assert.match(
    screen,
    /import \{ KeyboardAvoidingView as KeyboardControllerAvoidingView \} from 'react-native-keyboard-controller';/,
  );
  assert.match(screen, /import \{ useHeaderHeight \} from '@react-navigation\/elements';/);
  assert.match(screen, /const headerHeight = useHeaderHeight\(\);/);
  assert.match(
    screen,
    /<KeyboardControllerAvoidingView[\s\S]*?behavior="padding"[\s\S]*?keyboardVerticalOffset=\{headerHeight\}/,
  );
  assert.doesNotMatch(screen, /behavior="translate-with-padding"/);
  assert.doesNotMatch(screen, /\bKeyboardAvoidingView,?\s*\r?\n/);
});
```

- [ ] **Step 2: Run the focused contract and confirm it catches the current bug**

Run:

```powershell
node --test tests/client/keyboard-layout-contract.test.cjs
```

Expected: 4 tests pass and `Xiaoli continuously pads the composer above the keyboard` fails because `AgentChatScreen.js` still contains `behavior="translate-with-padding"`.

### Task 2: Switch Xiaoli to continuous padding

**Files:**
- Modify: `screens/AgentChatScreen.js:261-266`
- Test: `tests/client/keyboard-layout-contract.test.cjs`
- Test: `tests/client/agent-chat-contract.test.cjs`

- [ ] **Step 1: Apply the minimal behavior change**

Replace the existing wrapper opening with:

```jsx
<KeyboardControllerAvoidingView
  style={styles.container}
  behavior="padding"
  keyboardVerticalOffset={headerHeight}
>
```

Do not change its children, closing tag, header offset, or styles.

- [ ] **Step 2: Re-run the focused contracts**

Run:

```powershell
node --test tests/client/keyboard-layout-contract.test.cjs tests/client/agent-chat-contract.test.cjs
```

Expected: all 10 tests pass. The five-line height, internal scrolling, provider, login behavior, and verification-script wiring remain green.

- [ ] **Step 3: Re-run the deterministic Android event-sequence probe**

Run:

```powershell
$screen = Get-Content -Raw 'screens/AgentChatScreen.js'
$hooks = Get-Content -Raw 'node_modules/react-native-keyboard-controller/src/components/KeyboardAvoidingView/hooks.ts'
$translateHook = $hooks.Substring($hooks.IndexOf('export const useTranslateAnimation'))
$androidMove = [regex]::Match($translateHook, 'onMove:\s*\(e\)\s*=>\s*\{(?<body>[\s\S]*?)\n\s*\},').Groups['body'].Value
$usesHybrid = $screen -match 'behavior="translate-with-padding"'
$moveTranslates = $androidMove -match 'translate\.value\s*=\s*e\.progress'
$movePads = $androidMove -match 'padding\.value\s*=\s*e\.progress'
if ($usesHybrid -and $moveTranslates -and -not $movePads) {
  Write-Output 'RED: chat uses translate-with-padding; Android onMove translates the whole layout but does not restore padding until a later event.'
  exit 1
}
Write-Output 'GREEN: the chat no longer depends on the translate-before-padding Android event sequence.'
```

Expected: exit code 0 and `GREEN: the chat no longer depends on the translate-before-padding Android event sequence.`

### Task 3: Run automated regression checks

**Files:**
- Verify: `screens/AgentChatScreen.js`
- Verify: `tests/client/keyboard-layout-contract.test.cjs`

- [ ] **Step 1: Run the normal Xiaoli client verification entry point**

Run:

```powershell
npm run verify:agent-client
```

Expected: all 16 tests pass.

- [ ] **Step 2: Verify Expo dependency compatibility**

Run:

```powershell
npx expo install --check
```

Expected: `Dependencies are up to date`.

- [ ] **Step 3: Export the Web bundle**

Run:

```powershell
npx expo export --platform web --output-dir .tmp/xiaoli-keyboard-gap-web-check
```

Expected: Metro completes without module, worklet, or syntax errors.

- [ ] **Step 4: Check only the task-owned diff**

Run:

```powershell
git diff --check -- screens/AgentChatScreen.js tests/client/keyboard-layout-contract.test.cjs
git status --short -- screens/AgentChatScreen.js tests/client/keyboard-layout-contract.test.cjs
```

Expected: no whitespace errors. Preserve all pre-existing user changes in both files.

### Task 4: Validate the screenshot scenario in Expo Go

**Files:**
- Verify: Expo Go on the user's original Android device and IME

- [ ] **Step 1: Start Expo Go with a clean Metro cache**

Run:

```powershell
npx expo start --clear --go
```

Expected: Metro displays an Expo Go QR code and loads without native-module or worklet errors. If port 8081 is occupied, accept the next available port and use the new QR code.

- [ ] **Step 2: Verify the open-keyboard position**

On the same device and keyboard shown in the supplied screenshot:

1. Open Xiaoli.
2. Focus the composer.
3. Wait two seconds after the keyboard finishes opening.
4. Confirm the attachment area and composer sit directly above the keyboard, with no large external blank band.

Expected: the bottom of the composer area meets the keyboard top; only the input bar's existing internal padding remains.

- [ ] **Step 3: Verify keyboard variants and composer scrolling**

1. Switch between letter, tools, and emoji panels.
2. Enter at least six lines.
3. Scroll inside the composer.

Expected: every keyboard panel remains adjacent to the composer; the composer displays at most five lines and scrolls internally.

- [ ] **Step 4: Verify dismissal and reopening**

Dismiss the keyboard, wait two seconds, and reopen it.

Expected: no residual upward or downward offset appears, and the composer returns to the same keyboard-adjacent position.

### Task 5: Preserve the mixed worktree

**Files:**
- Inspect: `screens/AgentChatScreen.js`
- Inspect: `tests/client/keyboard-layout-contract.test.cjs`

- [ ] **Step 1: Inspect target-file status and diffs**

Run:

```powershell
git status --short -- screens/AgentChatScreen.js tests/client/keyboard-layout-contract.test.cjs
git diff -- screens/AgentChatScreen.js tests/client/keyboard-layout-contract.test.cjs
```

Expected: the target files still contain pre-existing user work from the larger Xiaoli implementation.

- [ ] **Step 2: Do not create a mixed implementation commit**

Leave the implementation uncommitted and report the two changed files, automatic verification results, and Expo Go result. Do not stage or commit whole files while unrelated user work shares them.
