// Bridge between tools and the actual data layer.
// Tools receive `ctx.db` which exposes the methods defined here.
//
// The implementation reads from backend/data/store.json for orders/models/etc.
// and from backend/db/agent.js (SQLite) for embeddings.

const { withData } = require('../utils/store');
const sqliteDb = require('../db/agent');
const { prepareRecordUpdate } = require('./recordUpdates');

async function searchModelsByKeyword(keyword, limit = 20) {
  if (!keyword) return [];
  const kw = String(keyword).toLowerCase();
  const data = await withData((d) => d, { write: false });
  const matches = (data.models || []).filter((m) => {
    const name = (m.name || '').toLowerCase();
    const tags = Array.isArray(m.tags) ? m.tags.join(' ').toLowerCase() : '';
    const desc = (m.description || '').toLowerCase();
    return name.includes(kw) || tags.includes(kw) || desc.includes(kw);
  });
  return matches.slice(0, limit).map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description || '',
    tags: m.tags || [],
    current_version: m.currentVersion || m.current_version,
    visibility: m.visibility,
    created_at: m.createdAt || m.created_at,
  }));
}

async function semanticSearchModels(userId, configFingerprint, queryVector, topK = 5) {
  const all = sqliteDb.getAllModelEmbeddings(userId, configFingerprint);
  const indexState = sqliteDb.getModelIndexState(userId, configFingerprint);
  if (all.length === 0) {
    return { items: [], indexComplete: indexState?.status === 'ready' };
  }
  const scored = all.map((row) => ({
    asset_id: row.asset_id,
    source_text: row.source_text,
    score: row.vector_dim === queryVector.length ? cosine(queryVector, row.embedding) : -1,
  })).filter((row) => row.score >= 0);
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);
  // Hydrate with model data
  const data = await withData((d) => d, { write: false });
  const modelById = new Map((data.models || []).map((m) => [String(m.id), m]));
  const items = top.map((row) => {
    const m = modelById.get(String(row.asset_id)) || {};
    return {
      id: row.asset_id,
      name: m.name || '(unknown)',
      description: m.description || '',
      current_version: m.currentVersion || m.current_version,
      score: row.score,
    };
  });
  return { items, indexComplete: indexState?.status === 'ready' };
}

async function listOrders({ status, from, to, limit = 50, search } = {}) {
  const data = await withData((d) => d, { write: false });
  let results = data.orders || [];
  if (status) results = results.filter((o) => o.status === status);
  if (search) {
    const query = String(search).toLowerCase();
    results = results.filter((o) => [o.id, o.customer?.name, o.customerName, o.notes]
      .some((value) => String(value || '').toLowerCase().includes(query)));
  }
  if (from) {
    const fromTs = new Date(from).getTime();
    results = results.filter((o) => new Date(o.createdAt || 0).getTime() >= fromTs);
  }
  if (to) {
    const toTs = new Date(to).getTime();
    results = results.filter((o) => new Date(o.createdAt || 0).getTime() <= toTs);
  }
  results.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return results.slice(0, limit).map((o) => {
    const customer = (data.customers || []).find((c) => String(c.id) === String(o.customerId || o.customer_id)) || {};
    return {
      id: o.id,
      customerName: o.customer?.name || customer.name || o.customerName || '',
      status: o.status,
      total: o.total,
      currency: o.currency || 'CNY',
      dueDate: o.dueDate || o.due_date,
      createdAt: o.createdAt || o.created_at,
    };
  });
}

async function getOrderDetail(orderId) {
  const data = await withData((d) => d, { write: false });
  const order = (data.orders || []).find((o) => String(o.id) === String(orderId));
  if (!order) return null;
  const customer = (data.customers || []).find((c) => String(c.id) === String(order.customerId || order.customer_id)) || {};
  return {
    id: order.id,
    customer: {
      name: order.customer?.name || customer.name || order.customerName || '',
      email: order.customer?.email || customer.email || order.customerEmail || '',
      phone: order.customer?.phone || customer.phone || order.customerPhone || '',
    },
    status: order.status,
    items: order.items || [],
    total: order.total,
    currency: order.currency || 'CNY',
    dueDate: order.dueDate || order.due_date,
    notes: order.notes || '',
    createdAt: order.createdAt || order.created_at,
    updatedAt: order.updatedAt || order.updated_at,
  };
}

async function searchMaterials(keyword, limit = 20) {
  const data = await withData((d) => d, { write: false });
  const query = String(keyword || '').toLowerCase();
  return (data.materials || []).filter((row) => [row.id, row.type, row.brand, row.color]
    .some((value) => String(value || '').toLowerCase().includes(query)))
    .slice(0, limit).map((row) => ({
      id: row.id, type: row.type, brand: row.brand, color: row.color,
      diameter: row.diameter, density: row.density, unitPrice: row.unitPrice,
      unit: row.unit, notes: row.notes,
    }));
}

const { inventorySummary } = require('../services/inventory');

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

module.exports = {
  searchModelsByKeyword,
  semanticSearchModels,
  listOrders,
  getOrderDetail,
  inventorySummary,
  prepareRecordUpdate,
  searchMaterials,
};
