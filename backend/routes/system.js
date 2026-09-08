const express = require('express');
const { withData } = require('../utils/store');
const {
  API_VERSION,
  PRODUCT_NAME,
  SERVER_VERSION,
} = require('../config/runtime');

const router = express.Router();

router.get('/info', async (req, res) => {
  try {
    const info = await withData((data) => ({
      product: PRODUCT_NAME,
      serverId: data.system.serverId,
      organizationName: data.system.organizationName,
      initialized: Boolean(data.system.initializedAt),
      apiVersion: API_VERSION,
      serverVersion: SERVER_VERSION,
      capabilities: {
        agent: process.env.AGENT_ENABLED !== 'false',
        objectStorage: process.env.OSS_ENABLED === 'true',
        selfHosted: true,
      },
    }), { write: false });

    res.setHeader('Cache-Control', 'no-store');
    return res.json(info);
  } catch (error) {
    return res.status(503).json({
      code: 'STORAGE_UNAVAILABLE',
      error: 'Server storage is unavailable',
    });
  }
});

module.exports = router;
