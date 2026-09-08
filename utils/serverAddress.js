class ServerAddressError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ServerAddressError';
    this.code = code;
  }
}

const isPrivateIpv4 = (hostname) => {
  const parts = hostname.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
};

const defaultProtocol = (raw) => {
  const hostPart = raw.split('/')[0];
  const hostname = hostPart.startsWith('[')
    ? hostPart.slice(1, hostPart.indexOf(']'))
    : hostPart.split(':')[0];
  const normalized = hostname.toLowerCase();
  const privateIpv6 = normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb');
  return normalized === 'localhost' || isPrivateIpv4(normalized) || privateIpv6
    ? 'http://'
    : 'https://';
};

const normalizeServerUrl = (input) => {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new ServerAddressError('SERVER_ADDRESS_REQUIRED', '请输入服务器地址');
  }

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(raw)
    ? raw
    : `${defaultProtocol(raw)}${raw}`;

  let url;
  try {
    url = new URL(withProtocol);
  } catch (error) {
    throw new ServerAddressError('SERVER_ADDRESS_INVALID', '服务器地址格式无效');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ServerAddressError('SERVER_SCHEME_UNSUPPORTED', '服务器地址只支持 HTTP 或 HTTPS');
  }
  if (!url.hostname) {
    throw new ServerAddressError('SERVER_HOST_REQUIRED', '服务器地址缺少主机名');
  }
  if (url.username || url.password) {
    throw new ServerAddressError('SERVER_CREDENTIALS_FORBIDDEN', '服务器地址不能包含账号或密码');
  }
  if (url.search || url.hash) {
    throw new ServerAddressError('SERVER_URL_SUFFIX_FORBIDDEN', '服务器地址不能包含查询参数或片段');
  }
  if (!['', '/', '/api', '/api/'].includes(url.pathname)) {
    throw new ServerAddressError('SERVER_PATH_UNSUPPORTED', '当前版本仅支持服务器根路径或 /api');
  }

  return `${url.protocol}//${url.host}/api`;
};

module.exports = {
  ServerAddressError,
  normalizeServerUrl,
};
