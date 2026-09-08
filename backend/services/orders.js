const { nextId, appendAudit, now } = require('../utils/store');

const toNumber = (value, fallback = 0) => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeOrderItem = (item = {}, index = 0) => {
  const quantity = toNumber(item.quantity ?? item.qty, 0);
  const unitPrice = toNumber(item.unitPrice ?? item.unit_price, 0);
  return {
    id: item.id ? String(item.id) : String(index + 1),
    modelId: item.modelId || item.model_asset_id || item.modelAssetId || '',
    modelName: item.modelName || item.model_name || '',
    materialType: item.materialType || item.material_type || '',
    color: item.color || '',
    layerHeightMm: item.layerHeightMm || item.layer_height_mm || '',
    quantity,
    unitPrice,
    subtotal: toNumber(item.subtotal, quantity * unitPrice),
    externalFileUrl: item.externalFileUrl || item.external_file_url || '',
    notes: item.notes || '',
  };
};

const normalizeOrderPayload = (payload = {}, existing = null) => {
  const timestamp = now();
  const items = Array.isArray(payload.items || payload.orderItems)
    ? (payload.items || payload.orderItems).map(normalizeOrderItem)
    : existing?.items || [];
  const total = payload.total == null
    ? items.reduce((sum, item) => sum + item.subtotal, 0)
    : toNumber(payload.total, 0);
  const customer = payload.customer || {
    id: payload.customerId || existing?.customer?.id || '',
    name: payload.customerName || existing?.customer?.name || '',
    email: payload.customerEmail || existing?.customer?.email || '',
    phone: payload.customerPhone || existing?.customer?.phone || '',
  };

  return {
    ...(existing || {}),
    ...payload,
    customer,
    items,
    total,
    currency: payload.currency || existing?.currency || 'CNY',
    status: payload.status || existing?.status || 'pending_review',
    dueDate: payload.dueDate || payload.due_date || existing?.dueDate || null,
    notes: payload.notes || existing?.notes || '',
    attachments: payload.attachments || existing?.attachments || [],
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  };
};

const createOrderInData = (data, payload, { actorId, action = 'create' }) => {
  const order = normalizeOrderPayload(payload);
  order.id = nextId(data.orders);
  order.createdBy = String(actorId);
  data.orders.push(order);
  appendAudit(data, {
    actorId: String(actorId),
    entity: 'orders',
    entityId: order.id,
    action,
    diff: order,
  });
  return order;
};

module.exports = {
  createOrderInData,
  normalizeOrderItem,
  normalizeOrderPayload,
};
