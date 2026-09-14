'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildModelSource,
  reconcileUserModelIndex,
} = require('../../backend/agent/modelIndex');
const { getToolsForContext } = require('../../backend/agent/tools');

function fakeDb() {
  const rows = new Map();
  let state = null;
  const key = (userId, assetId, fingerprint) => `${userId}:${assetId}:${fingerprint}`;
  return {
    rows,
    getModelEmbedding: (userId, assetId, fingerprint) => rows.get(key(userId, assetId, fingerprint)),
    upsertModelEmbedding(row) { rows.set(key(row.user_id, row.asset_id, row.config_fingerprint), { ...row }); },
    deleteStaleModelEmbeddings(userId, fingerprint, assetIds) {
      for (const [rowKey, row] of rows) {
        if (row.user_id === String(userId) && row.config_fingerprint === fingerprint && !assetIds.includes(row.asset_id)) rows.delete(rowKey);
      }
    },
    setModelIndexState(next) { state = { ...next }; },
    get state() { return state; },
  };
}

const config = {
  baseUrl: 'https://embed.example/v1',
  apiKey: 'secret',
  model: 'embo-01',
  groupId: 'group',
  configFingerprint: 'fingerprint',
};

test('model source is deterministic and includes searchable business fields', () => {
  const first = buildModelSource({ id: '1', name: '花瓶', description: '螺旋', tags: ['装饰', '家居'], source: 'original' });
  const second = buildModelSource({ source: 'original', tags: ['装饰', '家居'], description: '螺旋', name: '花瓶', id: '1' });
  assert.equal(first, second);
  assert.match(first, /花瓶/);
  assert.match(first, /螺旋/);
});

test('reconcile backfills, skips unchanged rows, updates changes, and isolates users', async () => {
  const db = fakeDb();
  let calls = 0;
  const embed = async ({ texts }) => {
    calls += 1;
    return [[texts[0].length, 1]];
  };
  const models = [
    { id: '1', name: '花瓶', description: '螺旋' },
    { id: '2', name: '支架', description: '手机' },
  ];

  await reconcileUserModelIndex({ userId: 'u1', config, models, embed, db });
  assert.equal(calls, 2);
  assert.equal(db.state.status, 'ready');
  await reconcileUserModelIndex({ userId: 'u1', config, models, embed, db });
  assert.equal(calls, 2);

  models[0].description = '波浪螺旋';
  await reconcileUserModelIndex({ userId: 'u1', config, models, embed, db });
  assert.equal(calls, 3);
  await reconcileUserModelIndex({ userId: 'u2', config, models, embed, db });
  assert.equal(calls, 5);
  assert.equal(db.rows.size, 4);
});

test('one failed asset produces partial state and retry reaches ready', async () => {
  const db = fakeDb();
  let fail = true;
  const embed = async ({ texts }) => {
    if (fail && texts[0].includes('坏模型')) throw new Error('provider down');
    return [[1, 2, 3]];
  };
  const models = [{ id: '1', name: '正常' }, { id: '2', name: '坏模型' }];
  await reconcileUserModelIndex({ userId: 'u1', config, models, embed, db });
  assert.equal(db.state.status, 'partial');
  assert.equal(db.state.failed_count, 1);

  fail = false;
  await reconcileUserModelIndex({ userId: 'u1', config, models, embed, db });
  assert.equal(db.state.status, 'ready');
  assert.equal(db.state.ready_count, 2);
});

test('reconcile removes deleted assets from the active vector space', async () => {
  const db = fakeDb();
  const embed = async () => [[1]];
  await reconcileUserModelIndex({
    userId: 'u1', config, models: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }], embed, db,
  });
  await reconcileUserModelIndex({
    userId: 'u1', config, models: [{ id: '2', name: 'B' }], embed, db,
  });
  assert.equal(db.rows.size, 1);
  assert.equal([...db.rows.values()][0].asset_id, '2');
});

test('semantic search tool is exposed only when a usable index exists', () => {
  const withoutEmbedding = getToolsForContext({ embeddingReady: false }).map((tool) => tool.name);
  const withEmbedding = getToolsForContext({ embeddingReady: true }).map((tool) => tool.name);
  assert.equal(withoutEmbedding.includes('search_models_semantic'), false);
  assert.equal(withEmbedding.includes('search_models_semantic'), true);
  assert.equal(withoutEmbedding.includes('search_models_by_keyword'), true);
});
