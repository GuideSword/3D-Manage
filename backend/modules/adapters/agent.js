'use strict';
const { createHmac, timingSafeEqual, randomUUID } = require('node:crypto');
const { createBusinessCommands } = require('../../business-db/commands');
const { withAuthenticatedRead } = require('../../business-db/reads');
const { credentialKey } = require('../users/validation');
const { createMaterialService, materialCommands, validateMaterialChanges } = require('../materials/service');
const { createModelService, modelCommands, validateModelChanges } = require('../models/service');
const { createOrderService, orderCommands, validateOrderProposalChanges } = require('../orders/service');
const { createInventoryService } = require('../inventory/service');
const v = require('../catalog/validation');
const { createRelationalAgentDataPort } = require('../../agent/adapters/relational');

function stable(value, depth = 0) {
  if (depth > 12) v.fail('提案内容嵌套过深');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (Number.isSafeInteger(value) && typeof value === 'number')) return JSON.stringify(value);
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) v.fail('提案内容格式无效');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key], depth + 1)).join(',') + '}';
}
function createAgentAdapter(pool, session, { jwtSecret, uploadDirectory, semanticLookup } = {}) {
  credentialKey(jwtSecret);
  const signingKey = createHmac('sha256', jwtSecret).update('3d-manage:agent-proposals:v1').digest();
  const boundSession = Object.freeze({ actorId: session?.actorId, tokenVersion: session?.tokenVersion });
  const options = { uploadDirectory };
  const services = { models: createModelService(pool, options), materials: createMaterialService(pool), orders: createOrderService(pool, options), inventory: createInventoryService(pool, options) };
  const validators = { models: validateModelChanges, materials: validateMaterialChanges, orders: validateOrderProposalChanges };
  const handlers = { models: modelCommands(options)['model.update'], materials: materialCommands['material.update'] };
  const orderHandlers = orderCommands(options);
  const sign = proposal => createHmac('sha256', signingKey).update(stable(proposal)).digest('hex');
  async function identity(requireWriter = false) {
    return withAuthenticatedRead(pool, boundSession, async (tx, actor) => {
      if (requireWriter && !['owner', 'staff'].includes(actor.role)) v.fail('当前账号不能确认业务修改', 'BUSINESS_FORBIDDEN', 403);
      const state = (await tx.query("SELECT server_id,storage_mode FROM erp.installation WHERE id='default'")).rows[0];
      if (state?.storage_mode !== 'relational') v.fail('关系业务入口尚未启用', 'RELATIONAL_STORAGE_NOT_ACTIVE', 503);
      return { actorId: actor.id, serverId: state.server_id };
    });
  }
  const execute = createBusinessCommands(pool, { 'agent.record.update': { roles: ['owner', 'staff'], async handle(tx, context) {
    const { entity, id, expectedVersion, changes } = context.payload;
    if (entity !== 'orders') return handlers[entity].handle(tx, { ...context, payload: { id, version: expectedVersion, changes } });
    const { status, reason, ...edit } = changes;
    let result;
    if (Object.keys(edit).length) result = await orderHandlers['order.update'].handle(tx, { ...context, payload: { id, version: expectedVersion, changes: edit } });
    if (status !== undefined) result = await orderHandlers['order.transition'].handle(tx, { ...context,
      payload: { id, version: result?.body.version ?? expectedVersion, status, ...(reason !== undefined ? { reason } : {}) } });
    return result;
  } } });
  function normalizeProposal(input) {
    v.fields(input, ['entity', 'id', 'changes'], ['entity', 'id', 'changes']);
    if (!Object.hasOwn(validators, input.entity)) v.fail('不支持的修改资料类型');
    // Legacy tool spelling is accepted only at this seam; no customer-name guessing.
    const changes = {};
    v.fields(input.changes, input.entity === 'orders' ? ['notes', 'dueDate', 'due_date', 'status', 'reason']
      : input.entity === 'materials' ? ['type', 'brand', 'color', 'diameter', 'density', 'unit', 'unit_price', 'unitPrice', 'notes', 'code', 'name'] : ['name', 'description', 'source']);
    for (const [key, value] of Object.entries(input.changes)) {
      const field = key === 'unit_price' ? 'unitPrice' : key === 'due_date' ? 'dueDate' : key;
      if (Object.hasOwn(changes, field)) v.fail('同一修改字段重复');
      changes[field] = value;
    }
    return { entity: input.entity, id: v.id(input.id), changes: validators[input.entity](changes) };
  }
  const db = Object.freeze({
    searchModelsByKeyword: async (keyword, limit = 20) => (await services.models.list(boundSession, { search: keyword, limit })).items,
    searchMaterials: async (keyword, limit = 20) => (await services.materials.list(boundSession, { search: keyword, limit })).items,
    listOrders: async ({ status, from, to, limit = 50, search } = {}) => (await services.orders.list(boundSession,
      Object.fromEntries(Object.entries({ status, dateFrom: from, dateTo: to, limit, search }).filter(([, value]) => value !== undefined)))).items,
    getOrderDetail: id => services.orders.get(boundSession, id),
    inventorySummary: (query = {}) => services.inventory.summary(boundSession, query),
    async semanticSearchModels(userId, fingerprint, vector, topK = 5) {
      await identity();
      if (userId !== boundSession.actorId) v.fail('不能读取其他账号的模型索引', 'BUSINESS_FORBIDDEN', 403);
      if (typeof fingerprint !== 'string' || fingerprint.length > 500 || !Array.isArray(vector) || !vector.length || vector.length > 10000
          || vector.some(x => typeof x !== 'number' || !Number.isFinite(x)) || !Number.isInteger(topK) || topK < 1 || topK > 200) v.fail('语义检索参数无效');
      if (!semanticLookup) return { items: [], indexComplete: false };
      const matches = await semanticLookup(userId, fingerprint, vector, topK);
      const items = [];
      const seen = new Set();
      for (const match of matches.items.slice(0, topK)) {
        const id = match.id ?? match.asset_id;
        if (seen.has(id) || !Number.isFinite(match.score)) continue;
        seen.add(id);
        try { items.push({ ...await services.models.get(boundSession, id), score: match.score }); }
        catch (error) { if (error.code !== 'ENTITY_NOT_FOUND') throw error; }
      }
      return { items, indexComplete: matches.indexComplete === true };
    },
    async prepareRecordUpdate(input) {
      const payload = normalizeProposal(input);
      const who = await identity(true);
      const record = await services[payload.entity].get(boundSession, payload.id);
      const before = Object.fromEntries(Object.keys(payload.changes).map(key => [key, record[key === 'reason' ? 'statusReason' : key] ?? null]));
      const proposal = { ...payload, ...who, before, expectedVersion: record.version, proposalId: randomUUID(), expiresAt: Date.now() + 15 * 60 * 1000 };
      return { ...proposal, signature: sign(proposal) };
    },
  });
  const dataPort = createRelationalAgentDataPort({ pool, session: boundSession, jwtSecret, uploadDirectory, semanticLookup, services });
  return Object.freeze({ db, dataPort,
    async confirmRecordUpdate(input) {
      v.fields(input, ['proposal', 'confirmed', 'key'], ['proposal', 'confirmed', 'key']);
      if (input.confirmed !== true) v.fail('请先确认修改内容', 'HUMAN_CONFIRMATION_REQUIRED');
      v.fields(input.proposal, ['entity', 'id', 'changes', 'actorId', 'serverId', 'before', 'expectedVersion', 'proposalId', 'expiresAt', 'signature'],
        ['entity', 'id', 'changes', 'actorId', 'serverId', 'before', 'expectedVersion', 'proposalId', 'expiresAt', 'signature']);
      const { signature, ...unsigned } = input.proposal;
      // Clone before awaiting; the validated content is exactly the content committed.
      const serialized = stable(unsigned);
      if (serialized.length > 100000 || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)
          || !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(unsigned), 'hex'))) v.fail('修改提案已变化，请重新生成', 'PROPOSAL_INVALID');
      const proposal = JSON.parse(serialized);
      const key = input.key;
      const who = await identity(true);
      if (proposal.actorId !== who.actorId || proposal.serverId !== who.serverId) v.fail('修改提案不属于当前账号或服务器', 'PROPOSAL_INVALID');
      if (!Number.isSafeInteger(proposal.expiresAt) || proposal.expiresAt <= Date.now()) v.fail('修改提案已过期，请重新生成', 'PROPOSAL_EXPIRED');
      const normalized = normalizeProposal({ entity: proposal.entity, id: proposal.id, changes: proposal.changes });
      return execute({ ...boundSession, key, operation: 'agent.record.update', payload: { ...normalized, expectedVersion: proposal.expectedVersion } });
    },
    async confirmOrderDraft(input) {
      v.fields(input, ['confirmed', 'key', 'draft'], ['confirmed', 'key', 'draft']);
      if (input.confirmed !== true) v.fail('请先确认订单草稿', 'HUMAN_CONFIRMATION_REQUIRED');
      const draft = structuredClone(input.draft), key = input.key;
      await identity(true);
      // Human entry only; domain creation verifies explicit customerId and server pricing.
      return services.orders.execute({ ...boundSession, key, operation: 'order.create', payload: draft });
    },
  });
}
module.exports = { createAgentAdapter, createAgentRouter };

/**
 * Storage-neutral HTTP seam for Agent. Runtime factories inject the data port
 * so this router never imports the SQLite bridge or legacy conversation store.
 */
function createAgentRouter({ authenticate, createPort, port, chat, pool, requireRelational = true } = {}) {
  const express = require('express');
  const router = express.Router();
  router.use(express.json({ limit: '12mb' }));
  const fail = (message, code, status) => { throw Object.assign(new Error(message), { code, status }); };
  router.use(async (req, _res, next) => {
    try {
      const authorization = req.get('Authorization') || '';
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      const session = typeof authenticate === 'function' ? await authenticate(token) : null;
      if (!session) fail('请重新登录', 'AUTHENTICATION_REQUIRED', 401);
      if (requireRelational && pool?.query) {
        const state = (await pool.query("SELECT storage_mode FROM erp.installation WHERE id='default'")).rows[0];
        if (state?.storage_mode !== 'relational') fail('关系业务入口尚未启用', 'RELATIONAL_STORAGE_NOT_ACTIVE', 503);
      }
      req.businessSession = session;
      req.agentDataPort = typeof createPort === 'function' ? await createPort(session, req) : port;
      if (!req.agentDataPort) fail('Agent 数据接口未配置', 'AGENT_CONFIGURATION_INVALID', 500);
      next();
    } catch (error) { next(error); }
  });
  const route = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
  router.get('/conversations', route(async (_req, res) => res.json({ items: [] })));
  router.get('/entities/:entity', route(async (req, res) => res.json(await req.agentDataPort.describeEntity(req.params.entity))));
  router.get('/records/:entity', route(async (req, res) => res.json(await req.agentDataPort.list(req.params.entity, req.query))));
  router.get('/records/:entity/:id', route(async (req, res) => res.json(await req.agentDataPort.get(req.params.entity, req.params.id))));
  router.get('/search/:entity', route(async (req, res) => res.json(await req.agentDataPort.search(req.params.entity, req.query))));
  router.post('/mutations/prepare', route(async (req, res) => {
    const { action, entity } = req.body || {};
    const prepare = action === 'create' ? req.agentDataPort.prepareCreate : action === 'delete' ? req.agentDataPort.prepareDelete : req.agentDataPort.prepareUpdate;
    if (typeof prepare !== 'function') fail('不支持的修改动作', 'AGENT_MUTATION_INVALID', 400);
    const proposal = action === 'create' ? await prepare.call(req.agentDataPort, req.body)
      : action === 'delete' ? await prepare.call(req.agentDataPort, req.body)
        : await prepare.call(req.agentDataPort, req.body);
    res.status(200).json({ proposal });
  }));
  router.post('/mutations/confirm', route(async (req, res) => {
    if (typeof req.agentDataPort.confirmMutation !== 'function') fail('Agent 写入接口未配置', 'AGENT_CONFIGURATION_INVALID', 500);
    res.json(await req.agentDataPort.confirmMutation(req.body));
  }));
  router.post('/chat', route(async (req, res) => {
    if (typeof chat !== 'function') return res.status(501).json({ code: 'AGENT_PROVIDER_NOT_CONFIGURED', error: 'Agent 对话服务尚未配置' });
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders?.();
    await chat({ ...req.body, session: req.businessSession, agentDataPort: req.agentDataPort,
      onEvent: (event, data) => res.write(`event: ${event}
data: ${JSON.stringify(data)}

`) });
    res.end();
  }));
  router.use((error, _req, res, _next) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    const code = /^[A-Z_]+$/.test(error.code || '') ? error.code : 'AGENT_SERVICE_UNAVAILABLE';
    res.status(status).json({ code, error: status < 500 ? error.message : 'Agent 服务暂时不可用，请稍后重试' });
  });
  return router;
}



