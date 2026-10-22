const { withData, appendAudit, now } = require('../utils/store');
const { normalizeOrderPayload } = require('../services/orders');
const { validateProposal } = require('./tools/updates');
const { createHash } = require('node:crypto');

const allowedTransitions = {
  draft: ['pending_review', 'cancelled'],
  pending_review: ['in_progress', 'cancelled', 'draft'],
  in_progress: ['completed', 'cancelled', 'pending_review', 'draft'],
  completed: ['in_progress', 'pending_review', 'draft', 'cancelled'],
  cancelled: ['draft'],
};

const fieldMap = {
  orders: {
    customer_name: (row) => row.customer?.name || '',
    customer_email: (row) => row.customer?.email || '',
    customer_phone: (row) => row.customer?.phone || '',
    due_date: (row) => row.dueDate || '',
    notes: (row) => row.notes || '',
    status: (row) => row.status || '',
  },
  models: {
    name: (row) => row.name || '', description: (row) => row.description || '', source: (row) => row.source || '',
  },
  materials: {
    type: (row) => row.type || '', brand: (row) => row.brand || '', diameter: (row) => row.diameter ?? '',
    color: (row) => row.color || '', density: (row) => row.density ?? '', unit_price: (row) => row.unitPrice ?? '',
    unit: (row) => row.unit || '', notes: (row) => row.notes || '',
  },
};

function findRecord(data, proposal) {
  return data[proposal.entity].find((row) => String(row.id) === proposal.id);
}

const recordVersion = (row) => createHash('sha256').update(JSON.stringify(row)).digest('hex');

async function prepareRecordUpdate(input) {
  const proposal = validateProposal(input);
  return withData((data) => {
    const row = findRecord(data, proposal);
    if (!row) throw new Error('找不到指定记录，请先查询准确 ID');
    const before = Object.fromEntries(Object.keys(proposal.changes).map((key) => [key, fieldMap[proposal.entity][key](row)]));
    return { ...proposal, before, expectedVersion: recordVersion(row) };
  }, { write: false });
}

async function confirmRecordUpdate(input, actorId) {
  const proposal = validateProposal(input);
  if (typeof input.expectedVersion !== 'string') throw Object.assign(new Error('缺少记录版本'), { status: 400 });
  return withData((data) => {
    const row = findRecord(data, proposal);
    if (!row) throw Object.assign(new Error('记录不存在'), { status: 404 });
    if (recordVersion(row) !== input.expectedVersion) {
      throw Object.assign(new Error('记录已被其他操作修改，请重新查询后再确认'), { status: 409 });
    }
    const before = JSON.parse(JSON.stringify(row));
    const changes = proposal.changes;
    let updated;
    if (proposal.entity === 'orders') {
      if (changes.status && changes.status !== row.status && !allowedTransitions[row.status]?.includes(changes.status)) {
        throw Object.assign(new Error('不允许进行该订单状态转换'), { status: 400 });
      }
      const customer = { ...row.customer };
      if (changes.customer_name !== undefined) customer.name = changes.customer_name;
      if (changes.customer_email !== undefined) customer.email = changes.customer_email;
      if (changes.customer_phone !== undefined) customer.phone = changes.customer_phone;
      updated = normalizeOrderPayload({
        customer,
        ...(changes.status !== undefined ? { status: changes.status } : {}),
        ...(changes.status !== undefined && changes.status !== row.status ? { statusReason: '' } : {}),
        ...(changes.due_date !== undefined ? { dueDate: changes.due_date } : {}),
        ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
      }, row);
    } else {
      updated = { ...row, updatedAt: now() };
      for (const [key, value] of Object.entries(changes)) {
        updated[key === 'unit_price' ? 'unitPrice' : key] = value;
        if (proposal.entity === 'materials' && key === 'type') updated.materialType = value;
      }
      if (proposal.entity === 'models' && (!updated.name?.trim() || !updated.description?.trim())) {
        throw Object.assign(new Error('模型名称和描述不能为空'), { status: 400 });
      }
    }
    const index = data[proposal.entity].indexOf(row);
    data[proposal.entity][index] = updated;
    appendAudit(data, {
      actorId: String(actorId), entity: proposal.entity, entityId: proposal.id,
      action: 'update_from_agent', diff: { before, after: updated },
    });
    return updated;
  });
}

module.exports = { prepareRecordUpdate, confirmRecordUpdate };
