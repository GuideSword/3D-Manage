'use strict';

const { ENTITY_NAMES } = require('./contracts/entities');

const PORT_ERROR = (code, message, details = {}) => Object.assign(new Error(message), { code, status: details.status || 400, details });

function assertEntity(entity) {
  if (!ENTITY_NAMES.includes(entity)) throw PORT_ERROR('AGENT_ENTITY_INVALID', '不支持的业务实体');
}

function normalizePageQuery(query = {}) {
  const limit = Number(query.limit ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw PORT_ERROR('AGENT_PAGE_INVALID', '分页数量必须是 1 到 200 的整数');
  if (query.cursor != null && (typeof query.cursor !== 'string' || query.cursor.length > 512)) throw PORT_ERROR('AGENT_CURSOR_INVALID', '分页游标无效');
  return { ...query, limit, all: query.all === true };
}

function createAgentDataPort({ list, get, describe, search, prepareCreate, prepareUpdate, prepareDelete, confirmMutation } = {}) {
  const port = { list, get, describe, search, prepareCreate, prepareUpdate, prepareDelete, confirmMutation };
  for (const [name, fn] of Object.entries(port)) {
    if (typeof fn !== 'function') throw new TypeError(`AgentDataPort.${name} must be a function`);
  }
  return Object.freeze({
    async list(entity, query) { assertEntity(entity); return list(entity, normalizePageQuery(query)); },
    async get(entity, id) { assertEntity(entity); return get(entity, id); },
    async describe(entity) { assertEntity(entity); return describe(entity); },
    async search(entity, query) { assertEntity(entity); return search(entity, normalizePageQuery(query)); },
    async prepareCreate(entity, payload, actor) { assertEntity(entity); return prepareCreate(entity, payload, actor); },
    async prepareUpdate(entity, id, changes, actor) { assertEntity(entity); return prepareUpdate(entity, id, changes, actor); },
    async prepareDelete(entity, id, actor) { assertEntity(entity); return prepareDelete(entity, id, actor); },
    async confirmMutation(proposal, actor, key) { return confirmMutation(proposal, actor, key); },
  });
}

module.exports = { PORT_ERROR, assertEntity, normalizePageQuery, createAgentDataPort };
