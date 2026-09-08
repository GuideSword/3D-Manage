import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { trackSessionFile } from './sessionFiles';

export const downloadAndShareNative = async ({ url, filename, token, captured, controller, isCurrent, staleError }) => {
  const safeName = String(filename || 'download').replace(/[^\p{L}\p{N}._-]+/gu, '_');
  const destination = `${FileSystem.cacheDirectory}3d-manage-${Date.now()}-${safeName}`;
  const resumable = FileSystem.createDownloadResumable(url, destination, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const pause = () => resumable.pauseAsync().catch(() => undefined);
  controller.signal.addEventListener('abort', pause, { once: true });
  try {
    const result = await resumable.downloadAsync();
    if (!isCurrent(captured)) {
      if (result?.uri) await FileSystem.deleteAsync(result.uri, { idempotent: true });
      throw staleError();
    }
    await trackSessionFile(captured.serverKey, result.uri);
    if (!isCurrent(captured)) throw staleError();
    if (!(await Sharing.isAvailableAsync())) throw new Error('当前设备不支持导出文件');
    await Sharing.shareAsync(result.uri, { dialogTitle: filename || '导出文件' });
    return true;
  } finally {
    controller.signal.removeEventListener('abort', pause);
  }
};
