const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { saveFile, deleteFile, getFileUrl } = require('../config/storage');
const { withData, nextId, appendAudit, now } = require('../utils/store');
const { toCsv, fromCsv } = require('../utils/csv');
const { requireRoles } = require('../middleware/auth');

const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 },
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.png', '.jpg', '.jpeg', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported attachment format. Use PNG, JPG, JPEG, or PDF.'));
    }
  },
});

const allowedTransitions = {
  draft: ['pending_review', 'cancelled'],
  pending_review: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

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

const filterOrders = (orders, query = {}) => {
  let filteredOrders = [...orders];

  if (query.status && query.status !== 'all') {
    filteredOrders = filteredOrders.filter((order) => order.status === query.status);
  }

  if (query.search) {
    const searchTerm = String(query.search).trim().toLowerCase();
    filteredOrders = filteredOrders.filter((order) => (
      (order.customer?.name || '').toLowerCase().includes(searchTerm)
      || String(order.id).includes(searchTerm)
      || (order.notes || '').toLowerCase().includes(searchTerm)
    ));
  }

  if (query.dateFrom) {
    filteredOrders = filteredOrders.filter((order) => String(order.createdAt || '') >= String(query.dateFrom));
  }

  if (query.dateTo) {
    filteredOrders = filteredOrders.filter((order) => String(order.createdAt || '') <= String(query.dateTo));
  }

  return filteredOrders;
};

const exportRows = (orders) => orders.flatMap((order) => {
  const items = order.items?.length ? order.items : [{}];
  return items.map((item) => ({
    orderId: order.id,
    customerName: order.customer?.name || '',
    customerEmail: order.customer?.email || '',
    customerPhone: order.customer?.phone || '',
    status: order.status,
    total: order.total,
    currency: order.currency,
    dueDate: order.dueDate || '',
    createdAt: order.createdAt || '',
    updatedAt: order.updatedAt || '',
    itemModelName: item.modelName || '',
    itemMaterialType: item.materialType || '',
    itemColor: item.color || '',
    itemQuantity: item.quantity || '',
    itemUnitPrice: item.unitPrice || '',
    itemSubtotal: item.subtotal || '',
    notes: order.notes || '',
  }));
});

router.get('/export', requireRoles('owner'), async (req, res) => {
  try {
    const result = await withData((data) => {
      const orders = filterOrders(data.orders, req.query);
      appendAudit(data, {
        entity: 'orders',
        entityId: null,
        action: 'export',
        diff: { count: orders.length, query: req.query },
      });
      return orders;
    });

    const csv = toCsv([
      { key: 'orderId', label: 'order_id' },
      { key: 'customerName', label: 'customer_name' },
      { key: 'customerEmail', label: 'customer_email' },
      { key: 'customerPhone', label: 'customer_phone' },
      { key: 'status', label: 'status' },
      { key: 'total', label: 'total' },
      { key: 'currency', label: 'currency' },
      { key: 'dueDate', label: 'due_date' },
      { key: 'createdAt', label: 'created_at' },
      { key: 'updatedAt', label: 'updated_at' },
      { key: 'itemModelName', label: 'item_model_name' },
      { key: 'itemMaterialType', label: 'item_material_type' },
      { key: 'itemColor', label: 'item_color' },
      { key: 'itemQuantity', label: 'item_quantity' },
      { key: 'itemUnitPrice', label: 'item_unit_price' },
      { key: 'itemSubtotal', label: 'item_subtotal' },
      { key: 'notes', label: 'notes' },
    ], exportRows(result));

    const filename = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    if (req.query.download === '1' || req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    }

    return res.json({
      filename,
      contentType: 'text/csv',
      count: result.length,
      content: csv,
    });
  } catch (error) {
    console.error('Export orders failed:', error);
    return res.status(500).json({ error: 'Export orders failed' });
  }
});

router.post('/import', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const imported = await withData((data) => {
      const incomingOrders = Array.isArray(req.body.orders)
        ? req.body.orders
        : fromCsv(req.body.csv).map((row) => ({
          customer: {
            name: row.customer_name || row.customerName,
            email: row.customer_email || row.customerEmail,
            phone: row.customer_phone || row.customerPhone,
          },
          status: row.status || 'pending_review',
          total: row.total,
          currency: row.currency || 'CNY',
          dueDate: row.due_date || row.dueDate,
          notes: row.notes,
          items: [
            {
              modelName: row.item_model_name || row.itemModelName,
              materialType: row.item_material_type || row.itemMaterialType,
              color: row.item_color || row.itemColor,
              quantity: row.item_quantity || row.itemQuantity,
              unitPrice: row.item_unit_price || row.itemUnitPrice,
            },
          ],
        }));

      const created = incomingOrders.map((orderPayload) => {
        const order = normalizeOrderPayload(orderPayload);
        order.id = nextId(data.orders);
        data.orders.push(order);
        return order;
      });

      appendAudit(data, {
        entity: 'orders',
        entityId: null,
        action: 'import',
        diff: { count: created.length },
      });

      return created;
    });

    res.status(201).json({ imported: imported.length, items: imported });
  } catch (error) {
    console.error('Import orders failed:', error);
    res.status(400).json({ error: 'Import orders failed' });
  }
});

router.post('/upload-attachment', requireRoles('owner', 'staff'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const result = await saveFile(
      req.file.buffer,
      req.file.originalname,
      'orders/attachments'
    );

    return res.json({
      success: true,
      fileKey: result.filePath,
      fileUrl: getFileUrl(result.filePath),
      sha256: result.sha256,
      size: result.size,
      originalName: req.file.originalname,
    });
  } catch (error) {
    console.error('Attachment upload failed:', error);
    return res.status(500).json({ error: `Attachment upload failed: ${error.message}` });
  }
});

router.get('/', requireRoles('owner', 'staff', 'viewer'), async (req, res) => {
  try {
    const result = await withData((data) => {
      const filteredOrders = filterOrders(data.orders, req.query);
      const page = Number.parseInt(req.query.page, 10) || 1;
      const pageSize = Number.parseInt(req.query.pageSize, 10) || 100;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;

      return {
        items: filteredOrders.slice(start, end),
        total: filteredOrders.length,
        page,
        pageSize,
      };
    }, { write: false });

    res.json(result);
  } catch (error) {
    console.error('Get orders failed:', error);
    res.status(500).json({ error: 'Get orders failed' });
  }
});

router.post('/', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const created = await withData((data) => {
      const newOrder = normalizeOrderPayload(req.body);
      newOrder.id = nextId(data.orders);
      data.orders.push(newOrder);
      appendAudit(data, {
        entity: 'orders',
        entityId: newOrder.id,
        action: 'create',
        diff: newOrder,
      });
      return newOrder;
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Create order failed:', error);
    res.status(500).json({ error: 'Create order failed' });
  }
});

router.get('/:id/audit', requireRoles('owner'), async (req, res) => {
  try {
    const logs = await withData((data) => data.auditLogs.filter((log) => (
      log.entity === 'orders' && log.entityId === String(req.params.id)
    )), { write: false });
    res.json({ items: logs, total: logs.length });
  } catch (error) {
    res.status(500).json({ error: 'Get order audit failed' });
  }
});

router.get('/:id', requireRoles('owner', 'staff', 'viewer'), async (req, res) => {
  try {
    const order = await withData((data) => data.orders.find((item) => item.id === String(req.params.id)), { write: false });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    return res.json(order);
  } catch (error) {
    return res.status(500).json({ error: 'Get order failed' });
  }
});

router.patch('/:id', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const updated = await withData((data) => {
      const orderIndex = data.orders.findIndex((item) => item.id === String(req.params.id));
      if (orderIndex === -1) {
        return null;
      }
      const before = data.orders[orderIndex];
      const order = normalizeOrderPayload(req.body, before);
      data.orders[orderIndex] = order;
      appendAudit(data, {
        entity: 'orders',
        entityId: order.id,
        action: 'update',
        diff: { before, after: order },
      });
      return order;
    });

    if (!updated) {
      return res.status(404).json({ error: 'Order not found' });
    }
    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: 'Update order failed' });
  }
});

router.delete('/:id', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const deleted = await withData(async (data) => {
      const orderIndex = data.orders.findIndex((item) => item.id === String(req.params.id));
      if (orderIndex === -1) {
        return null;
      }

      const [order] = data.orders.splice(orderIndex, 1);
      if (order.attachments) {
        for (const attachment of order.attachments) {
          if (attachment.fileKey) {
            try {
              await deleteFile(attachment.fileKey);
            } catch (error) {
              console.error('Delete attachment failed:', error);
            }
          }
        }
      }

      appendAudit(data, {
        entity: 'orders',
        entityId: order.id,
        action: 'delete',
        diff: order,
      });
      return order;
    });

    if (!deleted) {
      return res.status(404).json({ error: 'Order not found' });
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Delete order failed' });
  }
});

router.patch('/:id/status', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const result = await withData((data) => {
      const orderIndex = data.orders.findIndex((item) => item.id === String(req.params.id));
      if (orderIndex === -1) {
        return { status: 404, body: { error: 'Order not found' } };
      }

      const order = data.orders[orderIndex];
      const nextStatus = req.body.status;
      const validNextStatuses = allowedTransitions[order.status] || [];
      if (order.status !== nextStatus && !validNextStatuses.includes(nextStatus)) {
        return {
          status: 400,
          body: {
            error: 'Invalid status transition',
            currentStatus: order.status,
            nextStatus,
            allowed: validNextStatuses,
          },
        };
      }

      const before = { status: order.status, statusReason: order.statusReason };
      order.status = nextStatus;
      order.statusReason = req.body.reason || '';
      order.updatedAt = now();
      appendAudit(data, {
        entity: 'orders',
        entityId: order.id,
        action: 'status',
        diff: { before, after: { status: order.status, statusReason: order.statusReason } },
      });
      return { status: 200, body: order };
    });

    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({ error: 'Update order status failed' });
  }
});

module.exports = router;
