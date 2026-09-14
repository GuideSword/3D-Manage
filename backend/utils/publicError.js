'use strict';

const STARTS_WITH_CHINESE = /^\s*\p{Script=Han}/u;

const publicErrorMessage = (error, fallback) => {
  if (error?.code === 'LIMIT_FILE_SIZE') return '上传文件超过大小限制';
  const message = String(error?.message || '').trim();
  return STARTS_WITH_CHINESE.test(message) ? message : fallback;
};

module.exports = { publicErrorMessage };
