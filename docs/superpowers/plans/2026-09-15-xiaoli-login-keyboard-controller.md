# Xiaoli and Login Keyboard Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unreliable built-in Android keyboard avoidance in Xiaoli chat and login with Expo SDK 54's compatible Keyboard Controller integration.

**Architecture:** Add one root `KeyboardProvider`. Use Keyboard Controller's `KeyboardAvoidingView` with a measured navigation-header offset for Xiaoli, and `KeyboardAwareScrollView` for the login form; preserve the independent five-line composer layout policy.

**Tech Stack:** Expo SDK 54, React Native 0.81.5, React 19.1, react-native-keyboard-controller 1.18.5, react-native-reanimated 4.1.x, react-native-worklets 0.5.1, Node.js test runner

---

## File Structure

- Modify `package.json` and `package-lock.json`: add Expo-compatible keyboard, animation, and worklet dependencies.
- Create `tests/client/keyboard-layout-contract.test.cjs`: lock down dependency compatibility and the real root/chat/login component wiring.
- Modify `App.js`: mount exactly one `KeyboardProvider` around the existing provider tree.
- Modify `screens/AgentChatScreen.js`: use Keyboard Controller's avoiding view with `translate-with-padding` and the actual navigation header height.
- Modify `screens/LoginScreen.js`: replace the built-in avoiding-view/scroll-view pair with `KeyboardAwareScrollView`.
- Modify `utils/agentComposerLayoutCore.cjs`: keep only the still-used five-line composer dimensions and remove the obsolete built-in keyboard policy.
- Modify `tests/client/agent-chat-contract.test.cjs`: retain composer height/input tests while removing assertions for the obsolete React Native avoiding-view policy.

The repository has no automated native IME driver. Source contracts make configuration regressions deterministic, while the user-provided recording and Expo Go on the same Android device provide the real red/green behavior seam.

### Task 1: Add the failing keyboard integration contract

**Files:**
- Create: `tests/client/keyboard-layout-contract.test.cjs`
- Test: `tests/client/keyboard-layout-contract.test.cjs`

- [ ] **Step 1: Create the complete regression contract**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Expo SDK 54 keyboard dependencies stay on bundled versions', () => {
  const pkg = JSON.parse(read('package.json'));

  assert.equal(pkg.dependencies['react-native-keyboard-controller'], '1.18.5');
  assert.equal(pkg.dependencies['react-native-reanimated'], '~4.1.1');
  assert.equal(pkg.dependencies['react-native-worklets'], '0.5.1');
});

test('the app mounts one shared keyboard provider', () => {
  const app = read('App.js');

  assert.match(app, /import \{ KeyboardProvider \} from 'react-native-keyboard-controller';/);
  assert.equal((app.match(/<KeyboardProvider\b/g) || []).length, 1);
  assert.match(app, /<KeyboardProvider>[\s\S]*<ThemeProvider>[\s\S]*<AppContent \/>[\s\S]*<\/KeyboardProvider>/);
});

test('Xiaoli uses the controller avoiding view with the measured header height', () => {
  const screen = read('screens/AgentChatScreen.js');

  assert.match(
    screen,
    /import \{ KeyboardAvoidingView as KeyboardControllerAvoidingView \} from 'react-native-keyboard-controller';/,
  );
  assert.match(screen, /import \{ useHeaderHeight \} from '@react-navigation\/elements';/);
  assert.match(screen, /const headerHeight = useHeaderHeight\(\);/);
  assert.match(
    screen,
    /<KeyboardControllerAvoidingView[\s\S]*?behavior="translate-with-padding"[\s\S]*?keyboardVerticalOffset=\{headerHeight\}/,
  );
  assert.doesNotMatch(screen, /\bKeyboardAvoidingView,?\s*\r?\n/);
});

test('login automatically scrolls the focused field above the keyboard', () => {
  const screen = read('screens/LoginScreen.js');

  assert.match(screen, /import \{ KeyboardAwareScrollView \} from 'react-native-keyboard-controller';/);
  assert.match(
    screen,
    /<KeyboardAwareScrollView[\s\S]*?style=\{styles\.container\}[\s\S]*?contentContainerStyle=\{styles\.content\}[\s\S]*?bottomOffset=\{SPACING\.lg\}[\s\S]*?keyboardShouldPersistTaps="handled"/,
  );
  assert.doesNotMatch(screen, /\bKeyboardAvoidingView\b/);
  assert.doesNotMatch(screen, /<ScrollView\b/);
});
```

- [ ] **Step 2: Run the contract and confirm the captured failures**

Run:

```powershell
node --test tests/client/keyboard-layout-contract.test.cjs
```

Expected: 4 failures. Dependencies are absent, `KeyboardProvider` is absent, Xiaoli still uses React Native's avoiding view, and login still uses the built-in avoiding view plus ordinary `ScrollView`.

### Task 2: Install the exact Expo Go-compatible dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/client/keyboard-layout-contract.test.cjs`

- [ ] **Step 1: Install all three SDK 54 native packages through Expo**

Run:

```powershell
npx expo install react-native-keyboard-controller react-native-reanimated react-native-worklets
```

Expected: `package.json` contains `react-native-keyboard-controller: 1.18.5`, `react-native-reanimated: ~4.1.1`, and `react-native-worklets: 0.5.1`; the lockfile is updated.

- [ ] **Step 2: Verify package resolution and Expo compatibility**

Run:

```powershell
npm ls react-native-keyboard-controller react-native-reanimated react-native-worklets --depth=0
npx expo install --check
```

Expected: all three packages resolve once, and Expo reports that dependencies are up to date.

- [ ] **Step 3: Re-run the focused test**

Run:

```powershell
node --test tests/client/keyboard-layout-contract.test.cjs
```

Expected: the dependency test passes; the provider, Xiaoli, and login tests remain red.

### Task 3: Mount the shared Keyboard Provider

**Files:**
- Modify: `App.js:1-70`
- Test: `tests/client/keyboard-layout-contract.test.cjs`

- [ ] **Step 1: Import the provider**

Add beside the existing imports:

```js
import { KeyboardProvider } from 'react-native-keyboard-controller';
```

- [ ] **Step 2: Wrap the existing root providers without forcing system-bar props**

Replace the exported `App` function with:

```jsx
export default function App() {
  return (
    <KeyboardProvider>
      <ThemeProvider>
        <ServerConfigProvider>
          <AppContent />
        </ServerConfigProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
}
```

- [ ] **Step 3: Run the focused test**

Run:

```powershell
node --test tests/client/keyboard-layout-contract.test.cjs
```

Expected: dependency and provider tests pass; Xiaoli and login remain red.

### Task 4: Move Xiaoli to controller-driven keyboard avoidance

**Files:**
- Modify: `screens/AgentChatScreen.js:1-370`
- Modify: `utils/agentComposerLayoutCore.cjs`
- Modify: `tests/client/agent-chat-contract.test.cjs`
- Test: `tests/client/keyboard-layout-contract.test.cjs`
- Test: `tests/client/agent-chat-contract.test.cjs`

- [ ] **Step 1: Replace keyboard-related imports and resolve the real header height**

Remove `KeyboardAvoidingView` and `Platform` from the `react-native` import. Add:

```js
import { useHeaderHeight } from '@react-navigation/elements';
import { KeyboardAvoidingView as KeyboardControllerAvoidingView } from 'react-native-keyboard-controller';
```

Remove `getKeyboardAvoidance` from the composer-layout destructuring and delete the module-level `keyboardAvoidance` constant. Inside `AgentChatScreen`, immediately after creating `styles`, add:

```js
const headerHeight = useHeaderHeight();
```

- [ ] **Step 2: Replace the avoiding-view wrapper**

Use this opening wrapper and rename the existing closing tag to `KeyboardControllerAvoidingView`:

```jsx
<KeyboardControllerAvoidingView
  style={styles.container}
  behavior="translate-with-padding"
  keyboardVerticalOffset={headerHeight}
>
```

Keep the `FlatList`, `ImageAttachment`, input bar, five-line `TextInput`, and send button unchanged inside it.

- [ ] **Step 3: Remove the obsolete built-in keyboard policy from the composer core**

Replace `utils/agentComposerLayoutCore.cjs` with:

```js
'use strict';

const COMPOSER_MAX_VISIBLE_LINES = 5;
const COMPOSER_LINE_HEIGHT = 20;
const COMPOSER_VERTICAL_PADDING = 16;
const COMPOSER_MAX_HEIGHT =
  COMPOSER_LINE_HEIGHT * COMPOSER_MAX_VISIBLE_LINES + COMPOSER_VERTICAL_PADDING;

module.exports = {
  COMPOSER_MAX_VISIBLE_LINES,
  COMPOSER_LINE_HEIGHT,
  COMPOSER_VERTICAL_PADDING,
  COMPOSER_MAX_HEIGHT,
};
```

- [ ] **Step 4: Keep the existing composer contract focused on layout and input wiring**

Replace the two composer tests in `tests/client/agent-chat-contract.test.cjs` with:

```js
test('chat composer layout exposes the approved five-line policy', () => {
  assert.equal(composerLayout.COMPOSER_MAX_VISIBLE_LINES, 5);
  assert.equal(composerLayout.COMPOSER_LINE_HEIGHT, 20);
  assert.equal(composerLayout.COMPOSER_VERTICAL_PADDING, 16);
  assert.equal(composerLayout.COMPOSER_MAX_HEIGHT, 116);
});

test('chat composer wires the shared five-line policy to the real text input', () => {
  const screen = read('screens/AgentChatScreen.js');
  const composerInput = screen.match(
    /<TextInput\b(?:(?!\/>)[\s\S])*?placeholder="问我关于订单\/模型\/库存的问题…"(?:(?!\/>)[\s\S])*?\/>/,
  )?.[0];
  const composerStyle = screen.match(
    /input:\s*\{(?:(?!\r?\n\s{2}sendBtn:)[\s\S])*?\r?\n\s{2}\},\r?\n\s{2}sendBtn:/,
  )?.[0];

  assert.ok(composerInput, 'the composer TextInput should remain identifiable');
  assert.ok(composerStyle, 'the composer input style should remain identifiable');
  assert.match(screen, /require\('\.\.\/utils\/agentComposerLayoutCore\.cjs'\)/);
  assert.match(composerInput, /\bmultiline\b/);
  assert.match(composerInput, /\bscrollEnabled\b/);
  assert.match(composerInput, /textAlignVertical="top"/);
  assert.doesNotMatch(composerInput, /\bnestedScrollEnabled\b/);
  assert.doesNotMatch(composerInput, /\ballowFontScaling\b/);
  assert.match(composerStyle, /maxHeight:\s*COMPOSER_MAX_HEIGHT/);
  assert.match(composerStyle, /lineHeight:\s*COMPOSER_LINE_HEIGHT/);
  assert.match(composerStyle, /paddingVertical:\s*COMPOSER_VERTICAL_PADDING \/ 2/);
  assert.match(composerStyle, /includeFontPadding:\s*false/);
});
```

- [ ] **Step 5: Run the chat and keyboard contracts**

Run:

```powershell
node --test tests/client/agent-chat-contract.test.cjs tests/client/keyboard-layout-contract.test.cjs
```

Expected: the Xiaoli and five-line composer tests pass; only the login test remains red.

### Task 5: Make the login form focus-aware

**Files:**
- Modify: `screens/LoginScreen.js:1-170`
- Test: `tests/client/keyboard-layout-contract.test.cjs`

- [ ] **Step 1: Replace the built-in keyboard imports**

Remove `KeyboardAvoidingView`, `Platform`, and `ScrollView` from the `react-native` import. Add:

```js
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
```

- [ ] **Step 2: Replace the outer layout with a focus-aware scroll view**

Replace the opening `KeyboardAvoidingView` and nested `ScrollView` with:

```jsx
<KeyboardAwareScrollView
  style={styles.container}
  contentContainerStyle={styles.content}
  bottomOffset={SPACING.lg}
  keyboardShouldPersistTaps="handled"
  keyboardDismissMode="on-drag"
>
```

Keep the complete existing `shell`, brand block, card, inputs, button, warnings, and handlers unchanged. Remove the old `ScrollView` closing tag and replace the final `KeyboardAvoidingView` closing tag with:

```jsx
</KeyboardAwareScrollView>
```

- [ ] **Step 3: Run the focused keyboard contract**

Run:

```powershell
node --test tests/client/keyboard-layout-contract.test.cjs
```

Expected: all 4 keyboard integration tests pass.

### Task 6: Run automated regression checks

**Files:**
- Verify: `App.js`
- Verify: `screens/AgentChatScreen.js`
- Verify: `screens/LoginScreen.js`
- Verify: `utils/agentComposerLayoutCore.cjs`
- Test: `tests/client/keyboard-layout-contract.test.cjs`
- Test: `tests/client/agent-chat-contract.test.cjs`

- [ ] **Step 1: Run all relevant client test suites**

Run:

```powershell
node --test tests/client/keyboard-layout-contract.test.cjs tests/client/agent-chat-contract.test.cjs tests/client/agent-image-core.test.cjs tests/client/app-wide-ui.smoke.cjs tests/client/chinese-user-visible-errors.test.cjs
```

Expected: all keyboard, Xiaoli, image, app-wide UI, and Chinese error tests pass.

- [ ] **Step 2: Run Expo dependency diagnostics**

Run:

```powershell
npx expo install --check
npx expo-doctor
```

Expected: no incompatible dependency versions or missing native peer dependencies.

- [ ] **Step 3: Export the Web bundle**

Run:

```powershell
npx expo export --platform web --output-dir .tmp/keyboard-controller-web-check
```

Expected: Metro completes the Web export without module-resolution or worklet errors.

- [ ] **Step 4: Check targeted diffs and worktree safety**

Run:

```powershell
git diff --check -- package.json package-lock.json App.js screens/AgentChatScreen.js screens/LoginScreen.js utils/agentComposerLayoutCore.cjs tests/client/agent-chat-contract.test.cjs tests/client/keyboard-layout-contract.test.cjs
git status --short -- package.json package-lock.json App.js screens/AgentChatScreen.js screens/LoginScreen.js utils/agentComposerLayoutCore.cjs tests/client/agent-chat-contract.test.cjs tests/client/keyboard-layout-contract.test.cjs
```

Expected: no whitespace errors. Preserve all user changes already present in the modified and untracked files; do not create a mixed commit.

### Task 7: Validate the original failures in Expo Go

**Files:**
- Verify: Expo Go running the SDK 54 project on the user's Android device

- [ ] **Step 1: Start Metro with a clean cache**

Run:

```powershell
npx expo start --clear
```

Expected: Expo prints an SDK 54 QR code and reports no missing native module or worklet initialization error when Expo Go connects.

- [ ] **Step 2: Re-run the Xiaoli recording scenario**

On the same Android device and keyboard used in the supplied recording:

1. Open Xiaoli and focus the composer.
2. Confirm the image attachment bar, text input, and send button are all above the keyboard.
3. Switch among the letter keyboard, IME tools, and emoji panel.
4. Enter six or more lines and verify the composer stops at five-line height and scrolls internally.
5. Dismiss and reopen the keyboard.

Expected: the composer remains fully visible and follows every keyboard height without losing the draft.

- [ ] **Step 3: Re-run the login screenshot scenario**

1. Sign out to reach Login.
2. Focus email, then password, while leaving the keyboard open.
3. Confirm each focused input automatically scrolls above the keyboard with visible spacing.
4. Dismiss the keyboard.

Expected: neither focused field is obscured, and the login card returns to its normal centered layout.

- [ ] **Step 4: Check system-bar and navigation regressions**

Inspect the login status bar, Xiaoli native header, back button, settings button, and bottom gesture area before, during, and after keyboard display.

Expected: no added top inset, header overlap, bottom gap, or persistent offset after keyboard dismissal.

### Task 8: Commit only isolated work when safe

**Files:**
- Potentially stage only task-owned hunks from the files listed above.

- [ ] **Step 1: Inspect whether target files still contain unrelated user changes**

Run:

```powershell
git status --short
git diff -- package.json package-lock.json App.js screens/AgentChatScreen.js screens/LoginScreen.js utils/agentComposerLayoutCore.cjs tests/client/agent-chat-contract.test.cjs tests/client/keyboard-layout-contract.test.cjs
```

Expected: several target files still include pre-existing user work.

- [ ] **Step 2: Preserve mixed work instead of committing it**

Do not stage or commit mixed files. Report the completed implementation, tests, Expo Go result, and exact uncommitted files to the user. If every target is later isolated, use:

```powershell
git add -- package.json package-lock.json App.js screens/AgentChatScreen.js screens/LoginScreen.js utils/agentComposerLayoutCore.cjs tests/client/agent-chat-contract.test.cjs tests/client/keyboard-layout-contract.test.cjs
git commit -m "fix: keep chat and login inputs above keyboard"
```

Expected: no implementation commit is created while unrelated user changes share these files.
