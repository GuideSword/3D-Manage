'use strict';
const { createBusinessPool } = require('../business-db/connection');
const { createHostOwnerRecovery } = require('../modules/users/hostRecovery');
const { publicErrorMessage } = require('../utils/publicError');
const invalid = () => { throw Object.assign(new Error('恢复参数无效，请指定目标环境、服务器、Owner和必要的版本、原因及密码环境变量'), { code: 'OWNER_RECOVERY_ARGUMENTS_INVALID' }); };
function parseArguments(args) {
  const [action, ...rest] = args;
  if (!['status', 'reset'].includes(action) || rest.length % 2) invalid();
  const flags = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index], value = rest[index + 1];
    if (!['--target-env', '--server-id', '--user-id', '--expected-version', '--reason', '--password-env'].includes(name)
      || Object.hasOwn(flags, name) || typeof value !== 'string' || !value.trim() || value.startsWith('--')) invalid();
    flags[name] = value;
  }
  const envName = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,100}$/.test(value);
  if (!envName(flags['--target-env']) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(flags['--server-id'] || '')
    || typeof flags['--user-id'] !== 'string' || !flags['--user-id'].trim() || flags['--user-id'].length > 128) invalid();
  if (action === 'status') {
    if (['--expected-version', '--reason', '--password-env'].some(key => flags[key] !== undefined)) invalid();
  } else if (!/^[1-9]\d{0,18}$/.test(flags['--expected-version'] || '') || BigInt(flags['--expected-version']) >= 9223372036854775807n
    || !flags['--reason'] || flags['--reason'].trim().length > 1000 || !envName(flags['--password-env'])
    || flags['--password-env'] === flags['--target-env']) invalid();
  return { action, targetEnvironment: flags['--target-env'], expectedServerId: flags['--server-id'], userId: flags['--user-id'],
    ...(action === 'status' ? {} : { expectedVersion: flags['--expected-version'], reason: flags['--reason'].trim(), passwordEnvironment: flags['--password-env'] }) };
}
async function main(args, environment = process.env) {
  const options = parseArguments(args);
  const input = { expectedServerId: options.expectedServerId, userId: options.userId };
  if (options.action === 'reset') {
    const newPassword = environment[options.passwordEnvironment];
    if (typeof newPassword !== 'string' || !newPassword) invalid();
    Object.assign(input, { expectedVersion: options.expectedVersion, reason: options.reason, newPassword });
  }
  const pool = await createBusinessPool({ connectionString: environment[options.targetEnvironment] });
  try {
    const service = createHostOwnerRecovery(pool);
    const result = await service[options.action](input);
    console.log(JSON.stringify(result));
    return result;
  } finally { await pool.end(); }
}
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  console.error(JSON.stringify({ code: /^[A-Z_]+$/.test(error.code || '') ? error.code : 'OWNER_RECOVERY_FAILED', error: publicErrorMessage(error, 'Owner 恢复失败') }));
  process.exitCode = 1;
});
module.exports = { parseArguments, main };
