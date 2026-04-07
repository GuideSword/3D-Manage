const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { saveFile, deleteFile, getFileUrl } = require('../config/storage');

// 临时模拟订单数据（临时，后续连接数据库）
let mockOrders = [
  {
    id: '1',
    customer: { id: '1', name: '张三' },
    status: 'pending_review',
    total: 150.00,
    currency: 'CNY',
    dueDate: '2024-12-01',
    createdAt: '2024-11-15',
    items: [
      { id: '1', materialType: 'PLA', color: '白色', quantity: 2, unitPrice: 50.00 },
      { id: '2', materialType: 'ABS', color: '黑色', quantity: 1, unitPrice: 50.00 },
    ],
  },
  {
    id: '2',
    customer: { id: '2', name: '李四' },
    status: 'in_progress',
    total: 300.00,
    currency: 'CNY',
    dueDate: '2024-12-05',
    createdAt: '2024-11-10',
    items: [
      { id: '3', materialType: 'PETG', color: '透明', quantity: 3, unitPrice: 100.00 },
    ],
  },
  {
    id: '3',
    customer: { id: '3', name: '王五' },
    status: 'completed',
    total: 200.00,
    currency: 'CNY',
    dueDate: '2024-11-20',
    createdAt: '2024-11-05',
    items: [
      { id: '4', materialType: 'TPU', color: '蓝色', quantity: 2, unitPrice: 100.00 },
    ],
  },
];

// 配置 multer 用于订单附件上传
const upload = multer({ 
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB for attachments
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // 允许图片和PDF附件
    const allowedTypes = ['.png', '.jpg', '.jpeg', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件格式，仅支持 PNG/JPG/PDF'));
    }
  },
});

// GET /api/orders - 获取订单列表（支持筛选和搜索）
router.get('/', async (req, res) => {
  try {
    let filteredOrders = [...mockOrders];

    // 状态筛选
    if (req.query.status && req.query.status !== 'all') {
      filteredOrders = filteredOrders.filter(order => order.status === req.query.status);
    }

    // 搜索（客户名称或订单号）
    if (req.query.search) {
      const searchTerm = req.query.search.toLowerCase();
      filteredOrders = filteredOrders.filter(order => 
        (order.customer?.name || '').toLowerCase().includes(searchTerm) ||
        order.id.toString().includes(searchTerm)
      );
    }

    // 分页（可选）
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 100;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    res.json({
      items: filteredOrders.slice(start, end),
      total: filteredOrders.length,
      page,
      pageSize,
    });
  } catch (error) {
    res.status(500).json({ error: '获取订单列表失败' });
  }
});

// GET /api/orders/:id - 获取单个订单
router.get('/:id', async (req, res) => {
  try {
    const order = mockOrders.find(o => o.id === req.params.id);
    if (!order) {
      return res.status(404).json({ error: '订单不存在' });
    }
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: '获取订单失败' });
  }
});

// POST /api/orders - 创建订单
router.post('/', async (req, res) => {
  try {
    const newOrder = {
      id: String(mockOrders.length + 1),
      ...req.body,
      createdAt: new Date().toISOString().split('T')[0],
      status: req.body.status || 'in_progress', // 默认状态为执行中
      // 附件文件路径应该在 req.body 中（前端先上传附件获得fileKey）
    };
    mockOrders.push(newOrder);
    res.status(201).json(newOrder);
  } catch (error) {
    res.status(500).json({ error: '创建订单失败' });
  }
});

// POST /api/orders/upload-attachment - 上传订单附件
router.post('/upload-attachment', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }
    
    // 保存附件到本地存储
    const result = await saveFile(
      req.file.buffer,
      req.file.originalname,
      'orders/attachments'
    );
    
    res.json({
      success: true,
      fileKey: result.filePath,
      fileUrl: getFileUrl(result.filePath),
      sha256: result.sha256,
      size: result.size,
      originalName: req.file.originalname,
    });
  } catch (error) {
    console.error('附件上传失败:', error);
    res.status(500).json({ error: '附件上传失败: ' + error.message });
  }
});

// PATCH /api/orders/:id - 更新订单
router.patch('/:id', async (req, res) => {
  try {
    const orderIndex = mockOrders.findIndex(o => o.id === req.params.id);
    if (orderIndex === -1) {
      return res.status(404).json({ error: '订单不存在' });
    }
    mockOrders[orderIndex] = { ...mockOrders[orderIndex], ...req.body };
    res.json(mockOrders[orderIndex]);
  } catch (error) {
    res.status(500).json({ error: '更新订单失败' });
  }
});

// DELETE /api/orders/:id - 删除订单
router.delete('/:id', async (req, res) => {
  try {
    const orderIndex = mockOrders.findIndex(o => o.id === req.params.id);
    if (orderIndex === -1) {
      return res.status(404).json({ error: '订单不存在' });
    }
    
    const order = mockOrders[orderIndex];
    
    // 删除关联的附件文件
    if (order.attachments) {
      for (const attachment of order.attachments) {
        if (attachment.fileKey) {
          try {
            await deleteFile(attachment.fileKey);
          } catch (error) {
            console.error('删除附件失败:', error);
          }
        }
      }
    }
    
    mockOrders.splice(orderIndex, 1);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '删除订单失败' });
  }
});

// PATCH /api/orders/:id/status - 更新订单状态
router.patch('/:id/status', async (req, res) => {
  try {
    const orderIndex = mockOrders.findIndex(o => o.id === req.params.id);
    if (orderIndex === -1) {
      return res.status(404).json({ error: '订单不存在' });
    }
    mockOrders[orderIndex].status = req.body.status;
    if (req.body.reason) {
      mockOrders[orderIndex].statusReason = req.body.reason;
    }
    mockOrders[orderIndex].updatedAt = new Date().toISOString();
    res.json(mockOrders[orderIndex]);
  } catch (error) {
    res.status(500).json({ error: '更新订单状态失败' });
  }
});

// GET /api/orders/export - 导出订单（CSV）
router.get('/export', async (req, res) => {
  try {
    // TODO: 实现CSV导出逻辑
    // 可以生成CSV文件并保存到本地存储，然后返回下载URL
    res.json({ message: '导出功能开发中' });
  } catch (error) {
    res.status(500).json({ error: '导出订单失败' });
  }
});

module.exports = router;
