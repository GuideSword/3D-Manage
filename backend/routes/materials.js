const express = require('express');
const router = express.Router();

// 临时模拟物料数据
const mockMaterials = [];

router.get('/', async (req, res) => {
  try {
    let filteredMaterials = [...mockMaterials];
    
    // 如果提供了搜索参数，进行过滤
    if (req.query.search) {
      const searchTerm = req.query.search.trim().toLowerCase();
      if (searchTerm) {
        filteredMaterials = mockMaterials.filter(material => {
          // 搜索字段：类型、品牌、颜色
          const type = String(material.type || material.materialType || '').toLowerCase();
          const brand = String(material.brand || '').toLowerCase();
          const color = String(material.color || '').toLowerCase();
          
          // 检查每个字段是否包含完整的搜索词（精确匹配）
          // 对于颜色字段，进行更严格的匹配，避免"金色"匹配到"红色"
          const typeMatch = type && type.includes(searchTerm);
          const brandMatch = brand && brand.includes(searchTerm);
          const colorMatch = color && color.includes(searchTerm);
          
          // 只有当颜色完全匹配时才返回true（避免"金"字符匹配到"红"色中的"色"）
          // 如果搜索词是单个字符，需要完全匹配；如果是多个字符，使用includes
          if (searchTerm.length === 1) {
            // 单字符搜索：必须是精确匹配
            return (type && type === searchTerm) || 
                   (brand && brand === searchTerm) || 
                   (color && color === searchTerm);
          } else {
            // 多字符搜索：必须包含完整搜索词
            return typeMatch || brandMatch || colorMatch;
          }
        });
      }
    }
    
    res.json({ items: filteredMaterials, total: filteredMaterials.length });
  } catch (error) {
    res.status(500).json({ error: '获取物料列表失败' });
  }
});

router.post('/', async (req, res) => {
  try {
    const newMaterial = {
      id: String(mockMaterials.length + 1),
      ...req.body,
      createdAt: new Date().toISOString().split('T')[0],
    };
    mockMaterials.push(newMaterial);
    res.status(201).json(newMaterial);
  } catch (error) {
    res.status(500).json({ error: '创建物料失败' });
  }
});

// GET /api/materials/:id - 获取单个物料
router.get('/:id', async (req, res) => {
  try {
    const material = mockMaterials.find(m => m.id === req.params.id);
    if (!material) {
      return res.status(404).json({ error: '物料不存在' });
    }
    res.json(material);
  } catch (error) {
    res.status(500).json({ error: '获取物料失败' });
  }
});

// PATCH /api/materials/:id - 更新物料
router.patch('/:id', async (req, res) => {
  try {
    const index = mockMaterials.findIndex(m => m.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: '物料不存在' });
    }
    mockMaterials[index] = { ...mockMaterials[index], ...req.body, updatedAt: new Date().toISOString().split('T')[0] };
    res.json(mockMaterials[index]);
  } catch (error) {
    res.status(500).json({ error: '更新物料失败' });
  }
});

// DELETE /api/materials/:id - 删除物料
router.delete('/:id', async (req, res) => {
  try {
    const index = mockMaterials.findIndex(m => m.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: '物料不存在' });
    }
    mockMaterials.splice(index, 1);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '删除物料失败' });
  }
});

module.exports = router;

