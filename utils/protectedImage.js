import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { buildProtectedFileSource } from './api';
import { trackSessionFile } from './sessionFiles';
import {
  getServerRuntime,
  isCurrentRuntime,
  StaleSessionError,
} from './serverRuntime';

const nativeDownloads = new Map();
const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp)$/i;

const removeFileSilently = async (uri) => {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch (_) {
    // A later session cleanup will retry tracked cache files.
  }
};

const requireCurrentRuntime = async (captured, cleanupUris = []) => {
  if (isCurrentRuntime(captured)) return;
  await Promise.all(cleanupUris.map(removeFileSilently));
  throw new StaleSessionError();
};

const getImageExtension = (uri) => {
  try {
    const match = new URL(uri).pathname.match(IMAGE_EXTENSION);
    return match ? match[0].toLowerCase() : '.img';
  } catch (_) {
    return '.img';
  }
};

const nativeCacheUri = async (captured, remoteUri) => {
  if (!FileSystem.cacheDirectory) {
    throw new Error('应用缓存目录不可用');
  }
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${captured.serverKey}\n${captured.sessionEpoch}\n${remoteUri}`
  );
  await requireCurrentRuntime(captured);
  return `${FileSystem.cacheDirectory}3d-manage-image-${digest}${getImageExtension(remoteUri)}`;
};

const downloadNativeImage = async (captured, remoteSource) => {
  const destination = await nativeCacheUri(captured, remoteSource.uri);
  const cached = await FileSystem.getInfoAsync(destination);
  await requireCurrentRuntime(captured);
  if (cached.exists && Number(cached.size) > 0) {
    await trackSessionFile(captured.serverKey, destination);
    await requireCurrentRuntime(captured, [destination]);
    return destination;
  }
  if (cached.exists) await removeFileSilently(destination);

  const temporary = `${destination}.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  await trackSessionFile(captured.serverKey, temporary);
  await trackSessionFile(captured.serverKey, destination);
  await requireCurrentRuntime(captured, [temporary, destination]);

  try {
    const result = await FileSystem.downloadAsync(remoteSource.uri, temporary, {
      headers: remoteSource.headers || {},
    });
    if (!result || result.status < 200 || result.status >= 300) {
      throw new Error(`图片下载失败：HTTP ${result?.status || '未知'}`);
    }
    await requireCurrentRuntime(captured, [temporary, destination]);
    await removeFileSilently(destination);
    await FileSystem.moveAsync({ from: temporary, to: destination });
    await requireCurrentRuntime(captured, [destination]);
    return destination;
  } catch (error) {
    await removeFileSilently(temporary);
    if (error?.staleSession) await removeFileSilently(destination);
    throw error;
  }
};

const loadNativeImage = async (captured, remoteSource) => {
  const key = `${captured.serverKey}\n${captured.sessionEpoch}\n${remoteSource.uri}`;
  let download = nativeDownloads.get(key);
  if (!download) {
    download = downloadNativeImage(captured, remoteSource)
      .finally(() => nativeDownloads.delete(key));
    nativeDownloads.set(key, download);
  }
  const uri = await download;
  let invalidated = false;
  return {
    source: { uri },
    dispose: async () => undefined,
    invalidate: async () => {
      if (invalidated) return;
      invalidated = true;
      await removeFileSilently(uri);
    },
  };
};

const loadWebImage = async (captured, remoteSource) => {
  const response = await fetch(remoteSource.uri, {
    cache: 'no-store',
    headers: remoteSource.headers || {},
  });
  if (!response.ok) {
    throw new Error(`图片下载失败：HTTP ${response.status}`);
  }
  const blob = await response.blob();
  await requireCurrentRuntime(captured);
  const uri = URL.createObjectURL(blob);
  if (!isCurrentRuntime(captured)) {
    URL.revokeObjectURL(uri);
    throw new StaleSessionError();
  }
  let revoked = false;
  const revoke = async () => {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(uri);
  };
  return {
    source: { uri },
    dispose: revoke,
    invalidate: revoke,
  };
};

export const loadProtectedImage = async (fileUrl, token) => {
  if (!fileUrl) return null;
  const captured = getServerRuntime();
  if (!captured.serverKey || !captured.apiBaseUrl) {
    throw new Error('尚未配置服务器');
  }
  const remoteSource = buildProtectedFileSource(fileUrl, token);
  await requireCurrentRuntime(captured);
  return Platform.OS === 'web'
    ? loadWebImage(captured, remoteSource)
    : loadNativeImage(captured, remoteSource);
};
