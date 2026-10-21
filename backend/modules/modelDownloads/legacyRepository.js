'use strict';
const path = require('node:path');
const { withData, appendAudit } = require('../../utils/store');
const { verifyToken } = require('../../utils/authTokens');
function createLegacyDownloadRepository() {
  return {
    authenticate: token => withData(data => {
      try { const payload = verifyToken(token, data.system.serverId); return { actorId: String(payload.sub), tokenVersion: payload.ver }; }
      catch (_) { return null; }
    }, { write: false }),
    transaction: fn => withData(async data => {
      const state = data.system.modelDownloads ||= { policy: { enabled: false, passwordHash: null, version: '1' }, grants: {}, attempts: {} };
      return fn({
        actor: async id => { const user = data.users.find(u => u.id === id); return user && { id, role: user.role, active: user.active !== false, tokenVersion: user.tokenVersion }; },
        policy: async () => state.policy,
        assertCanEnable: async () => {
          if (data.models.some(m => (m.files || []).some(f => [f.fileUrl, f.url].some(url => url && !String(url).startsWith('/api/files/'))))
              || data.objectUploads.some(upload => upload.purpose === 'model-file' && upload.objectKey && upload.status !== 'deleted')) {
            throw Object.assign(new Error('存在外部模型地址，请先将源文件迁入受保护文件服务后再启用下载保护'), { code: 'EXTERNAL_MODELS_REQUIRE_MIGRATION', status: 409 });
          }
        },
        savePolicy: async p => { state.policy = p; },
        resource: async key => {
          const matches = f => String(f.fileKey || f.filePath || '').replaceAll('\\', '/') === key;
          const source = data.models.flatMap(m => m.files || []).find(matches), image = data.models.flatMap(m => m.images || []).find(matches);
          const upload = data.objectUploads.find(matches), attachment = data.orders.flatMap(o => o.attachments || []).find(matches);
          const file = source || upload || image || attachment;
          if (!file) return null;
          return { key, protected: Boolean(source) || key.startsWith('models/') || !((image && ['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(key).toLowerCase())) || (attachment && ['.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(key).toLowerCase()))),
            name: file.originalName || file.name || path.basename(key), size: typeof file.size === 'string' && /^\d{1,16}$/.test(file.size) ? Number(file.size) : file.size, sha256: file.sha256 };
        },
        grant: async hash => state.grants[hash],
        insertGrant: async g => { state.grants[g.hash] = g; },
        consumeGrant: async hash => { state.grants[hash].consumed = true; },
        attempts: async id => state.attempts[id],
        saveAttempts: async (id, value) => { state.attempts[id] = value; },
        prune: async time => { for (const [key, g] of Object.entries(state.grants)) if (g.expiresAt <= time) delete state.grants[key]; },
        audit: async (actorId, action, diff) => appendAudit(data, { actorId, entity: 'modelDownloads', entityId: 'default', action, diff }),
      });
    }),
  };
}
module.exports = { createLegacyDownloadRepository };
