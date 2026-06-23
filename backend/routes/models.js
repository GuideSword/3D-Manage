const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { saveFile, deleteFile, getFileUrl } = require('../config/storage');
const { withData, nextId, appendAudit, now } = require('../utils/store');
const { toCsv, fromCsv } = require('../utils/csv');
const { createModelPreview } = require('../utils/modelPreview');
const { requireRoles } = require('../middleware/auth');

const MODEL_EXTENSIONS = new Set(['.stl', '.obj', '.3mf', '.step', '.stp', '.zip']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const SOURCE_VALUES = new Set(['original', 'remix', 'imported']);
const IMAGE_TYPES = new Set(['cover', 'real_print', 'other']);

const createUpload = ({ allowedExtensions, maxFileSizeMb, errorMessage }) => multer({
  limits: { fileSize: maxFileSizeMb * 1024 * 1024 },
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.has(ext)) {
      cb(null, true);
    } else {
      const error = new Error(errorMessage);
      error.status = 400;
      cb(error);
    }
  },
});

const modelFileUpload = createUpload({
  allowedExtensions: MODEL_EXTENSIONS,
  maxFileSizeMb: 500,
  errorMessage: 'Unsupported model format. Use STL, OBJ, 3MF, STEP, STP, or ZIP.',
});

const imageUpload = createUpload({
  allowedExtensions: IMAGE_EXTENSIONS,
  maxFileSizeMb: 25,
  errorMessage: 'Unsupported image format. Use JPG, PNG, or WEBP.',
});

const asString = (value) => (value == null ? '' : String(value).trim());

const normalizeSource = (source, fallback = '') => {
  const normalized = asString(source || fallback).toLowerCase();
  return SOURCE_VALUES.has(normalized) ? normalized : '';
};

const getFileType = (filename = '') => path.extname(filename).replace('.', '').toLowerCase();

const nextChildId = (items = []) => nextId(items);

const recoverUtf8Filename = (filename = '') => {
  const value = asString(filename);
  if (!value) {
    return 'upload';
  }

  const looksLikeLatin1Mojibake = /[\u00c0-\u00ff]/.test(value) && !/[\u4e00-\u9fff]/.test(value);
  if (!looksLikeLatin1Mojibake) {
    return value;
  }

  try {
    const recovered = Buffer.from(value, 'latin1').toString('utf8');
    if (recovered && !recovered.includes('\uFFFD')) {
      return recovered;
    }
  } catch (error) {
    // Keep the original value when it is not latin1 mojibake.
  }

  return value;
};

const getUploadedOriginalName = (req, file) => (
  asString(req.body.originalName || req.body.original_name)
  || recoverUtf8Filename(file?.originalname)
);

const normalizeFileRecord = (file = {}) => ({
  id: asString(file.id),
  name: asString(file.name || file.originalName),
  type: asString(file.type || getFileType(file.name || file.originalName)),
  fileKey: asString(file.fileKey || file.file_key),
  fileUrl: asString(file.fileUrl || file.file_url),
  size: file.size ?? file.fileSize ?? file.file_size ?? null,
  sha256: asString(file.sha256),
  createdAt: file.createdAt || file.created_at || now(),
});

const normalizeImageRecord = (image = {}) => ({
  id: asString(image.id),
  name: asString(image.name || image.originalName),
  type: asString(image.type || 'other'),
  fileKey: asString(image.fileKey || image.file_key),
  fileUrl: asString(image.fileUrl || image.file_url),
  size: image.size ?? image.fileSize ?? image.file_size ?? null,
  sha256: asString(image.sha256),
  sourceFileId: image.sourceFileId || image.source_file_id || null,
  createdAt: image.createdAt || image.created_at || now(),
});

const normalizeModelPayload = (payload = {}, existing = null) => {
  const timestamp = now();
  const files = Array.isArray(payload.files)
    ? payload.files.map(normalizeFileRecord)
    : existing?.files || [];
  const images = Array.isArray(payload.images)
    ? payload.images.map(normalizeImageRecord)
    : existing?.images || [];

  return {
    ...(existing || {}),
    id: existing?.id || payload.id,
    name: asString(payload.name ?? existing?.name),
    description: asString(payload.description ?? existing?.description),
    source: normalizeSource(payload.source, existing?.source || 'original'),
    files,
    images,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  };
};

const validateModel = (model) => {
  if (!model.name) {
    return 'Model name is required';
  }
  if (!model.description) {
    return 'Model description is required';
  }
  if (!SOURCE_VALUES.has(model.source)) {
    return 'Model source must be original, remix, or imported';
  }
  return null;
};

const filterModels = (models, query = {}) => {
  let filteredModels = [...models];
  if (query.search) {
    const searchTerm = String(query.search).trim().toLowerCase();
    filteredModels = filteredModels.filter((model) => (
      (model.name || '').toLowerCase().includes(searchTerm)
      || (model.description || '').toLowerCase().includes(searchTerm)
      || (model.source || '').toLowerCase().includes(searchTerm)
      || (model.files || []).some((file) => (file.name || '').toLowerCase().includes(searchTerm))
    ));
  }
  if (query.source) {
    filteredModels = filteredModels.filter((model) => model.source === query.source);
  }
  return filteredModels;
};

const toPublicModel = (model) => ({
  id: model.id,
  name: model.name,
  description: model.description,
  source: model.source,
  files: model.files || [],
  images: model.images || [],
  createdAt: model.createdAt,
  updatedAt: model.updatedAt,
});

const findModel = (data, id) => data.models.find((item) => item.id === String(id));

const appendStoredFile = ({ model, uploadResult, originalName }) => {
  const record = normalizeFileRecord({
    id: nextChildId(model.files),
    name: originalName,
    type: getFileType(originalName),
    fileKey: uploadResult.filePath,
    fileUrl: getFileUrl(uploadResult.filePath),
    size: uploadResult.size,
    sha256: uploadResult.sha256,
    createdAt: now(),
  });
  model.files.push(record);
  return record;
};

const appendStoredImage = ({ model, uploadResult, originalName, type, sourceFileId = null }) => {
  const record = normalizeImageRecord({
    id: nextChildId(model.images),
    name: originalName,
    type,
    fileKey: uploadResult.filePath,
    fileUrl: getFileUrl(uploadResult.filePath),
    size: uploadResult.size,
    sha256: uploadResult.sha256,
    sourceFileId,
    createdAt: now(),
  });
  model.images.push(record);
  return record;
};

const deleteModelAssets = async (model) => {
  const fileKeys = [
    ...(model.files || []).map((file) => file.fileKey),
    ...(model.images || []).map((image) => image.fileKey),
  ].filter(Boolean);

  for (const fileKey of fileKeys) {
    try {
      await deleteFile(fileKey);
    } catch (error) {
      console.error('Delete model asset failed:', error);
    }
  }
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
      { key: 'description', label: 'description' },
      { key: 'source', label: 'source' },
      { key: 'fileCount', label: 'file_count' },
      { key: 'imageCount', label: 'image_count' },
      { key: 'createdAt', label: 'created_at' },
      { key: 'updatedAt', label: 'updated_at' },
    ], models.map((model) => ({
      ...model,
      fileCount: model.files?.length || 0,
      imageCount: model.images?.length || 0,
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
          description: row.description,
          source: row.source || 'original',
        }));

      const created = [];
      for (const modelPayload of incomingModels) {
        const model = normalizeModelPayload(modelPayload);
        const validationError = validateModel(model);
        if (validationError) {
          throw new Error(validationError);
        }
        model.id = nextId(data.models);
        data.models.push(model);
        created.push(model);
      }

      appendAudit(data, {
        entity: 'models',
        entityId: null,
        action: 'import',
        diff: { count: created.length },
      });
      return created;
    });

    res.status(201).json({ imported: imported.length, items: imported.map(toPublicModel) });
  } catch (error) {
    console.error('Import models failed:', error);
    res.status(400).json({ error: error.message || 'Import models failed' });
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
        items: filteredModels.slice(start, end).map(toPublicModel),
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
    const result = await withData((data) => {
      const model = normalizeModelPayload(req.body);
      const validationError = validateModel(model);
      if (validationError) {
        return { status: 400, body: { error: validationError } };
      }

      model.id = nextId(data.models);
      data.models.push(model);
      appendAudit(data, {
        entity: 'models',
        entityId: model.id,
        action: 'create',
        diff: model,
      });
      return { status: 201, body: toPublicModel(model) };
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(500).json({ error: 'Create model failed' });
  }
});

router.post('/:id/files', requireRoles('owner', 'staff'), modelFileUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const result = await withData(async (data) => {
      const model = findModel(data, req.params.id);
      if (!model) {
        return { status: 404, body: { error: 'Model not found' } };
      }

      model.files = Array.isArray(model.files) ? model.files : [];
      model.images = Array.isArray(model.images) ? model.images : [];

      const originalName = getUploadedOriginalName(req, req.file);
      const folder = `models/${model.id}/files`;
      const uploadResult = await saveFile(req.file.buffer, originalName, folder);
      const file = appendStoredFile({
        model,
        uploadResult,
        originalName,
      });

      let previewImage = null;
      let previewWarning = null;
      try {
        const preview = await createModelPreview({
          fileBuffer: req.file.buffer,
          originalName,
          fullPath: uploadResult.fullPath,
        });
        if (preview?.buffer) {
          const previewName = `${path.basename(originalName, path.extname(originalName))}-preview.${preview.extension}`;
          const previewResult = await saveFile(preview.buffer, previewName, `models/${model.id}/images`);
          previewImage = appendStoredImage({
            model,
            uploadResult: previewResult,
            originalName: previewName,
            type: 'auto_preview',
            sourceFileId: file.id,
          });
        }
      } catch (error) {
        previewWarning = error.message || 'Preview generation failed';
        console.warn('Model preview generation failed:', error);
      }

      model.updatedAt = now();
      appendAudit(data, {
        entity: 'models',
        entityId: model.id,
        action: 'file.create',
        diff: { file, previewImage, previewWarning },
      });

      return {
        status: 201,
        body: {
          file,
          previewImage,
          ...(previewWarning ? { previewWarning } : {}),
        },
      };
    });

    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Model file upload failed:', error);
    return res.status(500).json({ error: `Model file upload failed: ${error.message}` });
  }
});

router.post('/:id/images', requireRoles('owner', 'staff'), imageUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const imageType = asString(req.body.type || 'other');
    if (!IMAGE_TYPES.has(imageType)) {
      return res.status(400).json({ error: 'Image type must be cover, real_print, or other' });
    }

    const result = await withData(async (data) => {
      const model = findModel(data, req.params.id);
      if (!model) {
        return { status: 404, body: { error: 'Model not found' } };
      }

      model.images = Array.isArray(model.images) ? model.images : [];

      const originalName = getUploadedOriginalName(req, req.file);
      const uploadResult = await saveFile(req.file.buffer, originalName, `models/${model.id}/images`);
      const image = appendStoredImage({
        model,
        uploadResult,
        originalName,
        type: imageType,
      });

      model.updatedAt = now();
      appendAudit(data, {
        entity: 'models',
        entityId: model.id,
        action: 'image.create',
        diff: image,
      });

      return { status: 201, body: { image } };
    });

    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Model image upload failed:', error);
    return res.status(500).json({ error: `Model image upload failed: ${error.message}` });
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
    const model = await withData((data) => findModel(data, req.params.id), { write: false });
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }
    return res.json(toPublicModel(model));
  } catch (error) {
    return res.status(500).json({ error: 'Get model failed' });
  }
});

router.patch('/:id', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const result = await withData((data) => {
      const modelIndex = data.models.findIndex((item) => item.id === String(req.params.id));
      if (modelIndex === -1) {
        return { status: 404, body: { error: 'Model not found' } };
      }

      const before = data.models[modelIndex];
      const model = normalizeModelPayload(req.body, before);
      const validationError = validateModel(model);
      if (validationError) {
        return { status: 400, body: { error: validationError } };
      }

      data.models[modelIndex] = model;
      appendAudit(data, {
        entity: 'models',
        entityId: model.id,
        action: 'update',
        diff: { before, after: model },
      });
      return { status: 200, body: toPublicModel(model) };
    });

    return res.status(result.status).json(result.body);
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
      await deleteModelAssets(model);

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
