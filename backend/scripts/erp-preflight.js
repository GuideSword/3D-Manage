'use strict';
const { parseArgs } = require('node:util');
const { readFileSource, readPostgresSource, assertSourceHash } = require('../business-db/preflight/source');
const { buildPreflightReport } = require('../business-db/preflight/report');
const { writePreflightArtifacts } = require('../business-db/preflight/runner');

async function main() {
  const { values } = parseArgs({ options: Object.fromEntries([
    'source-file', 'postgres-env', 'table', 'store-id', 'upload-dir', 'output', 'expected-source-hash',
  ].map(key => [key, { type: 'string' }])) });
  if (Boolean(values['source-file']) === Boolean(values['postgres-env']) || !values.output) {
    throw Object.assign(new Error('请选择唯一来源 --source-file 或 --postgres-env，并提供新的 --output 目录'), { code: 'PREFLIGHT_ARGUMENTS_INVALID' });
  }
  let source;
  if (values['source-file']) source = await readFileSource(values['source-file']);
  else {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(values['postgres-env'])) throw Error('来源连接环境变量名称无效');
    source = await readPostgresSource({ connectionString: process.env[values['postgres-env']],
      table: values.table, storeId: values['store-id'] });
  }
  if (values['expected-source-hash']) assertSourceHash(source, values['expected-source-hash']);
  const report = await buildPreflightReport(source, { uploadDirectory: values['upload-dir'] });
  const summary = await writePreflightArtifacts(source, report, values.output);
  console.log(JSON.stringify(summary));
  process.exitCode = report.status === 'blocked' ? 2 : report.status === 'review_required' ? 3 : 0;
}
main().catch(error => {
  console.error(JSON.stringify({ code: error.code || 'PREFLIGHT_FAILED', error: error.message }));
  process.exitCode = 1;
});
