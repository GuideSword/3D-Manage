'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  discardPreparedImages,
  prepareMessageImages,
  readOwnedAttachment,
} = require('../../backend/agent/attachmentStore');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('attachments use private UUID storage names and ownership checks', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-attachment-'));
  try {
    const prepared = await prepareMessageImages({
      images: [{ buffer: png, name: '客户图.png', mimeType: 'image/png', byteSize: png.length }],
      userId: 'u1',
      conversationId: 'c1',
      messageId: 'm1',
      rootDir,
    });
    assert.match(prepared[0].storage_name, /^[0-9a-f-]{36}\.png$/);
    assert.equal(prepared[0].storage_name.includes('客户'), false);

    const db = {
      getOwnedAttachment: (attachmentId, userId, conversationId) => (
        attachmentId === prepared[0].id && userId === 'u1' && conversationId === 'c1'
          ? prepared[0]
          : null
      ),
    };
    const owned = await readOwnedAttachment({ attachmentId: prepared[0].id, userId: 'u1', conversationId: 'c1', db, rootDir });
    assert.equal(owned.buffer.equals(png), true);
    await assert.rejects(
      readOwnedAttachment({ attachmentId: prepared[0].id, userId: 'u2', conversationId: 'c1', db, rootDir }),
      { code: 'ATTACHMENT_NOT_FOUND' },
    );

    await discardPreparedImages(prepared, { rootDir });
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('attachment reads reject traversal storage names', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-attachment-'));
  try {
    const db = { getOwnedAttachment: () => ({ storage_name: '../secret', mime_type: 'image/png' }) };
    await assert.rejects(
      readOwnedAttachment({ attachmentId: 'a', userId: 'u', conversationId: 'c', db, rootDir }),
      { code: 'ATTACHMENT_NOT_FOUND' },
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
