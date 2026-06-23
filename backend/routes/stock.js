const express = require('express');
const router = express.Router();
const { withData, nextId, appendAudit, now } = require('../utils/store');
const { toCsv, fromCsv } = require('../utils/csv');
const { requireRoles } = require('../middleware/auth');

const toNumber = (value, fallback = 0) => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeLotPayload = (payload = {}, existing = null) => {
  const timestamp = now();
  return {
    ...(existing || {}),
    ...payload,
    materialId: String(payload.materialId || payload.material_id || existing?.materialId || ''),
    lotNo: payload.lotNo || payload.lot_no || existing?.lotNo || '',
    serialNo: payload.serialNo || payload.serial_no || existing?.serialNo || '',
    location: payload.location || existing?.location || '',
    qty: toNumber(payload.qty ?? payload.qty_g, existing?.qty || 0),
    state: payload.state || payload.status || existing?.state || 'in_stock',
    notes: payload.notes || existing?.notes || '',
    photoKey: payload.photoKey || payload.photo_key || existing?.photoKey || '',
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  };
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
        { key: 'state', label: 'state' },
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
    return res.status(500).json({ error: 'Export stock failed' });
  }
});

router.post('/import', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const imported = await withData((data) => {
      const incomingLots = Array.isArray(req.body.lots)
        ? req.body.lots
        : fromCsv(req.body.csv).map((row) => ({
          materialId: row.material_id || row.materialId,
          lotNo: row.lot_no || row.lotNo,
          serialNo: row.serial_no || row.serialNo,
          location: row.location,
          qty: row.qty || row.qty_g,
          state: row.state || row.status || 'in_stock',
          notes: row.notes,
        }));

      const created = incomingLots.map((lotPayload) => {
        const lot = normalizeLotPayload(lotPayload);
        lot.id = nextId(data.stockLots);
        data.stockLots.push(lot);
        data.inventoryTxns.push({
          id: nextId(data.inventoryTxns),
          lotId: lot.id,
          materialId: lot.materialId,
          type: 'in',
          qty: lot.qty,
          notes: 'Imported stock lot.',
          createdAt: now(),
          actorId: 'system',
        });
        return lot;
      });

      appendAudit(data, {
        entity: 'stock',
        entityId: null,
        action: 'lots.import',
        diff: { count: created.length },
      });
      return created;
    });

    res.status(201).json({ imported: imported.length, items: imported });
  } catch (error) {
    console.error('Import stock lots failed:', error);
    res.status(400).json({ error: 'Import stock lots failed' });
  }
});

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
    res.status(500).json({ error: 'Get stock lots failed' });
  }
});

router.post('/lots', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const created = await withData((data) => {
      const material = data.materials.find((item) => item.id === String(req.body.materialId || req.body.material_id));
      if (!material) {
        return { status: 404, body: { error: 'Material not found' } };
      }

      const lot = normalizeLotPayload(req.body);
      lot.id = nextId(data.stockLots);
      data.stockLots.push(lot);
      appendAudit(data, {
        entity: 'stockLots',
        entityId: lot.id,
        action: 'create',
        diff: lot,
      });
      return { status: 201, body: lot };
    });
    res.status(created.status).json(created.body);
  } catch (error) {
    res.status(500).json({ error: 'Create stock lot failed' });
  }
});

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
    res.status(500).json({ error: 'Get inventory transactions failed' });
  }
});

router.post('/inventory/txns', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const result = await withData((data) => {
      const lot = data.stockLots.find((item) => item.id === String(req.body.lotId || req.body.lot_id));
      if (!lot) {
        return { status: 404, body: { error: 'Stock lot not found' } };
      }

      const type = req.body.type;
      const qty = toNumber(req.body.qty ?? req.body.qty_g, 0);
      if (!['in', 'out', 'adjust', 'scrap'].includes(type)) {
        return { status: 400, body: { error: 'Invalid inventory transaction type' } };
      }
      if (qty < 0 || (type !== 'adjust' && qty === 0)) {
        return { status: 400, body: { error: 'Invalid quantity' } };
      }

      const before = { qty: lot.qty, state: lot.state };
      if (type === 'in') {
        lot.qty = toNumber(lot.qty, 0) + qty;
      } else if (type === 'out') {
        if (toNumber(lot.qty, 0) < qty) {
          return { status: 400, body: { error: 'Insufficient stock' } };
        }
        lot.qty = toNumber(lot.qty, 0) - qty;
      } else if (type === 'adjust') {
        lot.qty = qty;
      } else if (type === 'scrap') {
        if (toNumber(lot.qty, 0) < qty) {
          return { status: 400, body: { error: 'Insufficient stock' } };
        }
        lot.qty = toNumber(lot.qty, 0) - qty;
        if (lot.qty === 0) {
          lot.state = 'scrapped';
        }
      }

      lot.updatedAt = now();
      const txn = {
        id: nextId(data.inventoryTxns),
        lotId: lot.id,
        materialId: lot.materialId || lot.material_id,
        type,
        qty,
        notes: req.body.notes || req.body.reason || '',
        orderId: req.body.orderId || req.body.relatedOrderId || req.body.related_order_id || '',
        createdAt: now(),
        actorId: req.body.actorId || 'system',
      };
      data.inventoryTxns.push(txn);
      appendAudit(data, {
        entity: 'stockLots',
        entityId: lot.id,
        action: `inventory.${type}`,
        diff: { before, after: { qty: lot.qty, state: lot.state }, txn },
      });

      return { status: 201, body: txn };
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(500).json({ error: 'Inventory transaction failed' });
  }
});

router.get('/lots/:id/audit', requireRoles('owner'), async (req, res) => {
  try {
    const logs = await withData((data) => data.auditLogs.filter((log) => (
      log.entity === 'stockLots' && log.entityId === String(req.params.id)
    )), { write: false });
    res.json({ items: logs, total: logs.length });
  } catch (error) {
    res.status(500).json({ error: 'Get stock lot audit failed' });
  }
});

router.get('/lots/:id', requireRoles('owner', 'staff', 'viewer'), async (req, res) => {
  try {
    const lot = await withData((data) => data.stockLots.find((item) => item.id === String(req.params.id)), { write: false });
    if (!lot) {
      return res.status(404).json({ error: 'Stock lot not found' });
    }
    return res.json(lot);
  } catch (error) {
    return res.status(500).json({ error: 'Get stock lot failed' });
  }
});

router.patch('/lots/:id', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const updated = await withData((data) => {
      const lotIndex = data.stockLots.findIndex((item) => item.id === String(req.params.id));
      if (lotIndex === -1) {
        return null;
      }
      const before = data.stockLots[lotIndex];
      const lot = normalizeLotPayload(req.body, before);
      data.stockLots[lotIndex] = lot;
      appendAudit(data, {
        entity: 'stockLots',
        entityId: lot.id,
        action: 'update',
        diff: { before, after: lot },
      });
      return lot;
    });

    if (!updated) {
      return res.status(404).json({ error: 'Stock lot not found' });
    }
    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: 'Update stock lot failed' });
  }
});

router.delete('/lots/:id', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const deleted = await withData((data) => {
      const lotIndex = data.stockLots.findIndex((item) => item.id === String(req.params.id));
      if (lotIndex === -1) {
        return null;
      }

      const [lot] = data.stockLots.splice(lotIndex, 1);
      appendAudit(data, {
        entity: 'stockLots',
        entityId: lot.id,
        action: 'delete',
        diff: lot,
      });
      return lot;
    });

    if (!deleted) {
      return res.status(404).json({ error: 'Stock lot not found' });
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Delete stock lot failed' });
  }
});

module.exports = router;
