const OSS = require('ali-oss');
const dotenv = require('dotenv');

dotenv.config();

const normalizeConfig = (config = {}) => ({
  region: config.region || process.env.OSS_REGION || 'oss-cn-hangzhou',
  accessKeyId: config.accessKeyId || process.env.OSS_ACCESS_KEY_ID || '',
  accessKeySecret: config.secretAccessKey || config.accessKeySecret || process.env.OSS_SECRET_ACCESS_KEY || '',
  bucket: config.bucket || process.env.OSS_BUCKET || '',
  endpoint: config.endpoint || process.env.OSS_ENDPOINT || '',
  secure: config.secure !== undefined ? Boolean(config.secure) : process.env.OSS_SECURE !== 'false',
});

const assertConfig = (config = {}) => {
  const normalized = normalizeConfig(config);
  const required = ['region', 'accessKeyId', 'accessKeySecret', 'bucket'];
  const missing = required.filter((key) => !normalized[key]);

  if (missing.length > 0) {
    throw new Error(`OSS config is missing: ${missing.join(', ')}`);
  }

  return normalized;
};

const createClient = (config = {}) => {
  const normalized = assertConfig(config);
  const clientConfig = {
    region: normalized.region,
    accessKeyId: normalized.accessKeyId,
    accessKeySecret: normalized.accessKeySecret,
    bucket: normalized.bucket,
    secure: normalized.secure,
  };
  if (normalized.endpoint) {
    clientConfig.endpoint = normalized.endpoint;
  }
  return { client: new OSS(clientConfig), config: normalized };
};

const normalizeObjectKey = (objectKey) => {
  const key = String(objectKey || '').replace(/^\/+/, '');
  if (!key || key.includes('..')) {
    throw new Error('Invalid object key');
  }
  return key;
};

const generateUploadUrl = async (objectKey, expire = 600, config = {}) => {
  const { client, config: normalized } = createClient(config);
  const key = normalizeObjectKey(objectKey);
  const url = client.signatureUrl(key, {
    expires: Number(expire) || 600,
    method: 'PUT',
  });
  return {
    provider: 'aliyun-oss',
    mode: 'presigned-url',
    method: 'PUT',
    objectKey: key,
    expire: Number(expire) || 600,
    bucket: normalized.bucket,
    region: normalized.region,
    url,
  };
};

const generateDownloadUrl = async (objectKey, expire = 3600, config = {}) => {
  const { client, config: normalized } = createClient(config);
  const key = normalizeObjectKey(objectKey);
  const url = client.signatureUrl(key, {
    expires: Number(expire) || 3600,
    method: 'GET',
  });
  return {
    provider: 'aliyun-oss',
    mode: 'presigned-url',
    method: 'GET',
    objectKey: key,
    expire: Number(expire) || 3600,
    bucket: normalized.bucket,
    region: normalized.region,
    url,
  };
};

const completeUpload = async (objectKey, config = {}) => {
  const { client, config: normalized } = createClient(config);
  const key = normalizeObjectKey(objectKey);
  const head = await client.head(key);
  return {
    provider: 'aliyun-oss',
    mode: 'head-verified',
    objectKey: key,
    bucket: normalized.bucket,
    region: normalized.region,
    etag: head.res?.headers?.etag || '',
    size: Number(head.res?.headers?.['content-length'] || 0),
    contentType: head.res?.headers?.['content-type'] || '',
  };
};

const testConnection = async (config = {}, options = {}) => {
  const { client, config: normalized } = createClient(config);
  if (options.skipNetwork || config.skipNetwork) {
    const signed = await generateUploadUrl(`health/${Date.now()}.txt`, 60, normalized);
    return {
      success: true,
      mode: 'signature-only',
      buckets: [normalized.bucket],
      region: normalized.region,
      uploadUrl: signed.url,
    };
  }

  await client.list({ 'max-keys': 1 });
  return {
    success: true,
    mode: 'live',
    buckets: [normalized.bucket],
    region: normalized.region,
  };
};

const deleteObject = async (objectKey, config = {}) => {
  const { client, config: normalized } = createClient(config);
  const key = normalizeObjectKey(objectKey);
  await client.delete(key);
  return {
    success: true,
    provider: 'aliyun-oss',
    objectKey: key,
    bucket: normalized.bucket,
    region: normalized.region,
  };
};

module.exports = {
  createClient,
  generateUploadUrl,
  generateDownloadUrl,
  completeUpload,
  testConnection,
  deleteObject,
};
