'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyCoreMemoryCandidate, searchArchiveKeyword } = require('../../backend/agent/memoryService');

test('core memory accepts only explicit facts from an owned user message', () => {
  const inserted = [];
  const db = {
    getOwnedUserMessage: () => ({ id: 'm1', content: { role: 'user', content: '以后报价默认使用人民币' } }),
    listCoreMemories: () => [],
    insertCoreMemory: (row) => inserted.push(row),
  };
  const result = applyCoreMemoryCandidate({
    userId: 'u1', category: 'user_preferences', content: '报价默认使用人民币', sourceMessageId: 'm1', db,
  });
  assert.equal(result.saved, true);
  assert.equal(inserted.length, 1);

  assert.throws(() => applyCoreMemoryCandidate({
    userId: 'u1', category: 'personality', content: '喜欢便宜', sourceMessageId: 'm1', db,
  }), { code: 'MEMORY_CATEGORY_INVALID' });
  assert.throws(() => applyCoreMemoryCandidate({
    userId: 'u1', category: 'user_preferences', content: '用户喜欢红色', sourceMessageId: 'm1', db,
  }), { code: 'MEMORY_NOT_EXPLICIT' });
});

test('keyword archive search never receives another users passages', () => {
  const db = {
    listArchivalPassages(userId) {
      assert.equal(userId, 'u1');
      return [{ id: 'p1', conversation_id: 'c1', text: '客户需要莲花形状花瓶', topic: '模型', source_sequence_start: 1, source_sequence_end: 2 }];
    },
  };
  const result = searchArchiveKeyword('u1', '莲花花瓶', 5, db);
  assert.equal(result[0].id, 'p1');
  assert.equal(result[0].strategy, 'keyword');
});
