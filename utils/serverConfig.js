import * as Crypto from 'expo-crypto';
import storage from './storage';
import { normalizeServerUrl } from './serverAddress';

const SERVER_CONFIG_KEY = 'serverConfig.v1';
const EXPECTED_PRODUCT = '3D Manage';
const SUPPORTED_API_VERSION = '1';

export class ServerProbeError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'ServerProbeError';
    this.code = code;
    this.cause = cause;
  }
}

export const createServerKey = async (apiBaseUrl, serverId) => Crypto.digestStringAsync(
  Crypto.CryptoDigestAlgorithm.SHA256,
  `${apiBaseUrl}\n${serverId}`
);

const persistedFields = [
  'serverId',
  'apiBaseUrl',
  'organizationName',
  'initialized',
  'apiVersion',
  'serverVersion',
  'capabilities',
];

const sanitizeServer = (server) => Object.fromEntries(
  persistedFields.map((key) => [key, server[key]])
);

const hydrateServer = async (server) => ({
  ...sanitizeServer(server),
  serverKey: await createServerKey(server.apiBaseUrl, server.serverId),
});

export const loadServerConfig = async () => {
  const raw = await storage.getItem(SERVER_CONFIG_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.serverId || !parsed?.apiBaseUrl) return null;
    const apiBaseUrl = normalizeServerUrl(parsed.apiBaseUrl);
    return hydrateServer({ ...parsed, apiBaseUrl });
  } catch (error) {
    return null;
  }
};

export const saveServerConfig = async (server) => {
  const safe = sanitizeServer(server);
  if (!safe.serverId || !safe.apiBaseUrl) {
    throw new Error('Verified server metadata is required');
  }
  safe.apiBaseUrl = normalizeServerUrl(safe.apiBaseUrl);
  await storage.setItem(SERVER_CONFIG_KEY, JSON.stringify(safe));
  return hydrateServer(safe);
};

export const clearServerConfig = () => storage.deleteItem(SERVER_CONFIG_KEY);

export const probeServer = async (input, { timeoutMs = 8000, fetchImpl = fetch } = {}) => {
  const apiBaseUrl = normalizeServerUrl(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${apiBaseUrl}/system/info`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ServerProbeError(
        response.status === 503 ? 'SERVER_UNAVAILABLE' : 'SERVER_UNREACHABLE',
        response.status === 503 ? '服务器尚未准备就绪' : `服务器返回 HTTP ${response.status}`
      );
    }
    const info = await response.json();
    if (info?.product !== EXPECTED_PRODUCT) {
      throw new ServerProbeError('WRONG_PRODUCT', '该地址不是 3D Manage 服务');
    }
    if (String(info.apiVersion) !== SUPPORTED_API_VERSION) {
      throw new ServerProbeError('INCOMPATIBLE_API', `不兼容的 API 版本：${info.apiVersion || '未知'}`);
    }
    if (!info.serverId) {
      throw new ServerProbeError('INVALID_SERVER_INFO', '服务器身份信息不完整');
    }
    return hydrateServer({
      serverId: String(info.serverId),
      apiBaseUrl,
      organizationName: String(info.organizationName || ''),
      initialized: Boolean(info.initialized),
      apiVersion: String(info.apiVersion),
      serverVersion: String(info.serverVersion || ''),
      capabilities: info.capabilities && typeof info.capabilities === 'object' ? info.capabilities : {},
    });
  } catch (error) {
    if (error instanceof ServerProbeError) throw error;
    if (error?.name === 'AbortError') {
      throw new ServerProbeError('TIMEOUT', '连接服务器超时', error);
    }
    throw new ServerProbeError('SERVER_UNREACHABLE', '无法连接服务器', error);
  } finally {
    clearTimeout(timeout);
  }
};

export const SERVER_CONFIG_STORAGE_KEY = SERVER_CONFIG_KEY;
