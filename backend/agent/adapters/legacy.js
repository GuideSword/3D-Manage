'use strict';

const { createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const store = require('../../utils/store');
const { nextId, appendAudit, now } = store;
const { createOrderInData, normalizeOrderPayload, assertOrderCanDelete } = require('../../services/orders');
const {
  ENTITY_NAMES,
  ENTITY_DEFINITIONS,
  normalizeRecord,
  toListResponse,
} = require('../contracts/entities');
const { createAgentDataPort, PORT_ERROR } = require('../dataPort');

const COLLECTIONS = { orders: 'orders', models: 'models', materials: 'materials', inventory: 'stockLots' };
const WRITABLE_ROLES = new Set(['owner', 'staff']);
const MAX_ALL = 200;

const stable = (value) => {
  if (value === undefined) return 'null';
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!value || typeof value !== 'object') throw PORT_ERROR('PROPOSAL_INVALID', '提案内容格式无效');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};
const encodeCursor = (offset) => Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
const decodeCursor = (cursor) => {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Number.isInteger(parsed.offset) || parsed.offset < 0) throw new Error('invalid');
    return parsed.offset;
  } catch (_) {
    throw PORT_ERROR('AGENT_CURSOR_INVALID', '分页游标无效');
  }
};

const text = (value) => String(value ?? '').trim().toLowerCase();
const searchable = (entity, row) => {
  const normalized = normalizeRecord(entity, row);
  if (entity === 'orders') return [normalized.id, normalized.number, normalized.customer.name, normalized.customer.email, normalized.customer.phone, normalized.notes, normalized.status, ...normalized.items.flatMap(item => [item.modelName, item.materialType, item.color])].map(text).join(' ');
  if (entity === 'models') return [normalized.id, normalized.name, normalized.description, normalized.source, ...normalized.files.map(file => file.name), ...normalized.images.map(image => image.name)].map(text).join(' ');
  if (entity === 'materials') return [normalized.id, normalized.type, normalized.materialType, normalized.brand, normalized.color, normalized.notes].map(text).join(' ');
  return [normalized.id, normalized.materialId, normalized.lotNo, normalized.serialNo, normalized.location, normalized.state, normalized.notes].map(text).join(' ');
};

function assertWriter(actor) {
  if (!actor || !WRITABLE_ROLES.has(actor.role)) throw PORT_ERROR('BUSINESS_FORBIDDEN', '当前账号不能确认业务修改', { status: 403 });
}

function createLegacyAgentDataPort({ actor = null, signingKey = process.env.AGENT_KEY_ENC_SECRET || 'development-agent-signing-key' } = {}) {
  const sign = (proposal) => createHmac('sha256', String(signingKey)).update(stable(proposal)).digest('hex');

  const readRows = async (entity, query = {}) => store.withData((data) => {
    const collection = COLLECTIONS[entity];
    let rows = Array.isArray(data[collection]) ? data[collection].slice() : [];
    const search = text(query.search);
    if (search) rows = rows.filter(row => searchable(entity, row).includes(search));
    if (query.status && entity === 'orders') rows = rows.filter(row => String(row.status) === String(query.status));
    if (query.source && entity === 'models') rows = rows.filter(row => String(row.source) === String(query.source));
    if (query.state && entity === 'inventory') rows = rows.filter(row => String(row.state || row.status) === String(query.state));
    rows.sort((a, b) => String(b.createdAt || b.updatedAt || b.id || '').localeCompare(String(a.createdAt || a.updatedAt || a.id || '')));
    return rows;
  }, { write: false });

  const list = async (entity, query = {}) => {
    const rows = await readRows(entity, query);
    const total = rows.length;
    const start = decodeCursor(query.cursor);
    const pageLimit = query.all ? MAX_ALL : query.limit;
    const items = rows.slice(start, start + pageLimit).map(row => normalizeRecord(entity, row));
    const nextOffset = start + items.length;
    const hasMore = nextOffset < total;
    return toListResponse(items, {
      total,
      hasMore: query.all ? hasMore && nextOffset < MAX_ALL : hasMore,
      nextCursor: hasMore && (!query.all || nextOffset < MAX_ALL) ? encodeCursor(nextOffset) : null,
      truncated: query.all && hasMore && nextOffset >= MAX_ALL,
    });
  };

  const get = async (entity, id) => store.withData((data) => {
    const row = (data[COLLECTIONS[entity]] || []).find(item => String(item.id) === String(id));
    if (!row) throw PORT_ERROR('ENTITY_NOT_FOUND', '记录不存在', { status: 404 });
    return normalizeRecord(entity, row);
  }, { write: false });

  const describe = async (entity) => ({ entity, ...ENTITY_DEFINITIONS[entity] });
  const search = (entity, query) => list(entity, { ...query, search: query.query || query.search });

  const prepare = async (action, entity, id, payload, actorForProposal) => {
    assertWriter(actorForProposal);
    const current = id == null ? null : await get(entity, id);
    if (action !== 'create' && !current) throw PORT_ERROR('ENTITY_NOT_FOUND', '记录不存在', { status: 404 });
    const proposal = {
      entity, action, id: id == null ? null : String(id), changes: payload || {},
      before: current, expectedVersion: current?.version ?? current?.updatedAt ?? null,
      actorId: String(actorForProposal.id), serverId: String(actorForProposal.serverId || 'legacy'),
      proposalId: randomUUID(), expiresAt: Date.now() + 15 * 60 * 1000,
    };
    return { ...proposal, signature: sign(proposal) };
  };

  const prepareCreate = (entity, payload, actorForProposal) => prepare('create', entity, null, payload, actorForProposal);
  const prepareUpdate = (entity, id, changes, actorForProposal) => prepare('update', entity, id, changes, actorForProposal);
  const prepareDelete = (entity, id, actorForProposal) => prepare('delete', entity, id, {}, actorForProposal);

  const confirmMutation = async (proposalInput, actorForConfirm, key) => {
    assertWriter(actorForConfirm);
    if (!proposalInput || proposalInput.signature == null || proposalInput.expiresAt <= Date.now()) throw PORT_ERROR('PROPOSAL_EXPIRED', '修改提案已过期，请重新生成', { status: 409 });
    const { signature, ...unsigned } = proposalInput;
    const expected = sign(unsigned);
    if (typeof signature !== 'string' || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw PORT_ERROR('PROPOSAL_INVALID', '修改提案已变化，请重新生成', { status: 409 });
    if (String(unsigned.actorId) !== String(actorForConfirm.id)) throw PORT_ERROR('PROPOSAL_INVALID', '修改提案不属于当前账号', { status: 403 });

    return store.withData(async (data) => {
      const collection = COLLECTIONS[unsigned.entity];
      const rows = data[collection];
      if (!Array.isArray(rows)) throw PORT_ERROR('AGENT_ENTITY_INVALID', '不支持的业务实体');
      const index = unsigned.id == null ? -1 : rows.findIndex(item => String(item.id) === String(unsigned.id));
      if (unsigned.action !== 'create' && index < 0) throw PORT_ERROR('ENTITY_NOT_FOUND', '记录不存在', { status: 404 });
      if (unsigned.action === 'create') {
        let created;
        if (unsigned.entity === 'orders') created = createOrderInData(data, unsigned.changes, { actorId: actorForConfirm.id, action: 'agent.create' });
        else {
          created = { ...unsigned.changes, id: nextId(rows), createdAt: now(), updatedAt: now() };
          rows.push(created);
          appendAudit(data, { actorId: String(actorForConfirm.id), entity: collection, entityId: created.id, action: 'agent.create', diff: created });
        }
        return normalizeRecord(unsigned.entity, created);
      }
      const current = rows[index];
      const currentVersion = current.version ?? current.updatedAt ?? null;
      if (unsigned.expectedVersion != null && String(currentVersion) !== String(unsigned.expectedVersion)) throw PORT_ERROR('VERSION_CONFLICT', '记录已被其他人修改，请重新读取', { status: 409 });
      if (unsigned.action === 'delete') {
        if (unsigned.entity === 'orders') assertOrderCanDelete(data, current.id);
        if (unsigned.entity === 'materials' && (data.stockLots || []).some(lot => String(lot.materialId || lot.material_id) === String(current.id))) throw PORT_ERROR('MATERIAL_REFERENCED', '耗材有关联批次或库存流水，不能删除', { status: 409 });
        rows.splice(index, 1);
        appendAudit(data, { actorId: String(actorForConfirm.id), entity: collection, entityId: current.id, action: 'agent.delete', diff: current });
        return { id: String(current.id), deleted: true };
      }
      const next = unsigned.entity === 'orders'
        ? normalizeOrderPayload(unsigned.changes, current)
        : { ...current, ...unsigned.changes, id: current.id, updatedAt: now() };
      rows[index] = next;
      appendAudit(data, { actorId: String(actorForConfirm.id), entity: collection, entityId: current.id, action: 'agent.update', diff: { before: current, after: next, key } });
      return normalizeRecord(unsigned.entity, next);
    });
  };

  return createAgentDataPort({ list, get, describe, search, prepareCreate, prepareUpdate, prepareDelete, confirmMutation });
}

module.exports = { createLegacyAgentDataPort, encodeCursor, decodeCursor };
