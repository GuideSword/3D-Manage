const express = require('express');
const router = express.Router();

// 临时模拟库存数据
const mockStockLots = [];
const mockInventoryTxns = [];

router.get('/lots', async (req, res) => {
  try {
    let filteredLots = [...mockStockLots];
    
    // 如果提供了materialId，进行过滤
    if (req.query.materialId) {
      filteredLots = filteredLots.filter(
        lot => lot.materialId === req.query.materialId || lot.material_id === req.query.materialId
      );
    }
    
    res.json({ items: filteredLots, total: filteredLots.length });
  } catch (error) {
    res.status(500).json({ error: '获取库存批次失败' });
  }
});

router.post('/lots', async (req, res) => {
  try {
    const newLot = {
      id: String(mockStockLots.length + 1),
      ...req.body,
      createdAt: new Date().toISOString().split('T')[0],
      state: req.body.state || 'in_stock',
    };
    mockStockLots.push(newLot);
    res.status(201).json(newLot);
  } catch (error) {
    res.status(500).json({ error: '创建库存批次失败' });
  }
});

// GET /api/stock/lots/:id - 获取单个批次
router.get('/lots/:id', async (req, res) => {
  try {
    const lot = mockStockLots.find(l => l.id === req.params.id);
    if (!lot) {
      return res.status(404).json({ error: '批次不存在' });
    }
    res.json(lot);
  } catch (error) {
    res.status(500).json({ error: '获取批次失败' });
  }
});

// PATCH /api/stock/lots/:id - 更新批次
router.patch('/lots/:id', async (req, res) => {
  try {
    const index = mockStockLots.findIndex(l => l.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: '批次不存在' });
    }
    mockStockLots[index] = { ...mockStockLots[index], ...req.body, updatedAt: new Date().toISOString().split('T')[0] };
    res.json(mockStockLots[index]);
  } catch (error) {
    res.status(500).json({ error: '更新批次失败' });
  }
});

// DELETE /api/stock/lots/:id - 删除批次
router.delete('/lots/:id', async (req, res) => {
  try {
    const index = mockStockLots.findIndex(l => l.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: '批次不存在' });
    }
    mockStockLots.splice(index, 1);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '删除批次失败' });
  }
});

// POST /api/stock/inventory/txns - 库存操作（入库、出库、调整）
router.post('/inventory/txns', async (req, res) => {
  try {
    const { lotId, type, qty, notes, orderId } = req.body;
    const lot = mockStockLots.find(l => l.id === lotId);
    if (!lot) {
      return res.status(404).json({ error: '批次不存在' });
    }

    // 执行库存操作
    if (type === 'in') {
      lot.qty = (lot.qty || 0) + qty;
    } else if (type === 'out') {
      if ((lot.qty || 0) < qty) {
        return res.status(400).json({ error: '库存不足' });
      }
      lot.qty = (lot.qty || 0) - qty;
    } else if (type === 'adjust') {
      lot.qty = qty;
    }

    // 记录交易
    const txn = {
      id: String(mockInventoryTxns.length + 1),
      lotId,
      type,
      qty,
      notes,
      orderId,
      createdAt: new Date().toISOString().split('T')[0],
    };
    mockInventoryTxns.push(txn);

    res.status(201).json(txn);
  } catch (error) {
    res.status(500).json({ error: '库存操作失败' });
  }
});

module.exports = router;

