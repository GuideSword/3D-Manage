const express = require('express');
const router = express.Router();
const { withData, appendAudit } = require('../utils/store');
const inventory = require('../services/inventory');
const { toCsv, fromCsv } = require('../utils/csv');
const { requireRoles } = require('../middleware/auth');

const respondError = (res, error, fallback) => res.status(error.status || 500).json({
  code: error.code && error.status ? error.code : 'INVENTORY_FAILED',
  error: error.status ? error.message : fallback,
});
const commandOptions = (req) => ({
  actor: req.user,
  idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey,
});
const commandBody = (req) => {
  if (req.body == null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new inventory.InventoryError(400, 'INVALID_COMMAND', '库存操作内容必须为对象');
  }
  const { idempotencyKey, ...body } = req.body || {};
  return body;
};
const commandRoute = (operation, makePayload, fallback) => async (req, res) => {
  try {
    const result = await inventory.executeCommand(operation, makePayload(req), commandOptions(req));
    return res.status(result.status).json(result.body);
  } catch (error) {
    return respondError(res, error, fallback);
  }
};

const filterLots = (lots, query = {}) => {
  let filteredLots = [...lots];

  if (query.materialId) {
    filteredLots = filteredLots.filter((lot) => String(lot.materialId || lot.material_id) === String(query.materialId));
  }

  if (query.state || query.status) {
    const state = query.state || query.status;
    filteredLots = filteredLots.filter((lot) => (lot.state || lot.status) === state);
  }

  if (query.search) {
    const searchTerm = String(query.search).trim().toLowerCase();
    filteredLots = filteredLots.filter((lot) => (
      (lot.lotNo || '').toLowerCase().includes(searchTerm)
      || (lot.serialNo || '').toLowerCase().includes(searchTerm)
      || (lot.location || '').toLowerCase().includes(searchTerm)
      || (lot.notes || '').toLowerCase().includes(searchTerm)
    ));
  }

  return filteredLots;
};

const filterTransactions = (transactions, query = {}) => {
  let filteredTransactions = [...transactions];
  if (query.lotId) {
    filteredTransactions = filteredTransactions.filter((txn) => String(txn.lotId) === String(query.lotId));
  }
  if (query.materialId) {
    filteredTransactions = filteredTransactions.filter((txn) => String(txn.materialId) === String(query.materialId));
  }
  if (query.type) {
    filteredTransactions = filteredTransactions.filter((txn) => txn.type === query.type);
  }
  return filteredTransactions;
};

router.get('/export', requireRoles('owner'), async (req, res) => {
  try {
    const exportType = req.query.type === 'transactions' ? 'transactions' : 'lots';
    const items = await withData((data) => {
      const result = exportType === 'transactions'
        ? filterTransactions(data.inventoryTxns, req.query)
        : filterLots(data.stockLots, req.query);
      appendAudit(data, {
        actorId: String(req.user.id),
        entity: 'stock',
        entityId: null,
        action: `${exportType}.export`,
        diff: { count: result.length, query: req.query },
      });
      return result;
    });

    const headers = exportType === 'transactions'
      ? [
        { key: 'id', label: 'id' },
        { key: 'lotId', label: 'lot_id' },
        { key: 'materialId', label: 'material_id' },
        { key: 'type', label: 'type' },
        { key: 'qty', label: 'qty' },
        { key: 'qtyMg', label: 'qty_mg' },
        { key: 'beforeQty', label: 'before_qty' },
        { key: 'afterQty', label: 'after_qty' },
        { key: 'deltaQty', label: 'delta_qty' },
        { key: 'deltaQtyMg', label: 'delta_qty_mg' },
        { key: 'ledgerVersion', label: 'ledger_version' },
        { key: 'source', label: 'source' },
        { key: 'orderId', label: 'order_id' },
        { key: 'notes', label: 'notes' },
        { key: 'createdAt', label: 'created_at' },
        { key: 'actorId', label: 'actor_id' },
      ]
      : [
        { key: 'id', label: 'id' },
        { key: 'materialId', label: 'material_id' },
        { key: 'lotNo', label: 'lot_no' },
        { key: 'serialNo', label: 'serial_no' },
        { key: 'location', label: 'location' },
        { key: 'qty', label: 'qty' },
        { key: 'qtyMg', label: 'qty_mg' },
        { key: 'state', label: 'state' },
        { key: 'active', label: 'active' },
        { key: 'balanceStatus', label: 'balance_status' },
        { key: 'ledgerBaselineQtyMg', label: 'ledger_baseline_qty_mg' },
        { key: 'ledgerStartedAt', label: 'ledger_started_at' },
        { key: 'notes', label: 'notes' },
        { key: 'createdAt', label: 'created_at' },
        { key: 'updatedAt', label: 'updated_at' },
      ];

    const csv = toCsv(headers, items);
    const filename = `stock-${exportType}-${new Date().toISOString().slice(0, 10)}.csv`;
    if (req.query.download === '1' || req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    }

    return res.json({ filename, contentType: 'text/csv', count: items.length, content: csv });
  } catch (error) {
    console.error('Export stock failed:', error);
    return res.status(500).json({ error: '导出库存失败' });
  }
});

router.post('/import', requireRoles('owner', 'staff'), commandRoute('lots.import', (req) => {
  const body = commandBody(req);
  const lots = Array.isArray(body.lots) ? body.lots : fromCsv(body.csv).map((row) => ({
    materialId: row.material_id || row.materialId,
    lotNo: row.lot_no || row.lotNo,
    serialNo: row.serial_no || row.serialNo,
    location: row.location,
    qty: row.qty ?? row.qty_g,
    unit: row.unit ?? 'g',
    state: row.state || row.status || 'in_stock',
    notes: row.notes,
  }));
  return { lots };
}, '导入库存批次失败'));

router.get('/lots', requireRoles('owner', 'staff', 'viewer'), async (req, res) => {
  try {
    const result = await withData((data) => {
      const filteredLots = filterLots(data.stockLots, req.query);
      const page = Number.parseInt(req.query.page, 10) || 1;
      const pageSize = Number.parseInt(req.query.pageSize, 10) || 100;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      return {
        items: filteredLots.slice(start, end),
        total: filteredLots.length,
        page,
        pageSize,
      };
    }, { write: false });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '获取库存批次失败' });
  }
});

router.post('/lots', requireRoles('owner', 'staff'), commandRoute(
  'lot.create', commandBody, '创建库存批次失败'
));

router.get('/inventory/txns', requireRoles('owner', 'staff', 'viewer'), async (req, res) => {
  try {
    const result = await withData((data) => {
      const filteredTransactions = filterTransactions(data.inventoryTxns, req.query);
      const page = Number.parseInt(req.query.page, 10) || 1;
      const pageSize = Number.parseInt(req.query.pageSize, 10) || 100;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      return {
        items: filteredTransactions.slice(start, end),
        total: filteredTransactions.length,
        page,
        pageSize,
      };
    }, { write: false });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '获取库存流水失败' });
  }
});

router.post('/inventory/txns', requireRoles('owner', 'staff'), commandRoute(
  'inventory.post', commandBody, '库存操作失败'
));

router.get('/lots/:id/audit', requireRoles('owner'), async (req, res) => {
  try {
    const logs = await withData((data) => data.auditLogs.filter((log) => (
      log.entity === 'stockLots' && log.entityId === String(req.params.id)
    )), { write: false });
    res.json({ items: logs, total: logs.length });
  } catch (error) {
    res.status(500).json({ error: '获取库存批次审计记录失败' });
  }
});

router.get('/lots/:id', requireRoles('owner', 'staff', 'viewer'), async (req, res) => {
  try {
    const lot = await withData((data) => data.stockLots.find((item) => item.id === String(req.params.id)), { write: false });
    if (!lot) {
      return res.status(404).json({ error: '库存批次不存在' });
    }
    return res.json(lot);
  } catch (error) {
    return res.status(500).json({ error: '获取库存批次失败' });
  }
});

router.patch('/lots/:id', requireRoles('owner', 'staff'), commandRoute(
  'lot.update', (req) => ({ id: req.params.id, changes: commandBody(req) }), '更新库存批次失败'
));

router.post('/lots/:id/archive', requireRoles('owner', 'staff'), commandRoute(
  'lot.archive', (req) => ({ id: req.params.id, changes: commandBody(req) }), '停用库存批次失败'
));

router.delete('/lots/:id', requireRoles('owner', 'staff'), commandRoute(
  'lot.delete', (req) => ({ id: req.params.id }), '删除库存批次失败'
));

module.exports = router;
