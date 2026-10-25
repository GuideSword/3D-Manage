'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const { withData, nextId, appendAudit, now } = require('../../utils/store');
const { saveFile, deleteFile, UPLOAD_DIR } = require('../../config/storage');
const { createModelPreview } = require('../../utils/modelPreview');
const { normalizeItem, normalizeOptions, nextState } = require('./contract');
const { queueUserAssetIndex } = require('../../agent/modelIndex');

const actorId = actor => String(actor?.id || actor?.actorId || '');
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
function createLegacyModelImportService() {
  const describe = async (actor, jobId, itemId, options = {}) => withData(async data => {
    const item = data.modelImportItems.find(i => i.jobId === String(jobId) && i.id === String(itemId) && i.actorId === actorId(actor));
    if (!item) fail('MODEL_IMPORT_ITEM_NOT_FOUND', '条目不存在', 404);
    const facts = item.descriptionFacts || `${item.originalName} (${item.byteSize} bytes)`;
    if (options.aiDescription !== true) return item;
    const provider = String(options.provider || 'cloud');
    try {
      const text = typeof options.generate === 'function' ? await options.generate({ facts, metadata: { itemId: item.id, name: item.originalName, size: item.byteSize } }) : facts;
      item.descriptionAi = { text: String(text), source: provider, model: options.model || null, generatedAt: now(), confidence: options.confidence == null ? null : Number(options.confidence) };
      appendAudit(data, { actorId: item.actorId, entity: 'modelImportItems', entityId: item.id, action: 'description', diff: { itemId: item.id, provider, status: 'completed' } });
    } catch (error) {
      appendAudit(data, { actorId: item.actorId, entity: 'modelImportItems', entityId: item.id, action: 'description', diff: { itemId: item.id, provider, status: 'failed' } });
    }
    return item;
  });
  return {
    createJob: (actor, input = {}) => withData(data => {
      const id = nextId(data.modelImportJobs); const clientJobId = String(input.clientJobId || id);
      const existing = data.modelImportJobs.find(j => j.actorId === actorId(actor) && j.clientJobId === clientJobId);
      if (existing) return existing;
      const job = { id, actorId: actorId(actor), clientJobId, state: 'draft', options: normalizeOptions(input.options || {}), createdAt: now(), updatedAt: now() };
      data.modelImportJobs.push(job); appendAudit(data, { actorId: job.actorId, entity: 'modelImportJobs', entityId: id, action: 'create' }); return job;
    }),
    prepareItem: (actor, jobId, raw) => withData(data => {
      const job = data.modelImportJobs.find(j => j.id === String(jobId) && j.actorId === actorId(actor)); if (!job) fail('MODEL_IMPORT_JOB_NOT_FOUND','任务不存在',404);
      const item = normalizeItem(raw); const duplicate = data.models.find(m => (m.files || []).some(f => f.sha256 === item.sha256));
      const existing = data.modelImportItems.find(i => i.jobId === job.id && i.id === item.itemId); if (existing) return existing;
      const row = { id:item.itemId, jobId:job.id, actorId:job.actorId, relativePath:item.relativePath, originalName:item.originalName, extension:path.extname(item.originalName).toLowerCase(), byteSize:item.size, sha256:item.sha256, state: duplicate ? 'duplicate':'queued', modelId:null, descriptionFacts:`${item.originalName} (${item.size} bytes)`, descriptionAi:null, errorCode: duplicate ? 'MODEL_IMPORT_DUPLICATE':null, createdAt:now(), updatedAt:now() };
      data.modelImportItems.push(row); return row;
    }),
    completeFile: async (actor, jobId, itemId, file) => {
      const buffer = file?.buffer || file; return withData(async data => {
        const item = data.modelImportItems.find(i => i.jobId === String(jobId) && i.id === String(itemId) && i.actorId === actorId(actor)); if (!item) fail('MODEL_IMPORT_ITEM_NOT_FOUND','条目不存在',404);
        if (item.state === 'completed') return item; if (item.state === 'duplicate') fail('MODEL_IMPORT_DUPLICATE','文件已存在',409);
        if (!Buffer.isBuffer(buffer) || buffer.length !== item.byteSize || crypto.createHash('sha256').update(buffer).digest('hex') !== item.sha256) fail('MODEL_IMPORT_HASH_MISMATCH','文件校验失败',422);
        const model = { id: nextId(data.models), name:item.originalName, description:item.descriptionFacts, files:[], images:[], import:{ jobId:item.jobId, itemId:item.id }, createdAt:now(), updatedAt:now() };
        const stored = await saveFile(buffer, item.originalName, `models/${model.id}/files`); model.files.push({ id:'1', name:item.originalName, type:item.extension.slice(1), fileKey:stored.filePath, size:stored.size, sha256:stored.sha256, createdAt:now() });
        data.models.push(model); item.modelId=model.id; item.state='completed'; item.updatedAt=now(); appendAudit(data,{actorId:item.actorId,entity:'modelImportItems',entityId:item.id,action:'completed'}); queueUserAssetIndex({ userId: item.actorId }).catch(() => {}); return item;
      });
    },
    getJob: (actor, id) => withData(data => { const job=data.modelImportJobs.find(j=>j.id===String(id)&&j.actorId===actorId(actor)); if(!job) fail('MODEL_IMPORT_JOB_NOT_FOUND','任务不存在',404); return {...job,items:data.modelImportItems.filter(i=>i.jobId===job.id)}; }, {write:false}),
    cleanupJob: (actor,id) => withData(data => { const items=data.modelImportItems.filter(i=>i.jobId===String(id)&&i.actorId===actorId(actor)); items.forEach(i=>{if(i.state!=='completed'&&i.state!=='duplicate') i.state='cleaned';}); return {cleaned:items.filter(i=>i.state==='cleaned').length}; }),
    cancelJob: (actor,id) => withData(data => { const j=data.modelImportJobs.find(x=>x.id===String(id)&&x.actorId===actorId(actor)); if(!j) fail('MODEL_IMPORT_JOB_NOT_FOUND','任务不存在',404); j.state='cancelled'; return j; }),
    describe,
  };
}
module.exports = { createLegacyModelImportService };
