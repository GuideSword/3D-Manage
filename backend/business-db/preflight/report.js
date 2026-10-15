'use strict';
const { multiplyToCents, sumCents } = require('../decimal');
const { exactText, scaled, identifier, integer } = require('./values');
const { inspectInventory } = require('./inventory');
const { auditFileReferences } = require('./files');
const { assertSourceHash, sha256 } = require('./source');
const COLLECTIONS = ['users', 'orders', 'models', 'materials', 'stockLots', 'inventoryTxns', 'auditLogs', 'objectUploads', 'commandReceipts'];

async function buildPreflightReport(source, { uploadDirectory } = {}) {
  assertSourceHash(source, source.sha256);
  const report = { reportVersion: 1, sourceSha256: source.sha256, serverId: source.data.system?.serverId || null,
    schemaVersion: source.data.schemaVersion || '1', counts: {}, versionDefaults: {}, issues: [], orders: [], stockLots: [], files: [], customerMappings: [] };
  const add = (severity, code, collection, entityId, field) => report.issues.push({ severity, code, collection,
    ...(identifier(entityId) ? { entityId } : {}), ...(field ? { field } : {}) });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(report.serverId || '')) add('blocker', 'SERVER_ID_INVALID', 'system');
  if (!['1', '2', '3'].includes(report.schemaVersion)) add('blocker', 'SOURCE_SCHEMA_UNSUPPORTED', 'system', null, 'schemaVersion');
  if (report.schemaVersion !== '3') add('review', 'LEGACY_SCHEMA_REVIEW', 'system', null, 'schemaVersion');
  const data = {};
  for (const name of COLLECTIONS) {
    const rows = source.data[name];
    report.counts[name] = Array.isArray(rows) ? rows.length : 0;
    if (!Array.isArray(rows)) add('blocker', 'COLLECTION_INVALID', name);
    data[name] = (Array.isArray(rows) ? rows : []).filter((row, index) => {
      if (row && typeof row === 'object' && !Array.isArray(row)) return true;
      add('blocker', 'RECORD_INVALID', name, null, String(index)); return false;
    });
    const ids = new Set();
    for (const row of data[name]) {
      if (!identifier(row.id)) add('blocker', 'ID_MISSING', name);
      else if (ids.has(row.id)) add('blocker', 'DUPLICATE_ID', name, row.id);
      ids.add(row.id);
      if (['users', 'orders', 'models', 'materials', 'stockLots'].includes(name)) {
        if (row.version === undefined) report.versionDefaults[name] = (report.versionDefaults[name] || 0) + 1;
        else {
          try { if (integer(row.version) < 1n) throw Error('Invalid version'); }
          catch (_) { add('blocker', 'RECORD_VERSION_INVALID', name, row.id, 'version'); }
        }
      }
    }
  }
  for (const [name, value] of Object.entries(source.data)) {
    if (Array.isArray(value) && !COLLECTIONS.includes(name) && value.length) add('blocker', 'UNMAPPED_COLLECTION', name);
  }
  const emails = new Set();
  for (const user of data.users) {
    const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
    if (!email || emails.has(email)) add('blocker', 'USER_EMAIL_INVALID_OR_DUPLICATE', 'users', user.id, 'email');
    emails.add(email);
    if (!['owner', 'staff', 'viewer'].includes(user.role)) add('blocker', 'USER_ROLE_INVALID', 'users', user.id, 'role');
    if (typeof user.passwordHash !== 'string' || !user.passwordHash) add('blocker', 'USER_PASSWORD_HASH_MISSING', 'users', user.id, 'passwordHash');
    try { if (integer(user.tokenVersion) < 1n) throw Error('Invalid token version'); }
    catch (_) { add('blocker', 'USER_TOKEN_VERSION_INVALID', 'users', user.id, 'tokenVersion'); }
  }
  if (!data.users.some(user => user.role === 'owner' && user.active !== false)) add('blocker', 'ACTIVE_OWNER_MISSING', 'users');
  const userIds = new Set(data.users.map(row => row.id));
  const modelIds = new Set(data.models.map(row => row.id));
  for (const material of data.materials) if (material.unitPrice != null) {
    try { scaled(material.unitPrice, 6, 14); }
    catch (_) { add('blocker', 'MATERIAL_PRICE_INVALID', 'materials', material.id, 'unitPrice'); }
  }
  for (const audit of data.auditLogs) if (audit.actorId && !userIds.has(audit.actorId)) add('review', 'AUDIT_ACTOR_SNAPSHOT_REVIEW', 'auditLogs', audit.id, 'actorId');
  const customerGroups = new Map();
  const fileReferences = [];
  const addFiles = (records, collection, id, field) => {
    if (!Array.isArray(records)) { add('blocker', 'FILE_LIST_INVALID', collection, id, field); return; }
    for (const [index, file] of records.entries()) {
      if (!file || typeof file !== 'object' || Array.isArray(file)) { add('blocker', 'FILE_RECORD_INVALID', collection, id, field); continue; }
      fileReferences.push({ ...file, collection, entityId: id, field: `${field}.${index}` });
    }
  };
  for (const model of data.models) {
    addFiles(model.files || [], 'models', model.id, 'files');
    addFiles(model.images || [], 'models', model.id, 'images');
  }
  for (const order of data.orders) {
    const itemReport = { id: order.id, currency: order.currency || null, storedTotal: order.total ?? null, calculatedTotal: null, lines: [] };
    if (!['draft', 'pending_review', 'in_progress', 'completed', 'cancelled'].includes(order.status)) add('blocker', 'ORDER_STATUS_INVALID', 'orders', order.id, 'status');
    if (order.currency !== 'CNY') add('blocker', 'ORDER_CURRENCY_UNSUPPORTED', 'orders', order.id, 'currency');
    if (!userIds.has(order.createdBy)) add('blocker', 'ORDER_CREATOR_MISSING', 'orders', order.id, 'createdBy');
    const amounts = [];
    const ids = new Set();
    const items = order.items || order.orderItems;
    if (!Array.isArray(items) || !items.length) add('blocker', 'ORDER_LINES_MISSING', 'orders', order.id, 'items');
    for (const [index, line] of (Array.isArray(items) ? items : []).entries()) {
      if (!line || typeof line !== 'object' || Array.isArray(line)) { add('blocker', 'ORDER_LINE_INVALID', 'orders', order.id, `items.${index}`); continue; }
      const result = { id: line.id || null, quantity: line.quantity ?? line.qty ?? null, unitPrice: line.unitPrice ?? line.unit_price ?? null,
        storedSubtotal: line.subtotal ?? null, calculatedSubtotal: null };
      if (!identifier(line.id) || ids.has(line.id)) add('blocker', 'ORDER_LINE_ID_INVALID', 'orders', order.id, `items.${index}.id`);
      ids.add(line.id);
      const modelId = line.modelId || line.model_asset_id || line.modelAssetId;
      if (modelId && !modelIds.has(modelId)) add('review', 'ORDER_MODEL_SNAPSHOT_REVIEW', 'orders', order.id, `items.${index}.modelId`);
      try {
        if (scaled(result.quantity, 3, 15) === 0n) throw Error('Quantity must be positive');
        result.calculatedSubtotal = multiplyToCents(exactText(result.quantity), exactText(result.unitPrice));
        amounts.push(result.calculatedSubtotal);
      } catch (_) { add('blocker', 'ORDER_LINE_INVALID', 'orders', order.id, `items.${index}`); }
      try {
        const stored = scaled(line.subtotal, 2, 18);
        if (result.calculatedSubtotal !== null && stored !== scaled(result.calculatedSubtotal, 2, 18)) add('blocker', 'ORDER_LINE_SUBTOTAL_MISMATCH', 'orders', order.id, `items.${index}.subtotal`);
      } catch (_) { add('blocker', 'ORDER_LINE_AMOUNT_INVALID', 'orders', order.id, `items.${index}.subtotal`); }
      itemReport.lines.push(result);
    }
    try {
      const stored = scaled(order.total, 2, 18);
      if (Array.isArray(items) && items.length && amounts.length === items.length) {
        itemReport.calculatedTotal = sumCents(amounts);
        if (stored !== scaled(itemReport.calculatedTotal, 2, 18)) add('blocker', 'ORDER_TOTAL_MISMATCH', 'orders', order.id, 'total');
      }
    } catch (_) { add('blocker', 'ORDER_TOTAL_INVALID', 'orders', order.id, 'total'); }
    const customer = order.customer;
    if (!customer || typeof customer !== 'object' || Array.isArray(customer) || !String(customer.name || '').trim()) {
      add('review', 'CUSTOMER_DETAILS_REVIEW', 'orders', order.id, 'customer');
    }
    report.customerMappings.push({ orderId: order.id, sourceCustomerId: identifier(customer?.id),
      targetKey: `customer-${sha256(JSON.stringify([source.sha256, order.id])).slice(0, 32)}`,
      action: 'create_separate_customer', requiresConfirmation: true });
    add('review', 'CUSTOMER_MAPPING_REVIEW', 'orders', order.id, 'customer');
    const name = typeof customer?.name === 'string' ? customer.name.normalize('NFKC').trim().toLowerCase() : '';
    for (const key of [name ? `name:${name}` : '', customer?.id ? `id:${customer.id}` : ''].filter(Boolean)) {
      const grouped = customerGroups.get(key) || []; grouped.push(order.id); customerGroups.set(key, grouped);
    }
    addFiles(order.attachments || [], 'orders', order.id, 'attachments');
    report.orders.push(itemReport);
  }
  const matches = new Set();
  for (const ids of customerGroups.values()) if (ids.length > 1) for (const id of ids) matches.add(id);
  for (const id of matches) add('review', 'CUSTOMER_MATCH_REVIEW', 'orders', id, 'customer');
  report.stockLots = inspectInventory(data, add);
  for (const lot of data.stockLots) if (lot.photoKey || lot.photo_key) fileReferences.push({ fileKey: lot.photoKey || lot.photo_key, collection: 'stockLots', entityId: lot.id, field: 'photoKey' });
  for (const upload of data.objectUploads) if (upload.fileKey || upload.file_key) fileReferences.push({ ...upload, collection: 'objectUploads', entityId: upload.id, field: 'fileKey' });
  const receipts = new Set();
  for (const receipt of data.commandReceipts) {
    const key = JSON.stringify([receipt.actorId, receipt.key]);
    if (!identifier(receipt.key) || !identifier(receipt.actorId) || receipts.has(key) || !/^[a-f0-9]{64}$/i.test(receipt.digest || '')) add('blocker', 'RECEIPT_INVALID_OR_DUPLICATE', 'commandReceipts', receipt.id);
    receipts.add(key);
  }
  report.files = await auditFileReferences(fileReferences, uploadDirectory, add);
  report.blockerCount = report.issues.filter(issue => issue.severity === 'blocker').length;
  report.reviewCount = report.issues.filter(issue => issue.severity === 'review').length;
  report.status = report.blockerCount ? 'blocked' : report.reviewCount ? 'review_required' : 'ready';
  return report;
}
module.exports = { buildPreflightReport };
