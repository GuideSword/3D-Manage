'use strict';
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { Client } = require('pg');

const sha256 = value => createHash('sha256').update(value).digest('hex');
function sourceError(code, message) { return Object.assign(new Error(message), { code }); }

function parseSource(input) {
  let raw;
  let data;
  try {
    raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.isBuffer(input) ? input : Buffer.from(input));
    data = JSON.parse(raw, (key, value, context) => {
      if (typeof value !== 'number') return value;
      if (typeof context?.source !== 'string') throw sourceError('PREFLIGHT_RUNTIME_UNSUPPORTED', '运行时不支持精确读取 JSON 数值');
      return context.source;
    });
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Expected a store object');
  } catch (cause) {
    if (cause.code === 'PREFLIGHT_RUNTIME_UNSUPPORTED') throw cause;
    throw Object.assign(sourceError('PREFLIGHT_SOURCE_INVALID', '来源不是有效的 UTF-8 业务 JSON 对象'), { cause });
  }
  return { raw, data, sha256: sha256(Buffer.from(raw)) };
}

function assertSourceHash(source, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected || '') || sha256(Buffer.from(source.raw)) !== expected) {
    throw sourceError('PREFLIGHT_SOURCE_CHANGED', '来源内容已改变，必须重新生成预检和映射');
  }
}

async function readFileSource(filename) {
  return { ...parseSource(await fs.readFile(filename)), origin: { kind: 'file' } };
}

async function withReadOnlySourceClient({ connectionString }, callback) {
  let url;
  try { url = new URL(connectionString); } catch (_) { /* validated below */ }
  if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
    throw sourceError('PREFLIGHT_CONNECTION_INVALID', '必须显式提供 PostgreSQL 来源连接');
  }
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve the source error */ }
    throw error;
  } finally { await client.end().catch(() => {}); }
}

async function readPostgresSource({ connectionString, table = 'app_store', storeId = 'default' }) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table) || typeof storeId !== 'string' || !storeId) {
    throw sourceError('PREFLIGHT_SOURCE_CONFIG_INVALID', '来源表或记录标识无效');
  }
  return withReadOnlySourceClient({ connectionString }, async client => {
    const { rows } = await client.query(`SELECT data::text AS raw FROM "${table}" WHERE id=$1`, [storeId]);
    if (rows.length !== 1) throw sourceError('PREFLIGHT_SOURCE_MISSING', '找不到唯一的业务来源记录');
    return { ...parseSource(rows[0].raw), origin: { kind: 'postgres', table, storeId } };
  });
}

module.exports = { parseSource, readFileSource, readPostgresSource, withReadOnlySourceClient, assertSourceHash, sha256 };
