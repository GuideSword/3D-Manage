const express = require('express');
const router = express.Router();
const { withData, nextId, appendAudit, now } = require('../utils/store');
const { toCsv, fromCsv } = require('../utils/csv');
const { requireRoles } = require('../middleware/auth');

const toNumber = (value, fallback = null) => {
  if (value == null || value === '') {
    return fallback;
  }
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeMaterialPayload = (payload = {}, existing = null) => {
  const timestamp = now();
  return {
    ...(existing || {}),
    ...payload,
    type: payload.type || payload.materialType || existing?.type || '',
    materialType: payload.materialType || payload.type || existing?.materialType || existing?.type || '',
    brand: payload.brand || existing?.brand || '',
    diameter: toNumber(payload.diameter ?? payload.diameter_mm, existing?.diameter || 1.75),
    color: payload.color || existing?.color || '',
    density: toNumber(payload.density, existing?.density || null),
    unitPrice: toNumber(payload.unitPrice ?? payload.unit_price, existing?.unitPrice || null),
    unit: payload.unit || existing?.unit || 'kg',
    notes: payload.notes || existing?.notes || '',
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  };
};

const filterMaterials = (materials, query = {}) => {
  let filteredMaterials = [...materials];

  if (query.search) {
    const searchTerm = String(query.search).trim().toLowerCase();
    if (searchTerm) {
      filteredMaterials = filteredMaterials.filter((material) => {
        const type = String(material.type || material.materialType || '').toLowerCase();
        const brand = String(material.brand || '').toLowerCase();
        const color = String(material.color || '').toLowerCase();
        const notes = String(material.notes || '').toLowerCase();
        return type.includes(searchTerm)
          || brand.includes(searchTerm)
          || color.includes(searchTerm)
          || notes.includes(searchTerm);
      });
    }
  }

  if (query.type) {
    filteredMaterials = filteredMaterials.filter((material) => (
      (material.type || material.materialType) === query.type
    ));
  }

  return filteredMaterials;
};

router.get('/export', requireRoles('owner'), async (req, res) => {
  try {
    const materials = await withData((data) => {
      const filteredMaterials = filterMaterials(data.materials, req.query);
      appendAudit(data, {
        entity: 'materials',
        entityId: null,
        action: 'export',
        diff: { count: filteredMaterials.length, query: req.query },
      });
      return filteredMaterials;
    });

    const csv = toCsv([
      { key: 'id', label: 'id' },
      { key: 'type', label: 'type' },
      { key: 'brand', label: 'brand' },
      { key: 'diameter', label: 'diameter' },
      { key: 'color', label: 'color' },
      { key: 'density', label: 'density' },
      { key: 'unitPrice', label: 'unit_price' },
      { key: 'unit', label: 'unit' },
      { key: 'createdAt', label: 'created_at' },
      { key: 'updatedAt', label: 'updated_at' },
      { key: 'notes', label: 'notes' },
    ], materials);

    const filename = `materials-${new Date().toISOString().slice(0, 10)}.csv`;
    if (req.query.download === '1' || req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    }

    return res.json({ filename, contentType: 'text/csv', count: materials.length, content: csv });
  } catch (error) {
    console.error('Export materials failed:', error);
    return res.status(500).json({ error: 'Export materials failed' });
  }
});

router.post('/import', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const imported = await withData((data) => {
      const incomingMaterials = Array.isArray(req.body.materials)
        ? req.body.materials
        : fromCsv(req.body.csv).map((row) => ({
          type: row.type || row.material_type,
          brand: row.brand,
          diameter: row.diameter || row.diameter_mm,
          color: row.color,
          density: row.density,
          unitPrice: row.unit_price || row.unitPrice,
          unit: row.unit || 'kg',
          notes: row.notes,
        }));

      const created = incomingMaterials.map((materialPayload) => {
        const material = normalizeMaterialPayload(materialPayload);
        material.id = nextId(data.materials);
        data.materials.push(material);
        return material;
      });

      appendAudit(data, {
        entity: 'materials',
        entityId: null,
        action: 'import',
        diff: { count: created.length },
      });
      return created;
    });

    res.status(201).json({ imported: imported.length, items: imported });
  } catch (error) {
    console.error('Import materials failed:', error);
    res.status(400).json({ error: 'Import materials failed' });
  }
});

router.get('/', requireRoles('owner', 'staff', 'viewer'), async (req, res) => {
  try {
    const result = await withData((data) => {
      const filteredMaterials = filterMaterials(data.materials, req.query);
      const page = Number.parseInt(req.query.page, 10) || 1;
      const pageSize = Number.parseInt(req.query.pageSize, 10) || 100;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      return {
        items: filteredMaterials.slice(start, end),
        total: filteredMaterials.length,
        page,
        pageSize,
      };
    }, { write: false });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Get materials failed' });
  }
});

router.post('/', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const created = await withData((data) => {
      const material = normalizeMaterialPayload(req.body);
      material.id = nextId(data.materials);
      data.materials.push(material);
      appendAudit(data, {
        entity: 'materials',
        entityId: material.id,
        action: 'create',
        diff: material,
      });
      return material;
    });
    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: 'Create material failed' });
  }
});

router.get('/:id/audit', requireRoles('owner'), async (req, res) => {
  try {
    const logs = await withData((data) => data.auditLogs.filter((log) => (
      log.entity === 'materials' && log.entityId === String(req.params.id)
    )), { write: false });
    res.json({ items: logs, total: logs.length });
  } catch (error) {
    res.status(500).json({ error: 'Get material audit failed' });
  }
});

router.get('/:id', requireRoles('owner', 'staff', 'viewer'), async (req, res) => {
  try {
    const material = await withData((data) => data.materials.find((item) => item.id === String(req.params.id)), { write: false });
    if (!material) {
      return res.status(404).json({ error: 'Material not found' });
    }
    return res.json(material);
  } catch (error) {
    return res.status(500).json({ error: 'Get material failed' });
  }
});

router.patch('/:id', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const updated = await withData((data) => {
      const materialIndex = data.materials.findIndex((item) => item.id === String(req.params.id));
      if (materialIndex === -1) {
        return null;
      }

      const before = data.materials[materialIndex];
      const material = normalizeMaterialPayload(req.body, before);
      data.materials[materialIndex] = material;
      appendAudit(data, {
        entity: 'materials',
        entityId: material.id,
        action: 'update',
        diff: { before, after: material },
      });
      return material;
    });

    if (!updated) {
      return res.status(404).json({ error: 'Material not found' });
    }
    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: 'Update material failed' });
  }
});

router.delete('/:id', requireRoles('owner', 'staff'), async (req, res) => {
  try {
    const deleted = await withData((data) => {
      const materialIndex = data.materials.findIndex((item) => item.id === String(req.params.id));
      if (materialIndex === -1) {
        return null;
      }

      const [material] = data.materials.splice(materialIndex, 1);
      const relatedLots = data.stockLots.filter((lot) => String(lot.materialId || lot.material_id) === String(material.id));
      data.stockLots = data.stockLots.filter((lot) => String(lot.materialId || lot.material_id) !== String(material.id));

      appendAudit(data, {
        entity: 'materials',
        entityId: material.id,
        action: 'delete',
        diff: { material, removedStockLots: relatedLots.length },
      });
      return material;
    });

    if (!deleted) {
      return res.status(404).json({ error: 'Material not found' });
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Delete material failed' });
  }
});

module.exports = router;
