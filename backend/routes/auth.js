const express = require('express');
const router = express.Router();

// 临时模拟认证（后续实现JWT）
router.post('/login', async (req, res) => {
  try {
    // TODO: 实现真实的登录逻辑
    const { email, password } = req.body;
    // 临时返回token
    res.json({
      token: 'mock_jwt_token_' + Date.now(),
      user: { id: '1', email, name: 'Test User', role: 'owner' },
    });
  } catch (error) {
    res.status(500).json({ error: '登录失败' });
  }
});

router.post('/register', async (req, res) => {
  try {
    // TODO: 实现注册逻辑
    res.json({ message: '注册功能开发中' });
  } catch (error) {
    res.status(500).json({ error: '注册失败' });
  }
});

module.exports = router;

