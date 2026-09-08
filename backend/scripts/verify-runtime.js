'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const runtimePath = path.resolve(__dirname, '../config/runtime.js');
const good = {
  NODE_ENV: 'production',
  PORT: '5000',
  STORE_DRIVER: 'file',
  JWT_SECRET: 'j'.repeat(40),
  AGENT_KEY_ENC_SECRET: 'a'.repeat(40),
  BOOTSTRAP_TOKEN: 'b'.repeat(40),
};
const run = (changes) => spawnSync(process.execPath, ['-e', `require(${JSON.stringify(runtimePath)}).assertRuntimeConfig()`], {
  env: { ...process.env, ...good, ...changes },
  encoding: 'utf8',
});

assert.equal(run({}).status, 0);
assert.notEqual(run({ JWT_SECRET: '' }).status, 0);
assert.notEqual(run({ JWT_SECRET: 'CHANGE_ME_bad_but_long_enough_123456' }).status, 0);
assert.notEqual(run({ PORT: '70000' }).status, 0);
assert.notEqual(run({ STORE_DRIVER: 'unknown' }).status, 0);
assert.notEqual(run({ STORE_DRIVER: 'postgres', DATABASE_URL: '' }).status, 0);
assert.notEqual(run({ AGENT_ENABLED: 'true', AGENT_KEY_ENC_SECRET: '' }).status, 0);
console.log('Runtime configuration verification passed');
