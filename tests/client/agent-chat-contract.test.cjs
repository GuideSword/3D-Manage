'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const composerLayout = require('../../utils/agentComposerLayoutCore.cjs');

test('chat owns controlled attachments and permits image-only sends', () => {
  const screen = read('screens/AgentChatScreen.js');
  const attachment = read('components/agent/ImageAttachment.js');
  assert.match(screen, /<ImageAttachment[\s\S]*images=\{images\}/);
  assert.match(screen, /canSendDraft\(input, images\)/);
  assert.match(screen, /prepareAgentImages\(snapshot\.images\)/);
  assert.match(attachment, /onRemove/);
  assert.doesNotMatch(attachment, /EncodingType\.Base64/);
});

test('agent API supports public settings, candidate tests, and saves', () => {
  const api = read('utils/agentApi.js');
  assert.match(api, /getSettings:\s*\(\)\s*=>\s*apiRequest\('\/agent\/keys'\)/);
  assert.match(api, /testSettings:\s*\(settings\)[\s\S]*method:\s*'POST'/);
  assert.match(api, /saveSettings:\s*\(settings\)[\s\S]*method:\s*'PUT'/);
});

test('settings UI keeps LLM and optional Embedding credentials independent', () => {
  const screen = read('screens/AgentSettingsScreen.js');
  assert.match(screen, /Embedding · 可选/);
  assert.match(screen, /API Key 已配置；输入新 Key 可替换/);
  assert.match(screen, /baseUrl:\s*embedding\.baseUrl/);
  assert.match(screen, /apiKey:\s*embedding\.apiKey/);
  assert.match(screen, /model:\s*embedding\.model/);
  assert.doesNotMatch(screen, /embed_api_key:\s*llmApiKey/);
  assert.doesNotMatch(screen, /聊天和 Embedding 共用/);
});

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
