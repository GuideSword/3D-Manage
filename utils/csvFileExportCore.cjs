'use strict';
const { validateCsvExport } = require('./relationalCsvCore.cjs');
const safeCsvFilename = filename => filename.replace(/[^\p{L}\p{N}._-]+/gu, '_');
function createCsvFileExporter(dependencies) {
  const { platform, isCurrent, staleError, createDestination, isOwnedDestination, write, track, canShare, share, remove, downloadWeb } = dependencies;
  return async (input, captured) => {
    const file = validateCsvExport(input);
    const check = () => { if (!captured?.serverKey || !isCurrent(captured)) throw staleError(); };
    check();
    if (platform === 'web') { await downloadWeb(file); return true; }
    const filename = safeCsvFilename(file.filename), uri = createDestination(filename);
    if (!isOwnedDestination(uri)) throw new Error('导出文件必须保存在应用缓存内');
    try {
      await write(uri, file.content); check();
      await track(captured.serverKey, uri); check();
      if (!await canShare()) throw new Error('当前设备不支持分享CSV文件');
      check();
      await share(uri, filename);
      return true;
    } catch (error) {
      try { await remove(uri); } catch (_) { error.cleanupError = true; }
      throw error;
    }
  };
}
module.exports = { createCsvFileExporter, safeCsvFilename };
