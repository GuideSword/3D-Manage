'use strict';
const { csvImportPayload } = require('./relationalCsvCore.cjs');
// Android DocumentsProvider commonly reports .csv as text/comma-separated-values.
const CSV_MIME_TYPES = Object.freeze(['text/csv', 'text/comma-separated-values', 'application/csv', 'text/plain', 'application/vnd.ms-excel']);
function createScopedCsvReader({ pick, isCurrent, staleError, isOwned, read, track, remove }) {
  return async captured => {
    let asset;
    const check = () => { if (!captured?.serverKey || !isCurrent(captured)) throw staleError(); };
    try {
      check(); const result = await pick();
      if (result.canceled) return null;
      asset = result.assets?.[0]; check();
      if (!asset?.uri || typeof asset.name !== 'string' || !/\.(csv|txt)$/i.test(asset.name)) throw new Error('请选择CSV或TXT文件');
      const csv = await read(asset); check(); csvImportPayload({ csv });
      if (isOwned(asset.uri)) { await track(captured.serverKey, asset.uri); check(); }
      return { csv, filename: asset.name };
    } catch (error) {
      if (asset?.uri && isOwned(asset.uri)) { try { await remove(asset.uri); } catch (_) { error.cleanupError = true; } }
      throw error;
    }
  };
}
module.exports = { createScopedCsvReader, CSV_MIME_TYPES };
