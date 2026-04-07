const express = require('express');
const router = express.Router();
const { testConnection } = require('../config/oss');

// 测试 OSS 连接 (使用前端提供的临时配置)
router.post('/test-connection', async (req, res) => {
  try {
    const config = req.body; // { accessKeyId, secretAccessKey, bucket, region }
    const result = await testConnection(config);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;


