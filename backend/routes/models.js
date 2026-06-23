const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { saveFile, deleteFile, getFileUrl } = require('../config/storage');
const { withData, nextId, appendAudit, now } = require('../utils/store');
const { toCsv, fromCsv } = require('../utils/csv');
const { requireRoles } = require('../middleware/auth');

const upload = multer({
  limits: { fileSize: 500 * 1024 * 1024 },
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.stl', '.obj', '.3mf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported model format. Use STL, OBJ, or 3MF.'));
    }
  },
});

const toNumber = (value, fallback = null) => {
  if (value == null || value === '') {
    return fallback;
  }
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeModelPayload = (payload = {}, existing = null) => {
  const timestamp = now();
  const model = {
    ...(existing || {}),
    ...payload,
    name: payload.name || existing?.name || '',
    dimensions: payload.dimensions || existing?.dimensions || '',
    estimatedMaterialGrams: toNumber(payload.estimatedMaterialGrams ?? payload.estimated_material_grams, existing?.estimatedMaterialGrams || null),
    visibility: payload.visibility || existing?.visibility || 'team',
    tags: Array.isArray(payload.tags) ? payload.tags : existing?.tags || [],
    versions: Array.isArray(payload.versions) ? payload.versions : existing?.versions || [],
    notes: payload.notes || existing?.notes || '',
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  };

  model.currentVersion = payload.currentVersion || payload.current_version || existing?.currentVersion || model.versions.length || 1;
  return model;
};

const filterModels = (models, query = {}) => {
  let filteredModels = [...models];
  if (query.search) {
    const searchTerm = String(query.search).trim().toLowerCase();
    filteredModels = filteredModels.filter((model) => (
      (model.name || '').toLowerCase().includes(searchTerm)
      || (model.notes || '').toLowerCase().includes(searchTerm)
      || (model.tags || []).some((tag) => String(tag).toLowerCase().includes(searchTerm))
    ));
  }
  if (query.visibility) {
    filteredModels = filteredModels.filter((model) => model.visibility === query.visibility);
  }
  return filteredModels;
};

router.get('/export', requireRoles('owner'), async (req, res) => {
  try {
    const models = await withData((data) => {
      const filteredModels = filterModels(data.models, req.query);
      appendAudit(data, {
        entity: 'models',
        entityId: null,
        action: 'export',
        diff: { count: filteredModels.length, query: req.query },
      });
      return filteredModels;
    });

    const csv = toCsv([
      { key: 'id', label: 'id' },
      { key: 'name', label: 'name' },
      { key: 'dimensions', label: 'dimensions' },
      { key: 'estimatedMaterialGrams', label: 'estimated_material_grams' },
      { key: 'visibility', label: 'visibility' },
      { key: 'currentVersion', label: 'current_version' },
      { key: 'versionCount', label: 'version_count' },
      { key: 'createdAt', label: 'created_at' },
      { key: 'updatedAt', label: 'updated_at' },
      { key: 'notes', label: 'notes' },
    ], models.map((model) => ({
      ...model,
      versionCount: model.versions?.length || 0,
    })));

    const filename = `models-${new Date().toISOString().slice(0, 10)}.csv`;
    if (req.query.download === '1' || req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    }

    return res.json({ filename, contentType: 'text/csv', count: models.length, content: csv });
  } catch (error) {
    console.error('Export models failed:', error);
    return res.status(500).json({ error: 'Export models failed' });
  }
});

router.post('/import', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const imported = await withData((data) => {
      const incomingModels = Array.isArray(req.body.models)
        ? req.body.models
        : fromCsv(req.body.csv).map((row) => ({
          name: row.name,
          dimensions: row.dimensions,
          estimatedMaterialGrams: row.estimated_material_grams || row.estimatedMaterialGrams,
          visibility: row.visibility || 'team',
          notes: row.notes,
        }));

      const created = incomingModels.map((modelPayload) => {
        const model = normalizeModelPayload(modelPayload);
        model.id = nextId(data.models);
        if (!model.versions.length) {
          model.versions = [
            { id: '1', version: 1, notes: 'Imported metadata-only version.', createdAt: now() },
          ];
          model.currentVersion = 1;
        }
        data.models.push(model);
        return model;
      });

      appendAudit(data, {
        entity: 'models',
        entityId: null,
        action: 'import',
        diff: { count: created.length },
      });
      return created;
    });

    res.status(201).json({ imported: imported.length, items: imported });
  } catch (error) {
    console.error('Import models failed:', error);
    res.status(400).json({ error: 'Import models failed' });
  }
});

router.post('/upload', requireRoles('owner', 'staff'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { assetId } = req.body;
    const folder = assetId ? `models/${assetId}` : 'models/default';
    const result = await saveFile(req.file.buffer, req.file.originalname, folder);

    return res.json({
      success: true,
      fileKey: result.filePath,
      fileUrl: getFileUrl(result.filePath),
      sha256: result.sha256,
      size: result.size,
      originalName: req.file.originalname,
    });
  } catch (error) {
    console.error('Model upload failed:', error);
    return res.status(500).json({ error: `Model upload failed: ${error.message}` });
  }
});

router.get('/', requireRoles('owner', 'staff', 'viewer'), async (req, res) => {
  try {
    const result = await withData((data) => {
      const filteredModels = filterModels(data.models, req.query);
      const page = Number.parseInt(req.query.page, 10) || 1;
      const pageSize = Number.parseInt(req.query.pageSize, 10) || 100;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      return {
        items: filteredModels.slice(start, end),
        total: filteredModels.length,
        page,
        pageSize,
      };
    }, { write: false });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Get models failed' });
  }
});

router.post('/', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const created = await withData((data) => {
      const model = normalizeModelPayload(req.body);
      model.id = nextId(data.models);
      if (!model.versions.length) {
        model.versions = [
          { id: '1', version: 1, notes: 'Initial metadata-only version.', createdAt: now() },
        ];
        model.currentVersion = 1;
      }
      data.models.push(model);
      appendAudit(data, {
        entity: 'models',
        entityId: model.id,
        action: 'create',
        diff: model,
      });
      return model;
    });
    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: 'Create model failed' });
  }
});

router.post('/:id/versions', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const result = await withData((data) => {
      const model = data.models.find((item) => item.id === String(req.params.id));
      if (!model) {
        return { status: 404, body: { error: 'Model not found' } };
      }

      if (!Array.isArray(model.versions)) {
        model.versions = [];
      }

      const nextVersionNumber = model.versions.reduce((max, version) => {
        const number = Number.parseInt(version.version, 10);
        return Number.isFinite(number) ? Math.max(max, number) : max;
      }, 0) + 1;

      const newVersion = {
        id: nextId(model.versions),
        version: req.body.version || nextVersionNumber,
        fileKey: req.body.fileKey || req.body.file_key || '',
        fileUrl: req.body.fileUrl || req.body.file_url || '',
        fileSize: req.body.fileSize || req.body.file_size || null,
        sha256: req.body.sha256 || '',
        notes: req.body.notes || '',
        createdAt: now(),
      };

      model.versions.push(newVersion);
      model.currentVersion = newVersion.version;
      model.updatedAt = now();
      appendAudit(data, {
        entity: 'models',
        entityId: model.id,
        action: 'version.create',
        diff: newVersion,
      });

      return { status: 201, body: newVersion };
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(500).json({ error: 'Add model version failed' });
  }
});

router.get('/:id/audit', requireRoles('owner'), async (req, res) => {
  try {
    const logs = await withData((data) => data.auditLogs.filter((log) => (
      log.entity === 'models' && log.entityId === String(req.params.id)
    )), { write: false });
    res.json({ items: logs, total: logs.length });
  } catch (error) {
    res.status(500).json({ error: 'Get model audit failed' });
  }
});

router.get('/:id', requireRoles('owner', 'staff', 'viewer'), async (req, res) => {
  try {
    const model = await withData((data) => data.models.find((item) => item.id === String(req.params.id)), { write: false });
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }
    return res.json(model);
  } catch (error) {
    return res.status(500).json({ error: 'Get model failed' });
  }
});

router.patch('/:id', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const updated = await withData((data) => {
      const modelIndex = data.models.findIndex((item) => item.id === String(req.params.id));
      if (modelIndex === -1) {
        return null;
      }
      const before = data.models[modelIndex];
      const model = normalizeModelPayload(req.body, before);
      data.models[modelIndex] = model;
      appendAudit(data, {
        entity: 'models',
        entityId: model.id,
        action: 'update',
        diff: { before, after: model },
      });
      return model;
    });

    if (!updated) {
      return res.status(404).json({ error: 'Model not found' });
    }
    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: 'Update model failed' });
  }
});

router.delete('/:id', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const deleted = await withData(async (data) => {
      const modelIndex = data.models.findIndex((item) => item.id === String(req.params.id));
      if (modelIndex === -1) {
        return null;
      }

      const [model] = data.models.splice(modelIndex, 1);
      for (const version of model.versions || []) {
        if (version.fileKey) {
          try {
            await deleteFile(version.fileKey);
          } catch (error) {
            console.error('Delete model file failed:', error);
          }
        }
      }

      appendAudit(data, {
        entity: 'models',
        entityId: model.id,
        action: 'delete',
        diff: model,
      });
      return model;
    });

    if (!deleted) {
      return res.status(404).json({ error: 'Model not found' });
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Delete model failed' });
  }
});

module.exports = router;
