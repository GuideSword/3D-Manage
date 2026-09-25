'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getKeyboardVerticalOffset } = require('../../utils/agentKeyboardOffsetCore.cjs');

const controllerPadding = (windowHeight, keyboardHeight, offset, layout) =>
  Math.max(layout.y + layout.height - (windowHeight - keyboardHeight - offset), 0);

test('derived offset predicts no excess for the captured Expo Go geometry', () => {
  const layout = { y: 0, height: 696 };
  assert.equal(controllerPadding(792, 303, 335, layout), 542);
  const offset = getKeyboardVerticalOffset(792, layout);
  assert.equal(offset, 96);
  for (const keyboardHeight of [200, 303, 380]) {
    assert.equal(controllerPadding(792, keyboardHeight, offset, layout), keyboardHeight);
  }
});

test('offset follows changing layout and window dimensions', () => {
  assert.equal(getKeyboardVerticalOffset(900, { y: 0, height: 780 }), 120);
  assert.equal(getKeyboardVerticalOffset(640, { y: 0, height: 600 }), 40);
  assert.equal(getKeyboardVerticalOffset(640, { y: 12, height: 600 }), 28);
  assert.equal(getKeyboardVerticalOffset(792, null), 0);
  assert.equal(getKeyboardVerticalOffset(792, { y: 0, height: 0 }), 0);
  assert.equal(getKeyboardVerticalOffset(Number.NaN, { y: 0, height: 696 }), 0);
});
