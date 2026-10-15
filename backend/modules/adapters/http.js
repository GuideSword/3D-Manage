'use strict';
const express = require('express');
const { randomUUID } = require('node:crypto');
const { createRelationalServices } = require('./services');
const { withAuthenticatedRead } = require('../../business-db/reads');
const { createFailureLimiter } = require('../../utils/rateLimit');
const { PRODUCT_NAME, API_VERSION, SERVER_VERSION } = require('../../config/runtime');
const v = require('../catalog/validation');

function listQuery(query) {
  const result = { ...query };
  for (const key of ['limit', 'offset', 'page', 'pageSize']) {
    if (result[key] === undefined) continue;
    if (typeof result[key] !== 'string' || !/^\d{1,10}$/.test(result[key])) v.fail('分页参数无效');
    result[key] = Number(result[key]);
  }
  if (result.page !== undefined || result.pageSize !== undefined) {
    if (result.limit !== undefined || result.offset !== undefined) v.fail('不能混用分页参数');
    const page = result.page ?? 1, pageSize = result.pageSize ?? 100;
    if (page < 1 || pageSize < 1 || pageSize > 200 || (page - 1) * pageSize > 2147483647) v.fail('分页参数无效');
    delete result.page; delete result.pageSize;
    result.limit = pageSize; result.offset = (page - 1) * pageSize;
  }
  return result;
}
function createRelationalRouter(pool, options = {}) {
  const services = createRelationalServices(pool, options);
  const router = express.Router();
  router.use(express.json({ limit: '12mb' }));
  router.use((req, _res, next) => {
    req.url = req.url.replace(/^\/stock\/lots(?=[/?]|$)/, '/inventory/lots')
      .replace(/^\/stock\/inventory\/txns(?=[/?]|$)/, '/inventory/transactions');
    next();
  });
  const loginLimiter = createFailureLimiter({ maxEnv: 'LOGIN_RATE_LIMIT_MAX', windowEnv: 'LOGIN_RATE_LIMIT_WINDOW_MS' });
  const passwordLimiter = createFailureLimiter({ maxEnv: 'PASSWORD_RATE_LIMIT_MAX', windowEnv: 'PASSWORD_RATE_LIMIT_WINDOW_MS' });
  const route = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
  async function system() {
    return (await pool.query("SELECT server_id,organization_name,initialized_at,storage_mode FROM erp.installation WHERE id='default'")).rows[0];
  }
  router.get('/system/info', route(async (_req, res) => {
    const state = await system();
    res.json({ product: PRODUCT_NAME, serverId: state?.server_id ?? null, organizationName: state?.organization_name ?? '',
      initialized: Boolean(state?.initialized_at), apiVersion: API_VERSION, serverVersion: SERVER_VERSION,
      capabilities: { inventoryRulesVersion: 1, businessRulesVersion: state?.storage_mode === 'relational' ? 2 : 1, relationalBusiness: state?.storage_mode === 'relational' } });
  }));
  router.use(async (_req, _res, next) => {
    try {
      if ((await system())?.storage_mode !== 'relational') v.fail('关系业务入口尚未启用', 'RELATIONAL_STORAGE_NOT_ACTIVE', 503);
      next();
    } catch (error) { next(error); }
  });
  router.post('/auth/login', route(async (req, res) => {
    const key = loginLimiter.getKey(req);
    if (loginLimiter.isBlocked(key)) return loginLimiter.reject(res);
    try {
      v.fields(req.body, ['email', 'password'], ['email', 'password']);
      const result = await services.authentication.login(req.body);
      loginLimiter.reset(key); res.json(result);
    } catch (error) {
      if (error.code === 'AUTHENTICATION_FAILED') loginLimiter.recordFailure(key);
      throw error;
    }
  }));
  router.use(async (req, _res, next) => {
    try {
      const authorization = req.get('Authorization') || '';
      const session = authorization.startsWith('Bearer ') ? await services.authentication.authenticate(authorization.slice(7)) : null;
      if (!session) v.fail('请重新登录', 'AUTHENTICATION_REQUIRED', 401);
      req.businessSession = session; next();
    } catch (error) { next(error); }
  });
  router.get('/auth/me', route(async (req, res) => res.json(await services.users.me(req.businessSession))));
  router.post('/auth/change-password', route(async (req, res) => {
    const session = req.businessSession;
    const limitKey = passwordLimiter.getKey(req, session.actorId);
    if (passwordLimiter.isBlocked(limitKey)) return passwordLimiter.reject(res);
    v.fields(req.body, ['version', 'currentPassword', 'newPassword'], ['currentPassword', 'newPassword']);
    try {
      const result = await services.users.changeOwnPassword({ actorId: session.actorId, tokenVersion: session.tokenVersion,
        key: req.get('Idempotency-Key') || randomUUID(), payload: { ...req.body, version: req.body.version ?? session.user.version } });
      passwordLimiter.reset(limitKey); res.status(result.status).json(result.body);
    } catch (error) {
      if (error.code === 'CURRENT_PASSWORD_INVALID') passwordLimiter.recordFailure(limitKey);
      throw error;
    }
  }));
  router.use((req, _res, next) => {
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        if (req.get('X-Business-Rules-Version') !== '2') v.fail('请升级客户端后再修改业务资料', 'CLIENT_UPGRADE_REQUIRED', 428);
        if (!/^[A-Za-z0-9._:-]{1,128}$/.test(req.get('Idempotency-Key') || '')) v.fail('缺少有效的操作标识', 'COMMAND_KEY_INVALID');
      }
      next();
    } catch (error) { next(error); }
  });
  const execute = async (req, res, service, operation, payload) => {
    const { actorId, tokenVersion } = req.businessSession;
    const result = await service.execute({ actorId, tokenVersion, key: req.get('Idempotency-Key'), operation, payload });
    res.status(result.status).json(result.body);
  };
  router.get('/commands/:scope/:key', route(async (req, res) => {
    if (!['business', 'inventory', 'account'].includes(req.params.scope) || !/^[A-Za-z0-9._:-]{1,128}$/.test(req.params.key)) v.fail('操作标识无效');
    const result = await withAuthenticatedRead(pool, req.businessSession, async (tx, actor) => {
      const row = (await tx.query('SELECT result FROM erp.command_receipts WHERE scope=$1 AND actor_id=$2 AND key=$3', [req.params.scope, actor.id, req.params.key])).rows[0];
      if (!row) v.fail('未找到当前账号的操作回执', 'COMMAND_NOT_FOUND', 404);
      return row.result;
    });
    res.json(result);
  }));
  router.get('/csv/:kind', route(async (req, res) => {
    const file = await services.csv.exportRecords(req.businessSession, req.params.kind, req.query);
    res.set('Content-Type', file.contentType).set('Content-Disposition', `attachment; filename="${file.filename}"`).send(file.content);
  }));
  router.post('/csv/:kind', route(async (req, res) => {
    v.fields(req.body, ['csv'], ['csv']);
    const result = await services.csv.importRecords(req.businessSession, req.params.kind, req.body.csv, req.get('Idempotency-Key'));
    res.status(result.status).json(result.body);
  }));
  for (const [path, service, prefix] of [['materials', services.materials, 'material'], ['models', services.models, 'model'], ['orders', services.orders, 'order'], ['users', services.users, 'user'], ['inventory/lots', services.inventory, 'lot']]) {
    if (['material', 'model', 'order'].includes(prefix)) {
      router.get(`/${path}/export`, route(async (req, res) => res.json(await services.csv.exportRecords(req.businessSession, path, req.query))));
      router.post(`/${path}/import`, route(async (req, res) => {
        v.fields(req.body, ['csv'], ['csv']);
        const result = await services.csv.importRecords(req.businessSession, path, req.body.csv, req.get('Idempotency-Key'));
        res.status(result.status).json(result.body);
      }));
    }
    router.get(`/${path}`, route(async (req, res) => {
      const query = listQuery(req.query);
      const result = await service.list(req.businessSession, query);
      res.json({ ...result, page: Math.floor((query.offset ?? 0) / (query.limit ?? 100)) + 1, pageSize: query.limit ?? 100 });
    }));
    router.get(`/${path}/:id/audit`, route(async (req, res) => {
      const entity = prefix === 'lot' ? 'stockLots' : path;
      const items = await withAuthenticatedRead(pool, req.businessSession, async (tx, actor) => {
        if (actor.role !== 'owner') v.fail('只有 Owner 可以查看审计记录', 'BUSINESS_FORBIDDEN', 403);
        const rows = (await tx.query('SELECT id,actor_id,legacy_actor_id,entity,entity_id,action,diff::text,created_at FROM erp.audit_logs WHERE entity=$1 AND entity_id=$2 ORDER BY created_at DESC,id', [entity, req.params.id])).rows;
        return rows.map(row => ({ id: row.id, actorId: row.actor_id || row.legacy_actor_id || '', entity: row.entity, entityId: row.entity_id,
          action: row.action, diff: row.diff === null ? null : v.legacy(row.diff), createdAt: v.iso(row.created_at) }));
      });
      res.json({ items, total: items.length });
    }));
    router.get(`/${path}/:id`, route(async (req, res) => res.json(await service.get(req.businessSession, req.params.id))));
    router.post(`/${path}`, route((req, res) => execute(req, res, service, `${prefix}.create`, req.body)));
    router.patch(`/${path}/:id`, route(async (req, res) => {
      let changes;
      if (req.body && Object.hasOwn(req.body, 'changes')) {
        v.fields(req.body, ['version', 'changes'], ['version', 'changes']);
        changes = req.body.changes;
      } else {
        if (!req.body || !Object.hasOwn(req.body, 'version')) v.fail('缺少记录版本');
        const { version: _version, ...fields } = req.body;
        changes = fields;
      }
      await execute(req, res, service, `${prefix}.update`, { id: req.params.id, version: req.body.version, changes });
    }));
    router.delete(`/${path}/:id`, route(async (req, res) => {
      v.fields(req.body, ['version'], ['version']);
      await execute(req, res, service, `${prefix}.delete`, { id: req.params.id, version: req.body.version });
    }));
    if (['material', 'model'].includes(prefix)) router.post(`/${path}/:id/active`, route(async (req, res) => {
      v.fields(req.body, ['version', 'active'], ['version', 'active']);
      await execute(req, res, service, `${prefix}.setActive`, { ...req.body, id: req.params.id });
    }));
  }
  for (const [path, service, operation] of [
    ['orders/:id/transition', services.orders, 'order.transition'], ['orders/:id/refresh-customer', services.orders, 'order.refreshCustomer'],
    ['orders/:id/attachments/add', services.orders, 'order.attachment.add'], ['orders/:id/attachments/remove', services.orders, 'order.attachment.remove'],
    ['inventory/lots/:id/state', services.inventory, 'lot.setState'], ['inventory/lots/:id/archive', services.inventory, 'lot.archive'],
    ['users/:id/reset-password', services.users, 'user.resetPassword'],
    ...['file', 'image'].flatMap(kind => ['add', 'remove'].map(action => [`models/:id/${kind}s/${action}`, services.models, `model.${kind}.${action}`])),
  ]) router.post(`/${path}`, route(async (req, res) => {
    if (Object.hasOwn(req.body || {}, 'id')) v.fail('记录标识必须来自请求路径');
    await execute(req, res, service, operation, { ...req.body, id: req.params.id });
  }));
  router.patch('/orders/:id/status', route(async (req, res) => {
    v.fields(req.body, ['version', 'status', 'reason'], ['version', 'status']);
    await execute(req, res, services.orders, 'order.transition', { ...req.body, id: req.params.id });
  }));
  router.get('/stock/export', route(async (req, res) => {
    const { type = 'lots', ...query } = req.query;
    if (!['lots', 'transactions'].includes(type)) v.fail('库存导出类型无效');
    res.json(await services.csv.exportRecords(req.businessSession, type, query));
  }));
  router.post('/stock/import', route(async (req, res) => {
    v.fields(req.body, ['csv'], ['csv']);
    const result = await services.csv.importRecords(req.businessSession, 'lots', req.body.csv, req.get('Idempotency-Key'));
    res.status(result.status).json(result.body);
  }));
  router.get('/inventory/transactions', route(async (req, res) => res.json(await services.inventory.listTransactions(req.businessSession, listQuery(req.query)))));
  router.get('/inventory/transactions/:id', route(async (req, res) => res.json(await services.inventory.getTransaction(req.businessSession, req.params.id))));
  router.post('/inventory/transactions', route((req, res) => execute(req, res, services.inventory, 'inventory.post', req.body)));
  router.get('/inventory/summary', route(async (req, res) => {
    const query = { ...req.query };
    if (query.lowStockOnly !== undefined) {
      if (!['true', 'false'].includes(query.lowStockOnly)) v.fail('低库存筛选参数无效');
      query.lowStockOnly = query.lowStockOnly === 'true';
    }
    res.json(await services.inventory.summary(req.businessSession, query));
  }));
  router.use((_req, _res, next) => next(Object.assign(new Error('接口不存在'), { status: 404, code: 'ENDPOINT_NOT_FOUND' })));
  router.use((error, _req, res, _next) => {
    if (['entity.parse.failed', 'entity.too.large'].includes(error.type)) return res.status(error.type === 'entity.too.large' ? 413 : 400)
      .json({ code: 'REQUEST_BODY_INVALID', error: '请求内容格式无效或超过允许大小' });
    const publicError = Number.isInteger(error.status) && error.status >= 400 && error.status <= 499 && /^[A-Z_]+$/.test(error.code || '');
    if (error.code === 'RELATIONAL_STORAGE_NOT_ACTIVE') return res.status(503).json({ code: error.code, error: error.message });
    res.status(publicError ? error.status : 500).json({ code: publicError ? error.code : 'BUSINESS_SERVICE_UNAVAILABLE', error: publicError ? error.message : '业务服务暂时不可用，请稍后重试' });
  });
  return router;
}
module.exports = { createRelationalRouter };
