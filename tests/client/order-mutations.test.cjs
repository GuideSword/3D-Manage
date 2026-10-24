'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const babel = require('@babel/core');
const masterDataCore = require('../../utils/masterDataCore.cjs');

function evaluate(file, mocks, globals = {}) {
  const filename = path.resolve(__dirname, '../..', file);
  const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: id => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      throw new Error(`Unexpected import: ${file}: ${id}`);
    },
    fetch, setTimeout, clearTimeout, AbortController, FormData, URLSearchParams, console, ...globals,
  }, { filename });
  return module.exports;
}

test('Web confirmation executes only the chosen callback and acknowledgement continues navigation', async () => {
  let accepted = false, performed = 0, cancelled = 0;
  const { showAlert } = evaluate('utils/platformAlert.js', { 'react-native': { Platform: { OS: 'web' }, Alert: { alert() { throw new Error('Web native Alert must not run'); } } } }, {
    window: { confirm: () => accepted, alert: () => {} },
  });
  const buttons = [{ text: '取消', style: 'cancel', onPress: () => cancelled++ }, { text: '删除', onPress: async () => performed++ }];
  await showAlert('确认删除', '确定吗？', buttons);
  assert.equal(performed, 0); assert.equal(cancelled, 1);
  accepted = true;
  await showAlert('确认删除', '确定吗？', buttons);
  assert.equal(performed, 1);
  showAlert('成功', '已删除', [{ text: '确定', onPress: () => performed++ }]);
  assert.equal(performed, 2);
});

for (const platform of ['android', 'ios']) test(`${platform} keeps native confirmation and its deferred callback`, () => {
  let args, performed = 0;
  const { showAlert } = evaluate('utils/platformAlert.js', { 'react-native': { Platform: { OS: platform }, Alert: { alert: (...value) => { args = value; } } } });
  const buttons = [{ text: '取消', style: 'cancel' }, { text: '确认', onPress: () => performed++ }];
  const options = { cancelable: true };
  showAlert('确认操作', '更新状态', buttons, options);
  assert.equal(performed, 0);
  assert.equal(args[2], buttons); assert.equal(args[3], options);
  args[2][1].onPress(); assert.equal(performed, 1);
});

for (const platform of ['web', 'android', 'ios']) for (const relational of [false, true]) {
  test(`${platform} ${relational ? 'relational' : 'legacy'} order hook sends authenticated HTTP writes and keeps server results`, async t => {
    const requests = [];
    let record = { id: 'test-order', status: 'pending_review', version: '9007199254740993' };
    const server = http.createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.authorization !== 'Bearer isolated-token' || (relational && (body.version !== record.version || req.headers['x-business-rules-version'] !== '2' || !req.headers['idempotency-key']))) {
        res.writeHead(400).end(JSON.stringify({ error: '订单操作缺少身份、版本或幂等标识' })); return;
      }
      if (req.method === 'DELETE') res.end(JSON.stringify({ success: true }));
      else { record = { ...record, status: body.status, version: String(BigInt(record.version) + 1n), statusReason: '服务端返回' }; res.end(JSON.stringify(record)); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const runtime = { apiBaseUrl: `http://127.0.0.1:${server.address().port}/api`, serverKey: 'test-server', sessionEpoch: 1,
      capabilities: relational ? { relationalBusiness: true, businessRulesVersion: 2 } : {} };
    const runtimeModule = { getServerRuntime: () => runtime, isCurrentRuntime: value => value === runtime,
      registerOperation: () => ({ controller: new AbortController(), release() {} }), StaleSessionError: class extends Error {} };
    const hooks = { useRef: value => ({ current: value }), useState: value => [value, () => {}], useEffect() {}, useCallback: fn => fn };
    const api = evaluate('utils/api.js', {
      'react-native': { Platform: { OS: platform } }, 'expo-crypto': { randomUUID }, './serverRuntime': runtimeModule,
      './sessionStorage': { getToken: async () => 'isolated-token', clearToken: async () => {}, setTokenForSnapshot: async () => true },
      './nativeDownload': {}, './userErrorCore.cjs': require('../../utils/userErrorCore.cjs'),
    });
    const relationalApi = evaluate('utils/relationalOrdersApi.js', { './api': api, './serverRuntime': runtimeModule, './masterDataCore.cjs': masterDataCore });
    const auth = { useAuth: () => ({ user: { id: 'owner' } }) };
    const command = evaluate('utils/useBusinessCommand.js', { react: hooks, 'expo-crypto': { randomUUID }, '../context/AuthContext': auth,
      './serverRuntime': runtimeModule, './masterDataCore.cjs': masterDataCore });
    const mutation = evaluate('utils/useMasterDataMutation.js', { react: hooks, './api': api, './useBusinessCommand': command, './serverRuntime': runtimeModule });
    const { useOrderMutation } = evaluate('utils/useOrderMutation.js', { './api': api, './relationalOrdersApi': relationalApi,
      '../context/ServerConfigContext': { useServerConfig: () => ({ server: runtime }) }, './useMasterDataMutation': mutation, './masterDataCore.cjs': masterDataCore });
    const orderMutation = useOrderMutation({ addListener: () => () => {} });
    for (const status of ['in_progress', 'cancelled', 'draft']) {
      const result = await orderMutation.transition(record, status);
      assert.equal(result.status, status);
      assert.equal(result.statusReason, '服务端返回');
      assert.equal(requests.at(-1).url, relational ? '/api/orders/test-order/transition' : '/api/orders/test-order/status');
      assert.equal(requests.at(-1).method, relational ? 'POST' : 'PATCH');
    }
    assert.equal((await orderMutation.remove(record)).success, true);
    assert.equal(requests.at(-1).method, 'DELETE');
    assert.equal(requests.length, 4);
    if (relational) {
      assert.equal(requests[0].body.version, '9007199254740993');
      assert.equal(new Set(requests.map(req => req.headers['idempotency-key'])).size, 4);
    } else assert.equal(requests.at(-1).body, undefined);
  });
}
