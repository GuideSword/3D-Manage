'use strict';
const { createBusinessPool } = require('../business-db/connection');
const { inspectBusinessStorage } = require('../business-db/storageMode');
const unavailable = (code, message, cause) => Object.assign(new Error(message), { code, status: 503, ...(cause ? { cause } : {}) });

async function dispose(handle, pool) {
  const errors = [];
  try { if (typeof handle?.close === 'function') await handle.close(); } catch (error) { errors.push(error); }
  try { await pool?.end(); } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, '业务运行资源关闭失败');
}

// Factories own only their selected router resources; this module owns the PG pool.
// Neither legacy store nor AI initialization is imported until a caller's factory runs.
async function createBusinessRuntime({ driver, connectionString, expectedServerId, factories } = {}) {
  const normalized = typeof driver === 'string' ? driver.trim().toLowerCase() : '';
  if (!['file', 'postgres', 'pg'].includes(normalized)) throw unavailable('BUSINESS_RUNTIME_CONFIGURATION_INVALID', '业务存储配置无效');
  if (!factories || typeof factories.legacy !== 'function' || typeof factories.relational !== 'function') {
    throw unavailable('BUSINESS_RUNTIME_CONFIGURATION_INVALID', '业务运行入口配置无效');
  }
  let pool, handle;
  try {
    if (normalized !== 'file') pool = await createBusinessPool({ connectionString });
    const inspected = pool ? await inspectBusinessStorage(pool, { expectedServerId }) : { mode: 'legacy', schemaVersion: 0, installation: null };
    const binding = Object.freeze({ ...inspected, installation: inspected.installation ? Object.freeze({ ...inspected.installation }) : null });
    handle = await factories[binding.mode]({ pool, installation: binding.installation });
    if (!handle || typeof handle.router !== 'function' || (handle.close !== undefined && typeof handle.close !== 'function')) {
      throw unavailable('BUSINESS_RUNTIME_CONFIGURATION_INVALID', '业务运行入口配置无效');
    }
    let closed = false, closing;
    const close = () => {
      if (!closing) { closed = true; closing = Promise.resolve().then(() => dispose(handle, pool)); }
      return closing;
    };
    const assertOpen = () => {
      if (closed) throw unavailable('BUSINESS_RUNTIME_CLOSED', '服务正在维护，请稍后再试');
    };
    const checkReady = async () => {
      assertOpen();
      if (pool) {
        const current = await inspectBusinessStorage(pool);
        if (current.mode !== binding.mode || current.schemaVersion !== binding.schemaVersion
          || current.installation?.serverId !== binding.installation?.serverId) {
          throw unavailable('BUSINESS_RUNTIME_CHANGED', '服务配置已变化，请稍后重试');
        }
      }
      // close() may have begun while discovery was awaiting PostgreSQL.
      assertOpen();
    };
    const router = async (req, res, next) => {
      try {
        await checkReady();
        return await handle.router(req, res, next);
      } catch (cause) {
        return next(unavailable(cause?.code || 'STORAGE_UNAVAILABLE', '服务器存储暂不可用，请稍后再试', cause));
      }
    };
    return { mode: binding.mode, router, checkReady, close };
  } catch (failure) {
    try { await dispose(handle, pool); }
    catch (cleanupError) {
      if (failure instanceof Error) failure.cleanupError = cleanupError;
      else throw new AggregateError([failure, cleanupError], '业务运行初始化及清理失败');
    }
    throw failure;
  }
}
module.exports = { createBusinessRuntime };
