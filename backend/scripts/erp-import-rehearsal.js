'use strict';
const fs = require('node:fs/promises');
const { createBusinessPool } = require('../business-db/connection');
const { migrateBusinessDatabase } = require('../business-db/migrator');
const { readFileSource } = require('../business-db/preflight/source');
const { importLegacySnapshot, assertRehearsalDatabase } = require('../business-db/import/legacy');

async function main(args) {
  const options = {};
  const allowed = new Set(['--source-file', '--decisions-file', '--target-env', '--upload-dir']);
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options[args[i]]) throw Error('IMPORT_ARGUMENTS_INVALID');
    options[args[i]] = args[i + 1];
  }
  if (!options['--source-file'] || !options['--decisions-file'] || !options['--target-env']) throw Error('IMPORT_ARGUMENTS_REQUIRED');
  const name = options['--target-env'];
  if (!/^[A-Z][A-Z0-9_]*$/.test(name) || name === 'DATABASE_URL') throw Error('IMPORT_REHEARSAL_TARGET_REQUIRED');
  const connectionString = process.env[name];
  const target = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
      || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
      || !['/erp_02a_verify', '/erp_import_rehearsal'].includes(target.pathname)) throw Error('IMPORT_REHEARSAL_TARGET_REQUIRED');
  const source = await readFileSource(options['--source-file']);
  const decisions = JSON.parse(await fs.readFile(options['--decisions-file'], 'utf8'));
  const pool = await createBusinessPool({ connectionString });
  try {
    await assertRehearsalDatabase(pool);
    await migrateBusinessDatabase(pool);
    const result = await importLegacySnapshot(pool, { source, decisions, uploadDirectory: options['--upload-dir'] });
    process.stdout.write(JSON.stringify({ ...result, productionCutover: false }) + '\n');
  } finally { await pool.end(); }
}
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  // Do not print DB messages, connection strings, customer data or SQL parameters.
  process.stderr.write(JSON.stringify({ status: 'failed', code: error.code || 'ERP_IMPORT_REHEARSAL_FAILED' }) + '\n');
  process.exitCode = 1;
});
module.exports = { main };
