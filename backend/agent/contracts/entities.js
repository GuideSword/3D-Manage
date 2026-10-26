'use strict';

const ENTITY_NAMES = ['orders', 'models', 'materials', 'inventory'];

const asString = (value, fallback = '') => {
  if (value == null) return fallback;
  return String(value).trim();
};

const finiteNumber = (value, fallback = 0) => {
  if (value === '' || value == null) return fallback;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const firstPresent = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const normalizeOrderItem = (item = {}, index = 0) => {
  const quantity = finiteNumber(firstPresent(item.quantity, item.qty), 0);
  const unitPrice = finiteNumber(firstPresent(item.unitPrice, item.unit_price), 0);
  const modelId = firstPresent(item.modelId, item.model_id, item.modelAssetId, item.model_asset_id, '') ?? '';
  const materialType = firstPresent(item.materialType, item.material_type, '') ?? '';
  const layerHeight = firstPresent(item.layerHeightMm, item.layer_height_mm, '');
  return {
    ...item,
    id: asString(item.id, String(index + 1)),
    modelId: asString(modelId),
    modelName: asString(firstPresent(item.modelName, item.model_name, '')),
    materialType: asString(materialType),
    color: asString(item.color),
    layerHeightMm: layerHeight === '' ? '' : finiteNumber(layerHeight, layerHeight),
    quantity,
    unitPrice,
    subtotal: quantity * unitPrice,
    externalFileUrl: asString(firstPresent(item.externalFileUrl, item.external_file_url, '')),
    notes: asString(item.notes),
  };
};

const normalizeCustomer = (order = {}) => {
  const nested = order.customer && typeof order.customer === 'object' ? order.customer : {};
  const snapshot = order.customerSnapshot && typeof order.customerSnapshot === 'object' ? order.customerSnapshot : {};
  const name = firstPresent(
    nested.name,
    order.customerName,
    order.customer_name,
    snapshot.name,
  );
  return {
    ...nested,
    id: asString(firstPresent(nested.id, order.customerId, order.customer_id, snapshot.id, '')),
    name: asString(name),
    email: asString(firstPresent(nested.email, order.customerEmail, order.customer_email, snapshot.email, '')),
    phone: asString(firstPresent(nested.phone, order.customerPhone, order.customer_phone, snapshot.phone, '')),
  };
};

const normalizeOrder = (record = {}) => {
  record = record && typeof record === 'object' ? record : {};
  const sourceItems = Array.isArray(record.items)
    ? record.items
    : Array.isArray(record.orderItems)
      ? record.orderItems
      : [];
  const items = sourceItems.map(normalizeOrderItem);
  const totalValue = firstPresent(record.total, record.totalAmount);
  const total = totalValue === undefined ? items.reduce((sum, item) => sum + item.subtotal, 0) : finiteNumber(totalValue, 0);
  return {
    ...record,
    id: asString(record.id),
    customer: normalizeCustomer(record),
    items,
    total,
    currency: asString(firstPresent(record.currency, 'CNY')) || 'CNY',
    status: asString(firstPresent(record.status, 'pending_review')) || 'pending_review',
    dueDate: firstPresent(record.dueDate, record.due_date, null) || null,
    notes: asString(record.notes),
    attachments: Array.isArray(record.attachments) ? record.attachments : [],
    createdAt: firstPresent(record.createdAt, record.created_at, null),
    updatedAt: firstPresent(record.updatedAt, record.updated_at, null),
  };
};

const normalizeModel = (record = {}) => {
  record = record && typeof record === 'object' ? record : {};
  return ({
  ...record,
  id: asString(record.id),
  name: asString(record.name),
  description: asString(record.description),
  source: asString(record.source, 'original') || 'original',
  files: Array.isArray(record.files) ? record.files : [],
  images: Array.isArray(record.images) ? record.images : [],
  createdAt: firstPresent(record.createdAt, record.created_at, null),
  updatedAt: firstPresent(record.updatedAt, record.updated_at, null),
  });
};

const normalizeMaterial = (record = {}) => {
  record = record && typeof record === 'object' ? record : {};
  const materialType = asString(firstPresent(record.materialType, record.material_type, record.type, ''));
  return {
    ...record,
    id: asString(record.id),
    type: asString(firstPresent(record.type, materialType, '')),
    materialType,
    brand: asString(record.brand),
    diameter: finiteNumber(firstPresent(record.diameter, record.diameter_mm), 1.75),
    color: asString(record.color),
    density: record.density == null || record.density === '' ? null : finiteNumber(record.density, null),
    unitPrice: record.unitPrice == null && record.unit_price == null ? null : finiteNumber(firstPresent(record.unitPrice, record.unit_price), null),
    unit: asString(firstPresent(record.unit, 'kg')) || 'kg',
    notes: asString(record.notes),
    createdAt: firstPresent(record.createdAt, record.created_at, null),
    updatedAt: firstPresent(record.updatedAt, record.updated_at, null),
  };
};

const preserveQuantity = (value) => {
  if (value == null || value === '') return 0;
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return Number.isSafeInteger(number) || Number.isFinite(number) ? number : String(value);
};

const normalizeInventoryLot = (record = {}) => {
  record = record && typeof record === 'object' ? record : {};
  return ({
  ...record,
  id: asString(record.id),
  materialId: asString(firstPresent(record.materialId, record.material_id, '')),
  lotNo: asString(firstPresent(record.lotNo, record.lot_no, '')),
  serialNo: asString(firstPresent(record.serialNo, record.serial_no, '')),
  location: asString(record.location),
  qty: preserveQuantity(firstPresent(record.qty, record.qty_g, 0)),
  qtyMg: firstPresent(record.qtyMg, record.qty_mg, null),
  state: asString(firstPresent(record.state, record.status, 'in_stock')) || 'in_stock',
  active: record.active !== false,
  balanceStatus: asString(record.balanceStatus || record.balance_status),
  notes: asString(record.notes),
  createdAt: firstPresent(record.createdAt, record.created_at, null),
  updatedAt: firstPresent(record.updatedAt, record.updated_at, null),
  });
};

const ENTITY_DEFINITIONS = {
  orders: {
    label: '订单',
    idField: 'id',
    fields: {
      id: { type: 'string', readonly: true }, customer: { type: 'object' }, items: { type: 'array' },
      status: { type: 'string' }, total: { type: 'number' }, currency: { type: 'string' }, dueDate: { type: 'string', nullable: true }, notes: { type: 'string' },
    },
  },
  models: {
    label: '模型', idField: 'id', fields: { id: { type: 'string', readonly: true }, name: { type: 'string', required: true }, description: { type: 'string' }, source: { type: 'string' }, files: { type: 'array' }, images: { type: 'array' } },
  },
  materials: {
    label: '耗材', idField: 'id', fields: { id: { type: 'string', readonly: true }, type: { type: 'string' }, materialType: { type: 'string' }, brand: { type: 'string' }, diameter: { type: 'number' }, color: { type: 'string' }, density: { type: 'number', nullable: true }, unitPrice: { type: 'number', nullable: true }, unit: { type: 'string' }, notes: { type: 'string' } },
  },
  inventory: {
    label: '库存批次', idField: 'id', fields: { id: { type: 'string', readonly: true }, materialId: { type: 'string', required: true }, lotNo: { type: 'string' }, serialNo: { type: 'string' }, location: { type: 'string' }, qty: { type: 'number' }, qtyMg: { type: 'string', nullable: true }, state: { type: 'string' }, active: { type: 'boolean' }, notes: { type: 'string' } },
  },
};

const normalizeRecord = (entity, record) => {
  if (!ENTITY_NAMES.includes(entity)) throw new Error(`Unknown agent entity: ${entity}`);
  if (entity === 'orders') return normalizeOrder(record);
  if (entity === 'models') return normalizeModel(record);
  if (entity === 'materials') return normalizeMaterial(record);
  return normalizeInventoryLot(record);
};

const toListResponse = (items = [], options = {}) => {
  const list = Array.isArray(items) ? items : [];
  const total = Number.isFinite(Number(options.total)) ? Number(options.total) : list.length;
  const returned = list.length;
  const offset = Number.isFinite(Number(options.offset)) && Number(options.offset) >= 0 ? Number(options.offset) : 0;
  const hasMore = options.hasMore == null ? (options.nextCursor != null || offset + returned < total) : Boolean(options.hasMore);
  return {
    items: list,
    total,
    returned,
    hasMore,
    nextCursor: options.nextCursor == null ? null : String(options.nextCursor),
    truncated: Boolean(options.truncated),
  };
};

module.exports = {
  ENTITY_NAMES,
  ENTITY_DEFINITIONS,
  normalizeOrder,
  normalizeModel,
  normalizeMaterial,
  normalizeInventoryLot,
  normalizeRecord,
  toListResponse,
  normalizeOrderItem,
};





