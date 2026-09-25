'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Expo SDK 54 keyboard dependencies stay on bundled versions', () => {
  const pkg = JSON.parse(read('package.json'));

  assert.equal(pkg.dependencies['@react-navigation/elements'], '^2.9.3');
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

test('Xiaoli derives its keyboard offset from live window and layout geometry', () => {
  const screen = read('screens/AgentChatScreen.js');

  assert.match(
    screen,
    /KeyboardAvoidingView as KeyboardControllerAvoidingView/,
  );
  assert.match(screen, /useWindowDimensions as useControllerWindowDimensions/);
  assert.match(screen, /getKeyboardVerticalOffset\(controllerWindowHeight, avoidingLayout\)/);
  assert.match(
    screen,
    /<KeyboardControllerAvoidingView[\s\S]*?behavior="padding"[\s\S]*?keyboardVerticalOffset=\{keyboardVerticalOffset\}[\s\S]*?onLayout=\{recordAvoidingLayout\}/,
  );
  assert.doesNotMatch(screen, /useHeaderHeight/);
  assert.doesNotMatch(screen, /behavior="translate-with-padding"/);
  assert.doesNotMatch(screen, /\bKeyboardAvoidingView,?\s*\r?\n/);
});

test('temporary Xiaoli keyboard diagnostics have been removed', () => {
  const screen = read('screens/AgentChatScreen.js');
  assert.equal(/KeyboardGapProbe|recordComposerLayout|composerLayout/.test(screen), false);
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

test('agent client verification includes the keyboard layout contract', () => {
  const pkg = JSON.parse(read('package.json'));

  assert.match(
    pkg.scripts['verify:agent-client'],
    /\btests\/client\/keyboard-layout-contract\.test\.cjs\b/,
  );
});
