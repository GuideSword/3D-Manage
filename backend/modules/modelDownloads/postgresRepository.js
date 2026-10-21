'use strict';
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { withBusinessTransaction } = require('../../business-db/transaction');
function createPostgresDownloadRepository(pool) {
  return { transaction: fn => withBusinessTransaction(pool, async tx => {
    // Shared lock order: policy first, then grant. Rotation and redemption are atomic.
    const policyRow = (await tx.query("SELECT enabled,password_hash,version FROM erp.model_download_policy WHERE id='default' FOR UPDATE")).rows[0];
    if (!policyRow) throw Object.assign(new Error('下载保护配置缺失'), { code: 'DOWNLOAD_POLICY_UNAVAILABLE', status: 503 });
    return fn({
      actor: async id => {
        const row = (await tx.query('SELECT id,role,active,token_version FROM erp.users WHERE id=$1', [id])).rows[0];
        return row && { id: row.id, role: row.role, active: row.active, tokenVersion: row.token_version };
      },
      policy: async () => ({ enabled: policyRow.enabled, passwordHash: policyRow.password_hash, version: policyRow.version }),
      assertCanEnable: async () => {
        const external = await tx.query("SELECT 1 FROM erp.model_files WHERE (url IS NOT NULL AND url<>'' AND url NOT LIKE '/api/files/%') OR (metadata->>'fileUrl' IS NOT NULL AND metadata->>'fileUrl'<>'' AND metadata->>'fileUrl' NOT LIKE '/api/files/%') LIMIT 1");
        if (external.rows.length) throw Object.assign(new Error('存在外部模型地址，请先将源文件迁入受保护文件服务后再启用下载保护'), { code: 'EXTERNAL_MODELS_REQUIRE_MIGRATION', status: 409 });
      },
      savePolicy: p => tx.query("UPDATE erp.model_download_policy SET enabled=$1,password_hash=$2,version=$3 WHERE id='default'", [p.enabled, p.passwordHash, p.version]),
      resource: async key => {
        const source = (await tx.query('SELECT metadata FROM erp.model_files WHERE file_key=$1 LIMIT 1', [key])).rows[0];
        const upload = (await tx.query('SELECT metadata FROM erp.object_uploads WHERE file_key=$1 LIMIT 1', [key])).rows[0];
        const image = (await tx.query('SELECT 1 FROM erp.model_images WHERE file_key=$1 LIMIT 1', [key])).rows.length > 0;
        const attachment = (await tx.query('SELECT metadata FROM erp.order_attachments WHERE file_key=$1 LIMIT 1', [key])).rows[0];
        if (!source && !upload && !image && !attachment) return null;
        const metadata = { ...upload?.metadata, ...source?.metadata };
        return { key, protected: Boolean(source) || key.startsWith('models/') || !((image && ['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(key).toLowerCase())) || (attachment && ['.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(key).toLowerCase()))),
          name: metadata.originalName || metadata.name || path.basename(key), size: metadata.size, sha256: metadata.sha256 };
      },
      grant: async hash => {
        const row = (await tx.query('SELECT * FROM erp.model_download_grants WHERE hash=$1 FOR UPDATE', [hash])).rows[0];
        return row && { hash: row.hash, actorId: row.actor_id, tokenVersion: row.token_version, policyVersion: row.policy_version,
          fileKey: row.file_key, purpose: row.purpose, expiresAt: Number(row.expires_at), consumed: row.consumed };
      },
      insertGrant: g => tx.query('INSERT INTO erp.model_download_grants(hash,actor_id,token_version,policy_version,file_key,purpose,expires_at,consumed) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [g.hash, g.actorId, g.tokenVersion, g.policyVersion, g.fileKey, g.purpose, g.expiresAt, g.consumed]),
      consumeGrant: hash => tx.query('UPDATE erp.model_download_grants SET consumed=true WHERE hash=$1', [hash]),
      attempts: async id => { const r = (await tx.query('SELECT count,until_ms FROM erp.model_download_attempts WHERE actor_id=$1', [id])).rows[0]; return r && { count: r.count, until: Number(r.until_ms) }; },
      saveAttempts: (id, a) => tx.query('INSERT INTO erp.model_download_attempts(actor_id,count,until_ms) VALUES($1,$2,$3) ON CONFLICT(actor_id) DO UPDATE SET count=EXCLUDED.count,until_ms=EXCLUDED.until_ms', [id, a.count, a.until]),
      prune: time => tx.query('DELETE FROM erp.model_download_grants WHERE expires_at<=$1', [time]),
      audit: (id, action, diff) => tx.query('INSERT INTO erp.audit_logs(id,actor_id,entity,entity_id,action,diff) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), id, 'modelDownloads', 'default', action, JSON.stringify(diff)]),
    });
  }) };
}
module.exports = { createPostgresDownloadRepository };
