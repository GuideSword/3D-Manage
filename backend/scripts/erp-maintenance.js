'use strict';
const { createBusinessPool } = require('../business-db/connection');
const { createMaintenanceService } = require('../business-db/maintenance');
const { publicErrorMessage } = require('../utils/publicError');
const invalid = () => { throw Object.assign(new Error('维护参数无效，请明确指定目标环境变量、服务器身份及必要的版本和原因'), { code: 'MAINTENANCE_ARGUMENTS_INVALID' }); };
function parseArguments(args) {
  const [action, ...rest] = args;
  if (!['status', 'enter', 'leave'].includes(action) || rest.length % 2) invalid();
  const flags = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index], value = rest[index + 1];
    if (!['--target-env', '--server-id', '--expected-version', '--reason'].includes(name) || Object.hasOwn(flags, name)
      || typeof value !== 'string' || !value.trim() || value.startsWith('--')) invalid();
    flags[name] = value;
  }
  if (!/^[A-Z][A-Z0-9_]{0,100}$/.test(flags['--target-env'] || '')
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(flags['--server-id'] || '')) invalid();
  if (action === 'status') {
    if (flags['--expected-version'] !== undefined || flags['--reason'] !== undefined) invalid();
  } else if (!/^[1-9]\d{0,18}$/.test(flags['--expected-version'] || '') || BigInt(flags['--expected-version']) >= 9223372036854775807n
    || !flags['--reason'] || flags['--reason'].trim().length > 1000) invalid();
  return { action, targetEnvironment: flags['--target-env'], expectedServerId: flags['--server-id'],
    ...(action === 'status' ? {} : { expectedVersion: flags['--expected-version'], reason: flags['--reason'].trim() }) };
}
async function main(args, environment = process.env) {
  const options = parseArguments(args);
  const pool = await createBusinessPool({ connectionString: environment[options.targetEnvironment] });
  try {
    const service = createMaintenanceService(pool);
    const result = options.action === 'status' ? await service.status({ expectedServerId: options.expectedServerId })
      : await service.setState({ expectedServerId: options.expectedServerId, expectedVersion: options.expectedVersion,
        state: options.action === 'enter' ? 'maintenance' : 'open', reason: options.reason });
    console.log(JSON.stringify(result));
    return result;
  } finally { await pool.end(); }
}
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  console.error(JSON.stringify({ code: /^[A-Z_]+$/.test(error.code || '') ? error.code : 'MAINTENANCE_FAILED', error: publicErrorMessage(error, '维护操作失败') }));
  process.exitCode = 1;
});
module.exports = { parseArguments, main };
