const express = require('express');
const router = express.Router();
const {
  testConnection,
  generateUploadUrl,
  generateDownloadUrl,
  completeUpload,
  deleteObject,
} = require('../config/oss');
const { requireRoles } = require('../middleware/auth');

router.post('/test-connection', requireRoles('owner'), async (req, res) => {
  try {
    const result = await testConnection(req.body, {
      skipNetwork: req.body.skipNetwork === true,
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/upload-url', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const { objectKey, expire, config } = req.body;
    const result = await generateUploadUrl(objectKey, expire, config || req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/download-url', requireRoles('owner', 'staff', 'viewer'), async (req, res) => {
  try {
    const { objectKey, expire, config } = req.body;
    const result = await generateDownloadUrl(objectKey, expire, config || req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/complete-upload', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const { objectKey, config } = req.body;
    const result = await completeUpload(objectKey, config || req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/object', requireRoles('owner'), async (req, res) => {
  try {
    const { objectKey, config } = req.body;
    const result = await deleteObject(objectKey, config || req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
