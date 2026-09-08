const packageJson = require('../package.json');

const PRODUCT_NAME = '3D Manage';
const API_VERSION = '1';
const CURRENT_SCHEMA_VERSION = 2;

const isWeakSecret = (value) => (
  typeof value !== 'string'
  || Buffer.byteLength(value, 'utf8') < 32
  || value.startsWith('CHANGE_ME_')
);

const assertRuntimeConfig = () => {
  if (process.env.NODE_ENV !== 'production') return;

  const requiredSecrets = ['JWT_SECRET', 'AGENT_KEY_ENC_SECRET', 'BOOTSTRAP_TOKEN'];
  const missing = requiredSecrets.filter((key) => isWeakSecret(process.env[key]));
  if (missing.length > 0) {
    throw new Error(`Missing or weak production configuration: ${missing.join(', ')}`);
  }

  if (process.env.ADMIN_PASSWORD || process.env.ADMIN_EMAIL) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are not supported in production; use system bootstrap.');
  }

  if (process.env.OSS_ENABLED === 'true') {
    const ossRequired = ['OSS_ACCESS_KEY_ID', 'OSS_SECRET_ACCESS_KEY', 'OSS_BUCKET', 'OSS_REGION'];
    const missingOss = ossRequired.filter((key) => !process.env[key]);
    if (missingOss.length > 0) {
      throw new Error(`Missing object-storage configuration: ${missingOss.join(', ')}`);
    }
  }
};

module.exports = {
  API_VERSION,
  CURRENT_SCHEMA_VERSION,
  PRODUCT_NAME,
  SERVER_VERSION: packageJson.version,
  assertRuntimeConfig,
  isWeakSecret,
};
