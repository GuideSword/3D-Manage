'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldSendOnEnter } = require('../../utils/agentComposerKeyCore.cjs');

test('Web Enter submits a composer message', () => {
  assert.equal(shouldSendOnEnter({ platform: 'web', key: 'Enter' }), true);
});

test('Web Shift+Enter keeps the newline path', () => {
  assert.equal(shouldSendOnEnter({ platform: 'web', key: 'Enter', shiftKey: true }), false);
});

test('composition Enter never submits', () => {
  assert.equal(shouldSendOnEnter({ platform: 'web', key: 'Enter', isComposing: true }), false);
});

test('native Enter keeps native TextInput behavior', () => {
  assert.equal(shouldSendOnEnter({ platform: 'android', key: 'Enter' }), false);
});
