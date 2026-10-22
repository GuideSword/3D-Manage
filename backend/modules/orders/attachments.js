'use strict';
const { verifyUploadedFile } = require('../catalog/files');
const v = require('../catalog/validation');
async function addAttachment(tx, orderId, file, uploadDirectory) {
  const metadata = await verifyUploadedFile(file, uploadDirectory);
  const position = (await tx.query('SELECT coalesce(max(position),-1)+1 AS n FROM erp.order_attachments WHERE order_id=$1', [orderId])).rows[0].n;
  await tx.query('INSERT INTO erp.order_attachments(order_id,position,file_key,original_name,metadata) VALUES($1,$2,$3,$4,$5)',
    [orderId, position, metadata.fileKey, v.string(metadata.originalName ?? metadata.name, { max: 1000 }), JSON.stringify(metadata)]);
  return { id: metadata.id, position, fileKey: metadata.fileKey, sha256: metadata.sha256 };
}
async function removeAttachment(tx, orderId, position) {
  if (!Number.isSafeInteger(position) || position < 0) v.fail('附件位置无效');
  const row = (await tx.query('DELETE FROM erp.order_attachments WHERE order_id=$1 AND position=$2 RETURNING position,file_key', [orderId, position])).rows[0];
  if (!row) v.fail('附件不存在', 'ENTITY_NOT_FOUND', 404);
  return { position: row.position, fileKey: row.file_key };
}
module.exports = { addAttachment, removeAttachment };
