// Bridge between tools and the actual data layer.
// Tools receive `ctx.db` which exposes the methods defined here.
//
// The implementation reads from backend/data/store.json for orders/models/etc.
// and from backend/db/agent.js (SQLite) for embeddings.

const { withData } = require('../utils/store');
const sqliteDb = require('../db/agent');

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

async function semanticSearchModels(queryVector, topK = 5) {
  const all = sqliteDb.getAllModelEmbeddings();
  if (all.length === 0) return [];
  const scored = all.map((row) => ({
    asset_id: row.asset_id,
    source_text: row.source_text,
    score: cosine(queryVector, row.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);
  // Hydrate with model data
  const data = await withData((d) => d, { write: false });
  const modelById = new Map((data.models || []).map((m) => [String(m.id), m]));
  return top.map((row) => {
    const m = modelById.get(String(row.asset_id)) || {};
    return {
      id: row.asset_id,
      name: m.name || '(unknown)',
      description: m.description || '',
      current_version: m.currentVersion || m.current_version,
      score: row.score,
    };
  });
}

async function listOrders({ status, from, to, limit = 50 } = {}) {
  const data = await withData((d) => d, { write: false });
  let results = data.orders || [];
  if (status) results = results.filter((o) => o.status === status);
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
      customerName: customer.name || o.customerName || '',
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
      name: customer.name || '',
      email: customer.email || '',
      phone: customer.phone || '',
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

async function inventorySummary({ material_type, low_stock_only = false } = {}) {
  const data = await withData((d) => d, { write: false });
  const materials = data.materials || [];
  const lots = data.stockLots || [];
  // group lots by material_id
  const byMat = new Map();
  for (const lot of lots) {
    if (lot.state === 'scrap' || lot.state === 'frozen') continue;
    const key = String(lot.materialId || lot.material_id);
    if (!byMat.has(key)) byMat.set(key, []);
    byMat.get(key).push(lot);
  }
  const out = [];
  for (const m of materials) {
    if (material_type && m.type !== material_type) continue;
    const matLots = byMat.get(String(m.id)) || [];
    const totalQty = matLots.reduce((s, l) => s + Number(l.qty_g || l.qty || 0), 0);
    const lowStock = totalQty < 100; // simple threshold
    if (low_stock_only && !lowStock) continue;
    out.push({
      materialId: m.id,
      materialName: `${m.type || ''} ${m.brand || ''} ${m.color || ''}`.trim() || m.name || String(m.id),
      type: m.type,
      brand: m.brand,
      color: m.color,
      totalQty,
      lotCount: matLots.length,
      lowStock,
    });
  }
  return out;
}

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
};
