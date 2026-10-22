import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { trackSessionFile, isAppCacheFile } from './sessionFiles';
import { isCurrentRuntime, StaleSessionError } from './serverRuntime';
import exportCore from './csvFileExportCore.cjs';

export const exportCsvFile = exportCore.createCsvFileExporter({
  platform: Platform.OS === 'web' ? 'web' : 'native',
  isCurrent: isCurrentRuntime,
  staleError: () => new StaleSessionError(),
  createDestination: name => `${FileSystem.cacheDirectory}3d-manage-csv-${Crypto.randomUUID()}-${name}`,
  isOwnedDestination: uri => isAppCacheFile(uri) && uri.startsWith(`${FileSystem.cacheDirectory}3d-manage-csv-`),
  write: (uri, content) => FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 }),
  track: trackSessionFile,
  canShare: Sharing.isAvailableAsync,
  share: (uri, name) => Sharing.shareAsync(uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: name }),
  remove: uri => FileSystem.deleteAsync(uri, { idempotent: true }),
  downloadWeb: async file => {
    if (typeof window === 'undefined' || !window.document || !window.URL?.createObjectURL) throw new Error('当前浏览器不支持下载CSV文件');
    const url = window.URL.createObjectURL(new Blob([file.content], { type: file.contentType }));
    const anchor = window.document.createElement('a');
    try {
      anchor.href = url; anchor.download = exportCore.safeCsvFilename(file.filename); anchor.style.display = 'none';
      window.document.body.appendChild(anchor); anchor.click();
    } finally { anchor.remove(); window.setTimeout(() => window.URL.revokeObjectURL(url), 1000); }
  },
});
