'use strict';

const path = require('node:path');

const MODEL_EXTENSIONS = Object.freeze(['.stl', '.obj', '.3mf', '.step', '.stp']);
const ZIP_EXTENSION = '.zip';
const JOB_STATES = Object.freeze(['draft', 'running', 'cancelling', 'cancelled', 'completed', 'completed_with_errors']);
const ITEM_STATES = Object.freeze(['discovered', 'queued', 'preparing', 'uploading', 'verifying', 'completed', 'duplicate', 'failed', 'cancelled', 'cleaned']);
const DEFAULT_MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

const isSupportedExtension = (value) => { const text = String(value || '').toLowerCase(); const ext = text.startsWith('.') ? text : path.extname(text); return MODEL_EXTENSIONS.includes(ext); };

const normalizeRelativePath = (value) => {
  const raw = String(value || '').replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) throw new Error('路径必须是相对路径');
  const segments = raw.split('/');
  if (segments.some((segment) => segment === '..')) throw new Error('路径不能包含 ..');
  const normalized = segments.filter((segment) => segment && segment !== '.').join('/');
  if (!normalized) throw new Error('路径不能为空');
  return normalized;
};

const normalizeItem = (input = {}) => {
  const itemId = String(input.itemId || input.id || '').trim();
  if (!itemId) throw new Error('项目 ID 无效');
  const relativePath = normalizeRelativePath(input.relativePath);
  const originalName = String(input.originalName || path.posix.basename(relativePath)).trim();
  const size = Number(input.size ?? input.byteSize);
  if (!Number.isSafeInteger(size) || size < 0 || size > (Number(process.env.MAX_UPLOAD_BYTES) || DEFAULT_MAX_UPLOAD_BYTES)) throw new Error('文件大小超出上传限制');
  const sha256 = String(input.sha256 || '');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('SHA-256 必须是 64 位小写十六进制字符串');
  const extension = path.posix.extname(originalName || relativePath).toLowerCase();
  if (!isSupportedExtension(extension)) throw new Error('不支持的模型文件格式');
  return { ...input, itemId, relativePath, originalName, size, byteSize: size, sha256, extension };
};

const normalizeOptions = (input = {}) => {
  const concurrency = Number(input.concurrency ?? 2);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('并发数必须在 1 到 4 之间');
  const maxUploadBytes = Number(input.maxUploadBytes ?? process.env.MAX_UPLOAD_BYTES ?? DEFAULT_MAX_UPLOAD_BYTES);
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes < 1) throw new Error('上传大小限制无效');
  return { aiDescription: input.aiDescription === true, concurrency, continueOnError: input.continueOnError !== false, maxUploadBytes };
};

const TRANSITIONS = {
  discovered: new Set(['queued', 'cancelled']), queued: new Set(['preparing', 'cancelled']), preparing: new Set(['uploading', 'failed', 'cancelled']),
  uploading: new Set(['verifying', 'completed', 'failed', 'cancelled']), verifying: new Set(['completed', 'duplicate', 'failed', 'cancelled']),
  failed: new Set(['queued', 'cleaned', 'cancelled']), completed: new Set(), duplicate: new Set(), cancelled: new Set(['cleaned']), cleaned: new Set(),
};
const nextState = (current, target) => {
  const normalizedTarget = target === 'verified' ? 'completed' : target;
  if (!ITEM_STATES.includes(current) || !ITEM_STATES.includes(normalizedTarget) || !TRANSITIONS[current]?.has(normalizedTarget)) throw new Error('状态转换不合法');
  return normalizedTarget;
};

module.exports = { MODEL_EXTENSIONS, ZIP_EXTENSION, JOB_STATES, ITEM_STATES, normalizeItem, normalizeOptions, isSupportedExtension, nextState };

