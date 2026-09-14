'use strict';

const STARTS_WITH_CHINESE = /^\s*\p{Script=Han}/u;
const NETWORK_ERROR = /failed to fetch|network request failed|networkerror|load failed|network error/i;

const asError = (value) => {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : '');
};

const localizeTransportError = (value, {
  timedOut = false,
  fallback = '请求失败，请稍后重试',
} = {}) => {
  const error = asError(value);
  if (STARTS_WITH_CHINESE.test(String(error.message || ''))) return error;

  if (error.name === 'AbortError') {
    error.message = timedOut ? '请求超时，请稍后重试' : '请求已取消';
    return error;
  }

  if (NETWORK_ERROR.test(String(error.message || '')) || error instanceof TypeError) {
    error.message = '网络连接失败，请检查网络设置';
    return error;
  }

  error.message = fallback;
  return error;
};

module.exports = { localizeTransportError };
