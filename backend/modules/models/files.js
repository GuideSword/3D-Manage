'use strict';
const { verifyUploadedFile, fileMetadata } = require('../catalog/files');
const v = require('../catalog/validation');
const TABLES = new Set(['model_files', 'model_images']);
function tableName(table) { if (!TABLES.has(table)) v.fail('文件集合无效'); return table; }
async function listChildren(tx, modelId, table) {
  const rows = (await tx.query(`SELECT id,position,file_key,url,metadata::text AS metadata_raw FROM erp.${tableName(table)} WHERE model_id=$1 ORDER BY position`, [modelId])).rows;
  return rows.map(row => {
    return { ...fileMetadata(row.metadata_raw), id: row.id, position: row.position, fileKey: row.file_key, fileUrl: row.url };
  });
}
async function addChild(tx, modelId, table, file, uploadDirectory) {
  const metadata = await verifyUploadedFile(file, uploadDirectory);
  if (file.sourceFileId != null && file.sourceFileId !== '') {
    const source = await tx.query('SELECT 1 FROM erp.model_files WHERE model_id=$1 AND id=$2', [modelId, v.id(file.sourceFileId)]);
    if (!source.rows.length) v.fail('源模型文件不存在', 'FILE_SOURCE_NOT_FOUND', 404);
  }
  const position = (await tx.query(`SELECT coalesce(max(position),-1)+1 AS position FROM erp.${tableName(table)} WHERE model_id=$1`, [modelId])).rows[0].position;
  await tx.query(`INSERT INTO erp.${tableName(table)}(model_id,id,position,file_key,url,metadata) VALUES($1,$2,$3,$4,$5,$6)`,
    [modelId, metadata.id, position, metadata.fileKey, metadata.fileUrl, JSON.stringify(metadata)]);
  return metadata;
}
async function removeChild(tx, modelId, table, childId) {
  if (table === 'model_files') {
    const referenced = (await tx.query(`SELECT 1 FROM erp.model_images WHERE model_id=$1
      AND coalesce(metadata->>'sourceFileId',metadata->>'source_file_id')=$2 LIMIT 1`, [modelId, v.id(childId)])).rows.length;
    if (referenced) v.fail('已有预览图片引用该文件，请先移除对应图片', 'ENTITY_REFERENCED', 409);
  }
  const row = (await tx.query(`DELETE FROM erp.${tableName(table)} WHERE model_id=$1 AND id=$2 RETURNING id,file_key`, [modelId, v.id(childId)])).rows[0];
  if (!row) v.fail('文件或图片不存在', 'ENTITY_NOT_FOUND', 404);
  // Physical content may still be referenced by other models or historic snapshots.
  return { id: row.id, fileKey: row.file_key };
}
module.exports = { listChildren, addChild, removeChild };
