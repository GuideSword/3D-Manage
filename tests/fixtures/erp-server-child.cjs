'use strict';
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
let app;
function loaded() {
  const cache = Object.keys(require.cache);
  return { loadedLegacy: cache.some(file => /backend[\\/]utils[\\/]store\.js$/.test(file)),
    loadedAI: cache.some(file => /backend[\\/]db[\\/]agent\.js$/.test(file)),
    agentFile: fs.existsSync(path.join(process.env.DATA_DIR, 'agent.db')) };
}
let closing;
const close = () => closing ||= Promise.resolve().then(async () => {
  try {
    if (app) {
      const first = app.shutdown('ERP runtime fixture');
      assert.equal(app.shutdown('ERP runtime fixture repeated'), first);
      await first;
      await assert.rejects(app.start(), { code: 'BUSINESS_RUNTIME_CLOSED' });
    }
  }
  finally { if (process.connected) process.disconnect(); }
});
process.on('message', message => { if (message === 'stop') close().catch(() => { process.exitCode = 1; }); });
(async () => {
  app = require('../../backend/server');
  if (!app.ready || typeof app.ready.then !== 'function') throw Object.assign(Error('Server readiness contract missing'), { code: 'READY_CONTRACT_MISSING' });
  const runtime = await app.ready;
  if (process.env.ERP_RUNTIME_STOP_DURING_START === 'true') {
    const pending = app.start();
    const stopping = app.shutdown('Stop during startup fixture');
    await assert.rejects(pending, { code: 'BUSINESS_RUNTIME_CLOSED' });
    await stopping;
    process.send({ state: 'stopped-before-start', mode: runtime.mode, ...loaded() });
    if (process.connected) process.disconnect();
    return;
  }
  const starting = app.start();
  assert.equal(app.start(), starting);
  const listener = await starting;
  process.send({ state: 'ready', port: listener.address().port, mode: runtime.mode, ...loaded() });
})().catch(async error => {
  process.exitCode = 1;
  if (process.connected) process.send({ state: 'failed', code: error.code, message: error.message, ...loaded() });
  await close();
});
