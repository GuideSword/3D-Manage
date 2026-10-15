'use strict';

const { Pool } = require('pg');

function configurationError(code, message) {
  return Object.assign(new Error(message), { code });
}

async function assertBusinessDatabaseVersion(client) {
  const { rows } = await client.query("SELECT current_setting('server_version_num')::int AS version");
  if (rows[0].version < 160000 || rows[0].version >= 170000) {
    throw configurationError('ERP_DATABASE_VERSION_UNSUPPORTED', 'ERP 数据基础需要 PostgreSQL 16');
  }
}

async function createBusinessPool({ connectionString } = {}) {
  if (typeof connectionString !== 'string' || !connectionString.trim()) {
    throw configurationError('ERP_DATABASE_URL_REQUIRED', '必须显式提供 ERP 专用数据库连接');
  }
  let url;
  try { url = new URL(connectionString); } catch (_) { /* validated below */ }
  if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname
      || !url.pathname || url.pathname === '/' || url.hash) {
    throw configurationError('ERP_DATABASE_URL_INVALID', 'ERP 数据库连接格式无效');
  }
  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000,
    application_name: 'manage3d-erp' });
  try {
    await assertBusinessDatabaseVersion(pool);
    return pool;
  } catch (cause) {
    await pool.end();
    if (cause.code === 'ERP_DATABASE_VERSION_UNSUPPORTED') throw cause;
    throw Object.assign(configurationError('ERP_DATABASE_UNAVAILABLE', '无法连接 ERP 专用数据库'), { cause });
  }
}

const closeBusinessPool = pool => pool.end();
module.exports = { createBusinessPool, closeBusinessPool, assertBusinessDatabaseVersion };
