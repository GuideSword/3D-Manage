const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { saveFile, deleteFile, getFileUrl } = require('../config/storage');

// 临时模拟模型数据
const mockModels = [];

// 配置 multer 用于文件上传（内存存储，然后保存到磁盘）
const upload = multer({ 
  limits: { 
    fileSize: 500 * 1024 * 1024, // 500MB
  },
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // 验证文件类型
    const allowedTypes = ['.stl', '.obj', '.3mf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件格式，仅支持 STL/OBJ/3MF'));
    }
  },
});

// GET /api/models - 获取模型列表
router.get('/', async (req, res) => {
  try {
    res.json({ items: mockModels, total: mockModels.length });
  } catch (error) {
    res.status(500).json({ error: '获取模型列表失败' });
  }
});

// POST /api/models - 创建模型资产
router.post('/', async (req, res) => {
  try {
    const newModel = { 
      id: String(mockModels.length + 1), 
      ...req.body,
      createdAt: new Date().toISOString(),
    };
    mockModels.push(newModel);
    res.status(201).json(newModel);
  } catch (error) {
    res.status(500).json({ error: '创建模型失败' });
  }
});

// POST /api/models/upload - 上传模型文件（使用本地存储）
// 注意：必须在 /:id 路由之前定义，否则会被 /:id 匹配
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }
    
    const { assetId, version, notes } = req.body;
    const folder = assetId ? `models/${assetId}` : 'models/default';
    
    // 保存文件到本地存储
    const result = await saveFile(
      req.file.buffer,
      req.file.originalname,
      folder
    );
    
    // 返回文件信息（用于存储到数据库）
    res.json({
      success: true,
      fileKey: result.filePath, // 存储到数据库的字段
      fileUrl: getFileUrl(result.filePath), // 前端访问URL
      sha256: result.sha256,
      size: result.size,
      originalName: req.file.originalname,
    });
  } catch (error) {
    console.error('文件上传失败:', error);
    if (error.message.includes('不支持')) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: '文件上传失败: ' + error.message });
    }
  }
});

// POST /api/models/:id/versions - 添加模型版本
// 注意：必须在 /:id 路由之前定义，否则会被 /:id 匹配
router.post('/:id/versions', async (req, res) => {
  try {
    const model = mockModels.find(m => m.id === req.params.id);
    if (!model) {
      return res.status(404).json({ error: '模型不存在' });
    }
    
    const newVersion = {
      id: String((model.versions?.length || 0) + 1),
      ...req.body,
      createdAt: new Date().toISOString(),
    };
    
    if (!model.versions) {
      model.versions = [];
    }
    model.versions.push(newVersion);
    model.currentVersion = newVersion.version || model.versions.length;
    
    res.status(201).json(newVersion);
  } catch (error) {
    res.status(500).json({ error: '添加版本失败' });
  }
});

// GET /api/models/:id - 获取单个模型详情
router.get('/:id', async (req, res) => {
  try {
    const model = mockModels.find(m => m.id === req.params.id);
    if (!model) {
      return res.status(404).json({ error: '模型不存在' });
    }
    res.json(model);
  } catch (error) {
    res.status(500).json({ error: '获取模型详情失败' });
  }
});

// DELETE /api/models/:id - 删除模型
router.delete('/:id', async (req, res) => {
  try {
    const modelIndex = mockModels.findIndex(m => m.id === req.params.id);
    if (modelIndex === -1) {
      return res.status(404).json({ error: '模型不存在' });
    }
    
    const model = mockModels[modelIndex];
    
    // 删除关联的文件
    if (model.versions) {
      for (const version of model.versions) {
        if (version.fileKey) {
          try {
            await deleteFile(version.fileKey);
          } catch (error) {
            console.error('删除文件失败:', error);
          }
        }
      }
    }
    
    mockModels.splice(modelIndex, 1);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '删除模型失败' });
  }
});

module.exports = router;
