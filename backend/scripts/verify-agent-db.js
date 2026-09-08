'use strict';

const { getDb, closeDb } = require('../db/agent');
const crypto = require('../utils/crypto');

try {
  const db = getDb();
  const integrity = db.pragma('integrity_check');
  if (!Array.isArray(integrity) || integrity.some((row) => row.integrity_check !== 'ok')) {
    throw new Error('Agent SQLite integrity check failed');
  }
  const settings = db.prepare('SELECT llm_api_key_enc, embed_api_key_enc FROM user_settings').all();
  for (const row of settings) {
    if (row.llm_api_key_enc) crypto.decrypt(row.llm_api_key_enc);
    if (row.embed_api_key_enc) crypto.decrypt(row.embed_api_key_enc);
  }
  closeDb();
  console.log('Agent database integrity and encrypted-key verification passed');
} catch (error) {
  closeDb();
  console.error(error.message);
  process.exitCode = 1;
}
