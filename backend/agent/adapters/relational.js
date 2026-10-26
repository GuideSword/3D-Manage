'use strict';

const { createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const { createRelationalServices } = require('../../modules/adapters/services');
const v = require('../../modules/catalog/validation');

let contractNormalizeRecord;
let contractToListResponse;
let contractDefinitions;
try {
  ({ normalizeRecord: contractNormalizeRecord, toListResponse: contractToListResponse, ENTITY_DEFINITIONS: contractDefinitions } = require('../contracts/entities'));
} catch (_) { /* The adapter remains loadable while the contracts package is being migrated. */ }

const ENTITY_ALIASES = Object.freeze({ orders: 'orders', models: 'models', materials: 'materials', inventory: 'inventory', stockLots: 'inventory', lots: 'inventory' });
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
function stable(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!isObject(value)) throw Object.assign(new Error('提案内容格式无效'), { code: 'PROPOSAL_INVALID', status: 400 });
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function normalize(entity, value) {
  if (typeof contractNormalizeRecord !== 'function') {
    if (entity === 'orders' && value && typeof value === 'object') {
      const customer = value.customer && typeof value.customer === 'object' ? value.customer : {};
      const name = customer.name || value.customerName || value.customer_name || value.customerSnapshot?.name || '';
      const items = (Array.isArray(value.items) ? value.items : []).map((item, index) => ({ ...item, id: item.id || String(index + 1), quantity: Number(item.quantity ?? item.qty ?? 0), unitPrice: Number(item.unitPrice ?? item.unit_price ?? 0) }));
      return { ...value, customer: { ...customer, name }, items };
    }
    return value;
  }
  try { return contractNormalizeRecord(entity, value); } catch (_) { return value; }
}
function response(items, total, query = {}, truncated = false) {
  const offset = Number.isSafeInteger(query.offset) && query.offset > 0 ? query.offset : 0;
  const pageSize = Number.isSafeInteger(query.limit) && query.limit > 0 ? query.limit : items.length || 100;
  const hasMore = offset + items.length < total;
  const base = { items, total, returned: items.length, hasMore, nextCursor: hasMore ? Buffer.from(JSON.stringify({ offset: offset + items.length })).toString('base64url') : null, truncated: Boolean(truncated) };
  if (typeof contractToListResponse === 'function') {
    try {
      const candidate = contractToListResponse(items, { total, offset, limit: pageSize, hasMore, nextCursor: base.nextCursor, truncated });
      if (candidate && Array.isArray(candidate.items)) return { ...base, ...candidate, items: candidate.items.map(item => normalize(query.entity, item)) };
    } catch (_) { /* Keep the stable local response if an older contract signature is installed. */ }
  }
  return base;
}
function decodeCursor(cursor) {
  if (cursor === undefined || cursor === null || cursor === '') return 0;
  if (typeof cursor !== 'string' || cursor.length > 512) v.fail('分页游标无效');
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(parsed.offset) || parsed.offset < 0) throw Error();
    return parsed.offset;
  } catch (_) { v.fail('分页游标无效'); }
}
function entityName(entity) {
  if (typeof entity !== 'string' || !ENTITY_ALIASES[entity]) v.fail('不支持的业务资料类型');
  return ENTITY_ALIASES[entity];
}
function roleOf(session) { return session?.user?.role || session?.role; }

/**
 * PostgreSQL implementation of the AgentDataPort. The services argument is
 * injectable so contract tests and hosted runtimes can use a deterministic
 * service graph without importing a second storage implementation.
 */
function createRelationalAgentDataPort({ pool, session, jwtSecret, uploadDirectory, semanticLookup, services: injectedServices } = {}) {
  if (!session || typeof session.actorId !== 'string') throw Object.assign(new Error('登录凭证已失效，请重新登录'), { code: 'AUTHENTICATION_REQUIRED', status: 401 });
  const services = injectedServices || createRelationalServices(pool, { uploadDirectory });
  const signingKey = jwtSecret ? createHmac('sha256', jwtSecret).update('3d-manage:agent-proposals:v1').digest() : null;
  const serviceFor = entity => services[entity];
  const ensureWriter = () => {
    if (!['owner', 'staff'].includes(roleOf(session))) throw Object.assign(new Error('当前账号不能确认业务修改'), { code: 'BUSINESS_FORBIDDEN', status: 403 });
  };
  const sign = proposal => signingKey ? createHmac('sha256', signingKey).update(stable(proposal)).digest('hex') : null;
  const read = async (entity, query = {}) => {
    const canonical = entityName(entity);
    const service = serviceFor(canonical);
    if (!service || typeof service.list !== 'function') throw Object.assign(new Error('业务资料类型未配置'), { code: 'AGENT_ENTITY_UNAVAILABLE', status: 503 });
    const all = query.all === true;
    const requested = query.limit === undefined ? 100 : Number(query.limit);
    if (!Number.isSafeInteger(requested) || requested < 1 || requested > 200) v.fail('分页参数无效');
    let offset = query.offset === undefined ? decodeCursor(query.cursor) : Number(query.offset);
    if (!Number.isSafeInteger(offset) || offset < 0) v.fail('分页参数无效');
    const limit = all ? 200 : requested;
    const items = [];
    let total = 0;
    let truncated = false;
    const filter = { ...query, entity: canonical, limit, offset };
    delete filter.cursor; delete filter.all; delete filter.page; delete filter.pageSize;
    do {
      const page = await service.list(session, filter);
      const pageItems = Array.isArray(page?.items) ? page.items : [];
      total = Number.isSafeInteger(page?.total) ? page.total : offset + pageItems.length;
      items.push(...pageItems.map(row => normalize(canonical, row)));
      if (!all || items.length >= 200 || !pageItems.length || offset + pageItems.length >= total) break;
      offset += pageItems.length; filter.offset = offset;
    } while (items.length < 200);
    if (all && items.length >= 200 && items.length < total) truncated = true;
    return response(items.slice(0, all ? 200 : limit), total, { ...query, entity: canonical, offset: query.offset === undefined ? decodeCursor(query.cursor) : query.offset, limit }, truncated);
  };
  const port = {
    describeEntity(entity) {
      const canonical = entityName(entity);
      return { ...(contractDefinitions?.[canonical] || {}), entity: canonical, readOnly: roleOf(session) === 'viewer', fields: contractDefinitions?.[canonical]?.fields || [] };
    },
    list: read,
    search: (entity, query = {}) => read(entity, { ...query, search: query.search ?? query.query ?? '' }),
    async get(entity, id) {
      const canonical = entityName(entity), service = serviceFor(canonical);
      if (!service || typeof service.get !== 'function') throw Object.assign(new Error('业务资料类型未配置'), { code: 'AGENT_ENTITY_UNAVAILABLE', status: 503 });
      return normalize(canonical, await service.get(session, id));
    },
    async prepareCreate(entityOrInput, maybeChanges) {
      ensureWriter();
      const input = isObject(entityOrInput) ? entityOrInput : { entity: entityOrInput, changes: maybeChanges };
      const canonical = entityName(input.entity), changes = structuredClone(input.changes || {});
      const proposal = { action: 'create', entity: canonical, changes, actorId: session.actorId, serverId: input.serverId || null,
        expectedVersion: null, proposalId: randomUUID(), expiresAt: Date.now() + 15 * 60 * 1000 };
      return { ...proposal, signature: sign(proposal) };
    },
    async prepareUpdate(entityOrInput, id, changes) {
      ensureWriter();
      const input = isObject(entityOrInput) ? entityOrInput : { entity: entityOrInput, id, changes };
      const canonical = entityName(input.entity), record = await port.get(canonical, input.id);
      const proposal = { action: 'update', entity: canonical, id: input.id, changes: structuredClone(input.changes || {}), before: record,
        actorId: session.actorId, serverId: input.serverId || null, expectedVersion: record.version, proposalId: randomUUID(), expiresAt: Date.now() + 15 * 60 * 1000 };
      return { ...proposal, signature: sign(proposal) };
    },
    async prepareDelete(entityOrInput, maybeId) {
      ensureWriter();
      const input = isObject(entityOrInput) ? entityOrInput : { entity: entityOrInput, id: maybeId };
      const canonical = entityName(input.entity), record = await port.get(canonical, input.id);
      const proposal = { action: 'delete', entity: canonical, id: input.id, changes: {}, before: record,
        actorId: session.actorId, serverId: input.serverId || null, expectedVersion: record.version, proposalId: randomUUID(), expiresAt: Date.now() + 15 * 60 * 1000 };
      return { ...proposal, signature: sign(proposal) };
    },
    async confirmMutation(input = {}) {
      if (input.confirmed !== true) throw Object.assign(new Error('请先确认修改内容'), { code: 'HUMAN_CONFIRMATION_REQUIRED', status: 400 });
      ensureWriter();
      const proposal = input.proposal || input;
      if (!isObject(proposal) || proposal.actorId !== session.actorId || !Number.isSafeInteger(proposal.expiresAt) || proposal.expiresAt <= Date.now()) {
        throw Object.assign(new Error('修改提案无效或已过期'), { code: 'PROPOSAL_INVALID', status: 400 });
      }
      if (signingKey) {
        const { signature, ...unsigned } = proposal;
        if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) throw Object.assign(new Error('修改提案已变化，请重新生成'), { code: 'PROPOSAL_INVALID', status: 400 });
        const expected = sign(unsigned);
        if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) throw Object.assign(new Error('修改提案已变化，请重新生成'), { code: 'PROPOSAL_INVALID', status: 400 });
      }
      const canonical = entityName(proposal.entity), service = serviceFor(canonical);
      const operation = proposal.action === 'create' ? `${canonical === 'inventory' ? 'lot' : canonical.slice(0, -1)}.create`
        : proposal.action === 'delete' ? `${canonical === 'inventory' ? 'lot' : canonical.slice(0, -1)}.delete`
          : `${canonical === 'inventory' ? 'lot' : canonical.slice(0, -1)}.update`;
      if (!service || typeof service.execute !== 'function') throw Object.assign(new Error('业务写入服务未配置'), { code: 'AGENT_ENTITY_UNAVAILABLE', status: 503 });
      const payload = proposal.action === 'create' ? proposal.changes : proposal.action === 'delete'
        ? { id: proposal.id, version: proposal.expectedVersion } : { id: proposal.id, version: proposal.expectedVersion, changes: proposal.changes };
      const result = await service.execute({ actorId: session.actorId, tokenVersion: session.tokenVersion, key: input.key, operation, payload });
      return result?.body ?? result;
    },
  };
  return Object.freeze(port);
}

module.exports = { createRelationalAgentDataPort, ENTITY_ALIASES };
