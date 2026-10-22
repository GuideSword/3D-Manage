import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { trackSessionFile } from './sessionFiles';

export const downloadAndShareNative = async ({ url, filename, token, headers = {}, captured, controller, isCurrent, staleError, onUnauthorized }) => {
  const safeName = String(filename || 'download').replace(/[^\p{L}\p{N}._-]+/gu, '_');
  const destination = `${FileSystem.cacheDirectory}3d-manage-${Date.now()}-${safeName}`;
  const resumable = FileSystem.createDownloadResumable(url, destination, {
    headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const pause = () => resumable.pauseAsync().catch(() => undefined);
  const assertCurrent = () => {
    if (!isCurrent(captured)) throw staleError();
    if (controller.signal.aborted) throw Object.assign(new Error('下载已取消'), { name: 'AbortError', code: 'FILE_DOWNLOAD_CANCELLED' });
  };
  const invalid = () => { throw Object.assign(new Error('未能确认完整下载文件，请重试'), { code: 'FILE_DOWNLOAD_INVALID' }); };
  controller.signal.addEventListener('abort', pause, { once: true });
  try {
    assertCurrent();
    const result = await resumable.downloadAsync();
    assertCurrent();
    if (result && Number.isInteger(result.status) && result.status !== 200) {
      const message = result.status === 401 && onUnauthorized ? '登录状态已失效，请重新登录'
        : result.status === 403 ? '当前账号无权下载该文件' : result.status === 404 ? '文件不存在或已移除' : '未能下载完整文件，请稍后重试';
      const error = Object.assign(new Error(message), { status: result.status, code: 'FILE_DOWNLOAD_HTTP_ERROR' });
      if (result.status === 401 && onUnauthorized) { error.authRequired = true; await onUnauthorized(); }
      throw error;
    }
    if (!result || result.status !== 200 || typeof result.uri !== 'string') invalid();
    let sameFile = false;
    try { sameFile = decodeURIComponent(result.uri) === decodeURIComponent(destination); } catch (_) { /* Invalid native URI. */ }
    if (!sameFile) invalid();
    const info = await FileSystem.getInfoAsync(destination).catch(() => null);
    assertCurrent();
    if (!info?.exists || info.isDirectory || !Number.isSafeInteger(info.size) || info.size < 1) invalid();
    await trackSessionFile(captured.serverKey, destination);
    assertCurrent();
    if (!(await Sharing.isAvailableAsync())) throw new Error('当前设备不支持导出文件');
    assertCurrent();
    await Sharing.shareAsync(destination, { dialogTitle: filename || '导出文件' });
    return true;
  } catch (error) {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
    throw error;
  } finally {
    controller.signal.removeEventListener('abort', pause);
  }
};
