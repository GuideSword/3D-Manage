'use strict';
const { randomUUID } = require('node:crypto');
const { parseSource, assertSourceHash } = require('../preflight/source');
const { buildPreflightReport } = require('../preflight/report');
const { exactText } = require('../preflight/values');
const { validateDecisions, decisionsHash } = require('./decisions');
const { withBusinessTransaction } = require('../transaction');

const TABLES = Object.freeze({ users: 'users', materials: 'materials', models: 'models', orders: 'orders',
  stockLots: 'stock_lots', inventoryTxns: 'inventory_txns', auditLogs: 'audit_logs',
  commandReceipts: 'command_receipts', objectUploads: 'object_uploads' });
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
const text = (value, fallback = '') => value == null ? fallback : String(value);
const nullable = value => value == null || value === '' ? null : String(value);
const referenceKey = record => {
  const explicit = nullable(record.fileKey || record.file_key || record.filePath);
  if (explicit) return explicit;
  const url = referenceUrl(record);
  return url?.startsWith('/api/files/') ? decodeURIComponent(url.slice('/api/files/'.length)) : null;
};
const referenceUrl = record => nullable(record.fileUrl || record.file_url || record.url);

// This entry point is deliberately restricted to isolated rehearsal databases.
// A production cutover requires the separate 02D maintenance/backup workflow.
async function assertRehearsalDatabase(client) {
  const { rows } = await client.query('SELECT current_database() AS name');
  if (!['erp_02a_verify', 'erp_import_rehearsal'].includes(rows[0].name)) {
    fail('ERP_IMPORT_REHEARSAL_ONLY', '当前导入器只允许隔离演练数据库');
  }
}

async function importLegacySnapshot(pool, { source: providedSource, decisions: providedDecisions, uploadDirectory } = {}) {
  if (!providedSource) fail('ERP_IMPORT_SOURCE_REQUIRED', '必须提供原始来源');
  assertSourceHash(providedSource, providedSource.sha256);
  // Ignore a caller-mutated inspection tree. Only the hash-bound raw input is authoritative.
  const source = parseSource(providedSource.raw);
  const decisionsInput = structuredClone(providedDecisions);
  const report = await buildPreflightReport(source, { uploadDirectory });
  if (report.blockerCount) fail('ERP_IMPORT_SOURCE_BLOCKED', '来源存在阻断异常，不能导入');
  const decisions = validateDecisions(report, decisionsInput);
  const decisionDigest = decisionsHash(decisions);
  const data = source.data;
  return withBusinessTransaction(pool, async tx => {
    await assertRehearsalDatabase(tx);
    await tx.query('SELECT pg_advisory_xact_lock($1,$2)', [17042026, 3]);
    const previous = (await tx.query('SELECT id,decisions_sha256,status,report FROM erp.migration_runs WHERE source_sha256=$1', [source.sha256])).rows[0];
    if (previous) {
      if (previous.status !== 'completed' || previous.decisions_sha256 !== decisionDigest) {
        fail('ERP_IMPORT_DECISIONS_CHANGED', '相同来源的导入决策已变化，拒绝重复导入');
      }
      await reconcile(tx, source, report, decisions, previous.id);
      return { runId: previous.id, status: 'completed', reused: true, sourceSha256: source.sha256, counts: report.counts };
    }
    for (const table of ['installation', ...Object.values(TABLES), 'customers', 'suppliers', 'warehouses', 'migration_runs', 'legacy_id_map']) {
      if ((await tx.query(`SELECT EXISTS(SELECT 1 FROM erp.${table}) AS occupied`)).rows[0].occupied) {
        fail('ERP_IMPORT_TARGET_NOT_EMPTY', '导入目标必须为空，不允许覆盖或合并现有数据');
      }
    }
    const runId = randomUUID();
    const timestamp = new Date().toISOString();
    await tx.query('INSERT INTO erp.migration_runs(id,source_sha256,decisions_sha256,source_raw,decisions,status) VALUES($1,$2,$3,$4,$5,\'importing\')',
      [runId, source.sha256, decisionDigest, source.raw, JSON.stringify(decisions)]);
    await tx.query("INSERT INTO erp.installation(id,server_id,organization_name,initialized_at,storage_mode) VALUES('default',$1,$2,$3,'legacy')",
      [data.system.serverId, text(data.system.organizationName), data.system.initializedAt || timestamp]);
    const warehouseId = `default-${data.system.serverId}`;
    await tx.query("INSERT INTO erp.warehouses(id,code,name,is_default) VALUES($1,'DEFAULT','默认仓库',true)", [warehouseId]);

    // PostgreSQL extracts original JSON text, preserving numeric types and all unknown fields.
    // Never JSON.stringify the number-as-text inspection tree into a legacy payload.
    const payloads = {};
    for (const collection of Object.keys(TABLES)) {
      payloads[collection] = (await tx.query('SELECT value::text AS raw FROM jsonb_array_elements($1::jsonb -> $2) WITH ORDINALITY AS r(value,n) ORDER BY n', [source.raw, collection])).rows.map(row => row.raw);
    }
    const insert = async (table, fields) => {
      const names = Object.keys(fields);
      await tx.query(`INSERT INTO erp.${table}(${names.join(',')}) VALUES(${names.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(fields));
    };
    const map = (collection, id, table, targetId = id) => tx.query('INSERT INTO erp.legacy_id_map(run_id,collection,source_id,target_table,target_id) VALUES($1,$2,$3,$4,$5)',
      [runId, collection, id, table, targetId]);
    const common = row => ({ active: row.active !== false, version: row.version ?? '1',
      created_at: row.createdAt || data.createdAt || timestamp, updated_at: row.updatedAt || row.createdAt || data.updatedAt || timestamp });
    const users = new Set(data.users.map(row => row.id));
    const models = new Set(data.models.map(row => row.id));
    const actorFields = actor => ({ actor_id: actor && users.has(actor) ? actor : null, legacy_actor_id: nullable(actor) });
    for (const [index, row] of data.users.entries()) {
      await insert('users', { id: row.id, email: row.email.trim(), name: text(row.name), role: row.role,
        password_hash: row.passwordHash, token_version: row.tokenVersion, ...common(row), legacy_payload: payloads.users[index] });
      await map('users', row.id, 'users');
    }
    for (const [index, row] of data.materials.entries()) {
      await insert('materials', { id: row.id, code: nullable(row.code), name: text(row.name), type: text(row.type || row.materialType),
        brand: text(row.brand), color: text(row.color), diameter: nullable(row.diameter), density: nullable(row.density),
        unit: text(row.unit, 'g'), unit_price: row.unitPrice == null ? null : exactText(row.unitPrice), notes: text(row.notes),
        ...common(row), legacy_payload: payloads.materials[index] });
      await map('materials', row.id, 'materials');
    }
    for (const [index, row] of data.models.entries()) {
      await insert('models', { id: row.id, name: text(row.name), description: text(row.description), source: text(row.source),
        ...common(row), legacy_payload: payloads.models[index] });
      await map('models', row.id, 'models');
      for (const [field, table] of [['files', 'model_files'], ['images', 'model_images']]) {
        for (const [position, child] of (row[field] || []).entries()) {
          const metadata = (await tx.query('SELECT ($1::jsonb -> $2 -> $3::int)::text AS raw', [payloads.models[index], field, position])).rows[0].raw;
          await insert(table, { model_id: row.id, id: child.id || `legacy-${position}`, position, file_key: referenceKey(child), url: referenceUrl(child), metadata });
        }
      }
    }
    const customerTargets = new Map(decisions.customers.map(row => [row.orderId, row.targetId]));
    for (const [index, row] of data.orders.entries()) {
      const raw = payloads.orders[index];
      const customer = row.customer;
      const customerRaw = (await tx.query("SELECT ($1::jsonb -> 'customer')::text AS raw", [raw])).rows[0].raw;
      const customerId = customerTargets.get(row.id);
      await insert('customers', { id: customerId, code: `LEGACY-${index + 1}`, name: customer.name,
        contact_name: text(customer.contactName || customer.contact_name), email: text(customer.email), phone: text(customer.phone),
        address: text(customer.address), notes: text(customer.notes), ...common(customer), legacy_payload: customerRaw });
      await map('orders.customer', row.id, 'customers', customerId);
      await insert('orders', { id: row.id, number: text(row.number || row.orderNo, `LEGACY-${row.id}`), customer_id: customerId,
        customer_snapshot: customerRaw, status: row.status, status_reason: text(row.statusReason), currency: row.currency, total: exactText(row.total), notes: text(row.notes),
        due_date: nullable(row.dueDate), created_by: row.createdBy, ...common(row), legacy_payload: raw });
      await map('orders', row.id, 'orders');
      const itemsField = Array.isArray(row.items) ? 'items' : 'orderItems';
      for (const [position, item] of row[itemsField].entries()) {
        const modelId = item.modelId || item.model_asset_id || item.modelAssetId;
        const itemRaw = (await tx.query('SELECT ($1::jsonb -> $2 -> $3::int)::text AS raw', [raw, itemsField, position])).rows[0].raw;
        await insert('order_items', { order_id: row.id, id: item.id, position, model_id: models.has(modelId) ? modelId : null,
          model_name_snapshot: text(item.modelName || item.model_name), quantity: exactText(item.quantity ?? item.qty),
          unit_price: exactText(item.unitPrice ?? item.unit_price), subtotal: exactText(item.subtotal), spec_snapshot: itemRaw });
      }
      for (const [position, attachment] of (row.attachments || []).entries()) {
        const metadata = (await tx.query("SELECT ($1::jsonb -> 'attachments' -> $2::int)::text AS raw", [raw, position])).rows[0].raw;
        await insert('order_attachments', { order_id: row.id, position, file_key: referenceKey(attachment),
          original_name: nullable(attachment.originalName || attachment.name), metadata });
      }
    }
    for (const [index, row] of data.stockLots.entries()) {
      const checked = report.stockLots.find(lot => lot.id === row.id);
      await insert('stock_lots', { id: row.id, material_id: row.materialId || row.material_id, warehouse_id: warehouseId,
        lot_no: text(row.lotNo ?? row.lot_no), serial_no: text(row.serialNo ?? row.serial_no), location: text(row.location),
        notes: text(row.notes), photo_key: text(row.photoKey || row.photo_key), qty_mg: checked.storedQtyMg, baseline_qty_mg: checked.baselineQtyMg,
        balance_status: row.balanceStatus || 'legacy_unverified', state: row.state || row.status || 'in_stock',
        ledger_started_at: row.ledgerStartedAt || null, ...common(row), legacy_payload: payloads.stockLots[index] });
      await map('stockLots', row.id, 'stock_lots');
    }
    for (const [index, row] of data.inventoryTxns.entries()) {
      const tracked = row.ledgerVersion === '1';
      await insert('inventory_txns', { id: row.id, lot_id: row.lotId || row.lot_id, order_id: nullable(row.orderId || row.relatedOrderId || row.related_order_id),
        ...actorFields(row.actorId), type: row.type, qty_mg: tracked ? row.qtyMg : null, before_qty_mg: tracked ? row.beforeQtyMg : null,
        after_qty_mg: tracked ? row.afterQtyMg : null, delta_qty_mg: tracked ? row.deltaQtyMg : null, ledger_version: tracked ? 1 : null,
        source: text(row.source), notes: text(row.notes), created_at: row.createdAt || timestamp, legacy_payload: payloads.inventoryTxns[index] });
      await map('inventoryTxns', row.id, 'inventory_txns');
    }
    for (const [index, row] of data.auditLogs.entries()) {
      const diff = (await tx.query("SELECT ($1::jsonb -> 'diff')::text AS raw", [payloads.auditLogs[index]])).rows[0].raw;
      await insert('audit_logs', { id: row.id, ...actorFields(row.actorId), entity: text(row.entity), entity_id: text(row.entityId),
        action: text(row.action), diff, created_at: row.createdAt || timestamp, legacy_payload: payloads.auditLogs[index] });
      await map('auditLogs', row.id, 'audit_logs');
    }
    for (const [index, row] of data.commandReceipts.entries()) {
      const resultRaw = (await tx.query("SELECT ($1::jsonb -> 'result')::text AS raw", [payloads.commandReceipts[index]])).rows[0].raw;
      await insert('command_receipts', { id: row.id, scope: 'inventory', ...actorFields(row.actorId), key: row.key,
        payload_hash: row.digest.toLowerCase(), status_code: row.result?.status ?? 200, result: resultRaw,
        created_at: row.createdAt || timestamp, legacy_payload: payloads.commandReceipts[index] });
      await map('commandReceipts', row.id, 'command_receipts');
    }
    for (const [index, row] of data.objectUploads.entries()) {
      const owner = row.ownerId || row.createdBy;
      await insert('object_uploads', { id: row.id, owner_id: users.has(owner) ? owner : null, legacy_owner_id: nullable(owner),
        file_key: text(row.objectKey || row.fileKey || row.file_key), metadata: payloads.objectUploads[index], created_at: row.createdAt || timestamp });
      await map('objectUploads', row.id, 'object_uploads');
    }
    await reconcile(tx, source, report, decisions, runId);
    // Re-read files immediately before commit; source raw is held immutable in this process.
    const finalReport = await buildPreflightReport(source, { uploadDirectory });
    if (finalReport.blockerCount || JSON.stringify(finalReport.files) !== JSON.stringify(report.files)) {
      fail('ERP_IMPORT_FILES_CHANGED', '演练期间文件发生变化，导入已回滚');
    }
    await tx.query("UPDATE erp.migration_runs SET status='completed',completed_at=now(),report=$2 WHERE id=$1", [runId, JSON.stringify(report)]);
    return { runId, status: 'completed', reused: false, sourceSha256: source.sha256, counts: report.counts };
  });
}

async function reconcile(tx, source, report, decisions, runId) {
  for (const [collection, table] of Object.entries(TABLES)) {
    const expected = report.counts[collection];
    const actual = (await tx.query(`SELECT count(*)::int AS n FROM erp.${table}`)).rows[0].n;
    const mapped = (await tx.query('SELECT count(*)::int AS n FROM erp.legacy_id_map WHERE run_id=$1 AND collection=$2 AND target_table=$3', [runId, collection, table])).rows[0].n;
    if (actual !== expected || mapped !== expected) fail('ERP_IMPORT_RECONCILIATION_FAILED', '业务或来源映射数量不一致');
    // Compare full original records inside PostgreSQL: no float parsing and no field loss.
    const payloadColumn = table === 'object_uploads' ? 'metadata' : 'legacy_payload';
    const different = (await tx.query(`SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements($1::jsonb -> $2) s
      FULL JOIN erp.${table} t ON t.id = s->>'id'
      WHERE t.id IS NULL OR s IS NULL OR t.${payloadColumn} IS DISTINCT FROM s
    ) AS different`, [source.raw, collection])).rows[0].different;
    if (different) fail('ERP_IMPORT_RECONCILIATION_FAILED', '原始记录与导入快照不一致');
    const wrongMapping = (await tx.query(`SELECT EXISTS(SELECT 1 FROM erp.legacy_id_map m
      LEFT JOIN erp.${table} t ON t.id=m.target_id
      WHERE m.run_id=$1 AND m.collection=$2 AND m.target_table=$3
        AND (m.source_id <> m.target_id OR t.id IS NULL)) AS different`, [runId, collection, table])).rows[0].different;
    if (wrongMapping) fail('ERP_IMPORT_RECONCILIATION_FAILED', '来源映射目标不一致');
  }
  const counts = (await tx.query(`SELECT
    (SELECT count(*)::int FROM erp.customers) AS customers,
    (SELECT count(*)::int FROM erp.order_items) AS items,
    (SELECT count(*)::int FROM erp.model_files) AS files,
    (SELECT count(*)::int FROM erp.model_images) AS images,
    (SELECT count(*)::int FROM erp.order_attachments) AS attachments`)).rows[0];
  const data = source.data;
  if (counts.customers !== decisions.customers.length || counts.items !== data.orders.reduce((n, r) => n + (r.items || r.orderItems).length, 0)
      || counts.files !== data.models.reduce((n, r) => n + (r.files || []).length, 0)
      || counts.images !== data.models.reduce((n, r) => n + (r.images || []).length, 0)
      || counts.attachments !== data.orders.reduce((n, r) => n + (r.attachments || []).length, 0)) {
    fail('ERP_IMPORT_RECONCILIATION_FAILED', '客户或子记录数量不一致');
  }
  // All nested snapshots must equal the source at their original position, including unknown fields.
  for (const [table, parentTable, parentId, field, payloadColumn] of [
    ['model_files', 'models', 'model_id', 'files', 'metadata'],
    ['model_images', 'models', 'model_id', 'images', 'metadata'],
    ['order_attachments', 'orders', 'order_id', 'attachments', 'metadata'],
    ['order_items', 'orders', 'order_id', null, 'spec_snapshot'],
  ]) {
    const sourceArray = field ? `p.legacy_payload -> '${field}'` : "coalesce(p.legacy_payload->'items',p.legacy_payload->'orderItems')";
    const different = (await tx.query(`SELECT EXISTS(SELECT 1 FROM erp.${table} c
      JOIN erp.${parentTable} p ON p.id=c.${parentId}
      WHERE c.${payloadColumn} IS DISTINCT FROM (${sourceArray}) -> c.position) AS different`)).rows[0].different;
    if (different) fail('ERP_IMPORT_RECONCILIATION_FAILED', '附件或规格原始快照不一致');
  }
  for (const row of decisions.customers) {
    const different = (await tx.query(`SELECT NOT EXISTS(SELECT 1 FROM erp.orders o
      JOIN erp.customers c ON c.id=o.customer_id
      JOIN erp.legacy_id_map m ON m.target_id=c.id AND m.source_id=o.id AND m.collection='orders.customer' AND m.target_table='customers' AND m.run_id=$3
      WHERE o.id=$1 AND c.id=$2 AND o.customer_snapshot=o.legacy_payload->'customer'
        AND c.legacy_payload=o.customer_snapshot) AS different`, [row.orderId, row.targetId, runId])).rows[0].different;
    if (different) fail('ERP_IMPORT_RECONCILIATION_FAILED', '客户映射或历史快照不一致');
  }
  const changedCredentials = (await tx.query(`SELECT EXISTS(SELECT 1 FROM erp.users
    WHERE password_hash IS DISTINCT FROM legacy_payload->>'passwordHash'
      OR token_version IS DISTINCT FROM (legacy_payload->>'tokenVersion')::bigint
      OR email IS DISTINCT FROM btrim(legacy_payload->>'email')
      OR role IS DISTINCT FROM legacy_payload->>'role'
      OR version IS DISTINCT FROM coalesce((legacy_payload->>'version')::bigint,1)) AS changed`)).rows[0].changed;
  if (changedCredentials) fail('ERP_IMPORT_RECONCILIATION_FAILED', '账号或版本信息与来源不一致');
  for (const order of report.orders) {
    const current = (await tx.query('SELECT total = $2::numeric AS equal FROM erp.orders WHERE id=$1', [order.id, order.storedTotal])).rows[0];
    const lines = (await tx.query('SELECT id,quantity::text,unit_price::text,subtotal::text FROM erp.order_items WHERE order_id=$1 ORDER BY position', [order.id])).rows;
    if (!current?.equal || lines.length !== order.lines.length || lines.some((line, i) => line.id !== order.lines[i].id
        || exactText(line.quantity) !== exactText(order.lines[i].quantity) || exactText(line.unit_price) !== exactText(order.lines[i].unitPrice)
        || exactText(line.subtotal) !== exactText(order.lines[i].storedSubtotal))) fail('ERP_IMPORT_RECONCILIATION_FAILED', '订单金额与来源不一致');
  }
  for (const lot of report.stockLots) {
    const current = (await tx.query('SELECT qty_mg,baseline_qty_mg FROM erp.stock_lots WHERE id=$1', [lot.id])).rows[0];
    if (current?.qty_mg !== lot.storedQtyMg || current?.baseline_qty_mg !== lot.baselineQtyMg) fail('ERP_IMPORT_RECONCILIATION_FAILED', '库存余额与来源不一致');
  }
  const installation = (await tx.query("SELECT server_id,storage_mode FROM erp.installation WHERE id='default'")).rows[0];
  if (installation?.server_id !== data.system.serverId || installation.storage_mode !== 'legacy') {
    fail('ERP_IMPORT_RECONCILIATION_FAILED', '服务器身份或演练存储状态不一致');
  }
}

module.exports = { importLegacySnapshot, assertRehearsalDatabase };
