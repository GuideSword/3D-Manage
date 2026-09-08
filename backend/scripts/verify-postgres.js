'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for verify:postgres');
const suffix = crypto.randomBytes(6).toString('hex');
process.env.STORE_DRIVER = 'postgres';
process.env.STORE_TABLE = `verify_store_${suffix}`;
process.env.STORE_ID = 'test';

const { Pool } = require('pg');
const { closeStore, getData, withData } = require('../utils/store');

const main = async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const initial = await getData();
    const serverId = initial.system.serverId;
    await assert.rejects(withData((data) => {
      data.orders.push({ id: 'rollback' });
      throw new Error('rollback');
    }), /rollback/);
    assert.equal((await getData()).orders.length, 0);

    const attempts = await Promise.allSettled([1, 2].map((id) => withData((data) => {
      if (data.users.length) throw new Error('already initialized');
      data.users.push({ id: String(id), role: 'owner', active: true, tokenVersion: 1 });
      data.system.initializedAt = new Date().toISOString();
      return id;
    })));
    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal((await getData()).users.filter((user) => user.role === 'owner').length, 1);
    await closeStore();
    assert.equal((await getData()).system.serverId, serverId);
    console.log('PostgreSQL store verification passed');
  } finally {
    await closeStore();
    await pool.query(`DROP TABLE IF EXISTS "${process.env.STORE_TABLE}"`);
    await pool.end();
  }
};

main().catch((error) => { console.error(error); process.exitCode = 1; });
