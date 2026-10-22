'use strict';
const { recordVersion } = require('./masterDataCore.cjs');
const { validateFileAsset } = require('./relationalFilesCore.cjs');
const fail = (message, code = 'FILE_COMMAND_INVALID') => { throw Object.assign(new Error(message), { code }); };
const sameScope = (a, b) => a?.serverKey === b?.serverKey && a?.userId === b?.userId && a?.sessionEpoch === b?.sessionEpoch;
function createRelationalFileCommand({ api, createKey, getScope, onChange = () => {} }) {
  let command = null, busy = false;
  const getState = () => ({ pending: Boolean(command), busy, phase: command?.phase || 'idle', uncertain: Boolean(command?.uncertain),
    name: command?.file?.name || '', uploaded: command?.uploaded ? { ...command.uploaded } : null, scope: command ? { ...command.scope } : null });
  const changed = () => onChange(getState());
  const scopeNow = () => {
    const scope = getScope();
    if (!scope?.serverKey || !scope?.userId || !Number.isSafeInteger(scope.sessionEpoch)) fail('请重新登录后打开此页', 'BUSINESS_SESSION_REQUIRED');
    return { serverKey: scope.serverKey, userId: scope.userId, sessionEpoch: scope.sessionEpoch };
  };
  const current = () => {
    if (!command || !sameScope(command.scope, getScope())) throw Object.assign(new Error('请求所属会话已失效，请重新打开页面'), { code: 'STALE_SESSION', staleSession: true });
  };
  const parent = record => {
    if (typeof record?.id !== 'string' || !record.id.trim()) fail('缺少记录标识，请重新加载');
    const version = recordVersion(record.version);
    if (version === '9223372036854775807') fail('记录版本无效，请重新加载');
    return { id: record.id, version };
  };
  const kindFor = (entity, child) => {
    if (entity === 'models' && ['files', 'images'].includes(child)) return child === 'files' ? 'models' : 'images';
    if (entity === 'orders' && child === 'attachments') return 'attachments';
    fail('文件关联用途无效');
  };
  const execute = async () => {
    if (busy || !command) return null;
    current();
    if (command.phase === 'conflict') fail('资料已被修改，请重新加载核对后继续', 'FILE_CONFLICT_RELOAD_REQUIRED');
    busy = true; changed();
    try {
      if (command.action === 'add' && !command.uploaded) {
        command.phase = 'uploading'; changed();
        const uploaded = await api.upload(command.kind, command.file, command.uploadKey);
        current(); command.uploaded = { ...uploaded, ...command.metadata };
      }
      current(); command.phase = command.action === 'add' ? 'registering' : 'removing'; changed();
      const payload = { version: command.version, ...(command.action === 'add' ? { file: command.uploaded } : command.identity) };
      const result = await api[command.action](command.entity, command.id, command.child, payload, command.key);
      current();
      if (!result || result.id !== command.id) fail('保存结果未能确认，请重试原操作', 'FILE_SAVE_RESULT_INVALID');
      let returnedVersion;
      try { returnedVersion = recordVersion(result.version); } catch (_) { fail('保存结果未能确认，请重试原操作', 'FILE_SAVE_RESULT_INVALID'); }
      if (BigInt(returnedVersion) <= BigInt(command.version)) fail('保存结果未能确认，请重试原操作', 'FILE_SAVE_RESULT_INVALID');
      command = null;
      return result;
    } catch (error) {
      if (command) {
        command.uncertain = !(error.status >= 400 && error.status < 500);
        if (error.status === 409 && error.code === 'VERSION_CONFLICT') command.phase = 'conflict';
      }
      throw error;
    } finally { busy = false; changed(); }
  };
  const begin = (input, action) => {
    if (command || busy) fail('请先重试确认上次文件操作结果', 'FILE_RETRY_PENDING');
    const { entity, child } = input, kind = kindFor(entity, child), record = parent(input.record), scope = scopeNow();
    let identity;
    if (action === 'add') {
      validateFileAsset(kind, input.file);
      const metadata = input.metadata || {};
      if (Object.keys(metadata).some(key => !['type', 'sourceFileId'].includes(key))
          || Object.keys(metadata).length && child !== 'images'
          || metadata.type !== undefined && !['cover', 'real_print', 'auto_preview', 'other'].includes(metadata.type)
          || metadata.sourceFileId !== undefined && (typeof metadata.sourceFileId !== 'string' || !metadata.sourceFileId)) fail('图片资料无效');
    } else if (entity === 'orders') {
      if (!Number.isSafeInteger(input.position) || input.position < 0) fail('附件位置无效');
      identity = { position: input.position };
    } else {
      if (typeof input.childId !== 'string' || !input.childId) fail('文件标识无效');
      identity = { childId: input.childId };
    }
    command = { ...record, entity, child, kind, scope, action, file: input.file && (typeof Blob !== 'undefined' && input.file instanceof Blob ? input.file : { ...input.file }), metadata: { ...input.metadata }, identity,
      key: createKey(), uploadKey: action === 'add' ? createKey() : null, phase: action === 'add' ? 'uploading' : 'removing', uncertain: false };
    return execute();
  };
  return { getState, start: async input => begin(input, 'add'), remove: async input => begin(input, 'remove'), retry: execute,
    rebase(record) {
      current(); if (busy || command.phase !== 'conflict') fail('请先确认当前文件操作');
      const next = parent(record); if (next.id !== command.id) fail('不能将文件关联到其他记录');
      command.version = next.version; command.key = createKey(); command.phase = command.action === 'add' ? 'registering' : 'removing'; command.uncertain = false; changed();
    },
    cancel() {
      if (busy || command?.uncertain && sameScope(command.scope, getScope())) fail('请先重试确认上次文件操作结果', 'FILE_RETRY_PENDING');
      command = null; changed();
    },
  };
}
module.exports = { createRelationalFileCommand };
