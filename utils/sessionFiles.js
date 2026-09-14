import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import storage from './storage';
import { getServerRuntime } from './serverRuntime';

const filesKey = (serverKey) => `sessionFiles.v1.${serverKey}`;
const fileOperationQueues = new Map();
const requireServerKey = (serverKey) => {
  if (!serverKey || !/^[a-f0-9]{64}$/i.test(serverKey)) throw new Error('缺少有效的服务器标识');
};

const enqueueFileOperation = (serverKey, operation) => {
  const previous = fileOperationQueues.get(serverKey) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  fileOperationQueues.set(serverKey, current);
  return current.finally(() => {
    if (fileOperationQueues.get(serverKey) === current) {
      fileOperationQueues.delete(serverKey);
    }
  });
};

const loadTrackedFiles = async (serverKey) => {
  const raw = await storage.getItem(filesKey(serverKey));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch (_) { return []; }
};

export const isAppCacheFile = (uri) => {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory || typeof uri !== 'string') return false;
  const base = cacheDirectory.endsWith('/') ? cacheDirectory : `${cacheDirectory}/`;
  return uri.startsWith(base) && uri.length > base.length;
};

export const trackSessionFile = async (serverKey, uri) => {
  requireServerKey(serverKey);
  if (!uri || !isAppCacheFile(uri)) return;
  await enqueueFileOperation(serverKey, async () => {
    const files = await loadTrackedFiles(serverKey);
    if (!files.includes(uri)) {
      files.push(uri);
      await storage.setItem(filesKey(serverKey), JSON.stringify(files));
    }
  });
};

export const trackPickedAsset = async (asset) => {
  if (Platform.OS === 'web' || !asset?.uri || !isAppCacheFile(asset.uri)) return;
  const captured = getServerRuntime();
  if (captured.serverKey) await trackSessionFile(captured.serverKey, asset.uri);
};

export const clearTrackedFiles = async (serverKey) => {
  if (!serverKey) return;
  await enqueueFileOperation(serverKey, async () => {
    const files = await loadTrackedFiles(serverKey);
    const failures = [];
    for (const uri of files) {
      if (!isAppCacheFile(uri)) continue;
      try { await FileSystem.deleteAsync(uri, { idempotent: true }); }
      catch (error) { failures.push({ uri, error }); }
    }
    if (failures.length) throw new Error(`无法清理 ${failures.length} 个应用临时文件`);
    await storage.deleteItem(filesKey(serverKey));
  });
};
