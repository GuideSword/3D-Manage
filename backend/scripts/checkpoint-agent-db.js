'use strict';

const { getDb, closeDb } = require('../db/agent');

try {
  getDb().pragma('wal_checkpoint(TRUNCATE)');
  closeDb();
  console.log('Agent database checkpoint complete');
} catch (error) {
  closeDb();
  console.error(error);
  process.exitCode = 1;
}
