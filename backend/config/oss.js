const OSS = require('ali-oss');
const dotenv = require('dotenv');

dotenv.config();

const normalizeConfig = () => ({
  region: process.env.OSS_REGION || 'oss-cn-hangzhou',
  accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
  accessKeySecret: process.env.OSS_SECRET_ACCESS_KEY || '',
  bucket: process.env.OSS_BUCKET || '',
  endpoint: process.env.OSS_ENDPOINT || '',
  secure: process.env.OSS_SECURE !== 'false',
});

const assertConfig = () => {
  if (process.env.OSS_ENABLED !== 'true') {
    const error = new Error('此服务器未启用对象存储');
    error.code = 'OBJECT_STORAGE_DISABLED';
    throw error;
  }
  const normalized = normalizeConfig();
  const required = ['region', 'accessKeyId', 'accessKeySecret', 'bucket'];
  const missing = required.filter((key) => !normalized[key]);

  if (missing.length > 0) {
    throw new Error(`OSS config is missing: ${missing.join(', ')}`);
  }

  return normalized;
};

const createClient = () => {
  const normalized = assertConfig();
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
    throw new Error('对象存储键无效');
  }
  return key;
};

const generateUploadUrl = async (objectKey, expire = 600) => {
  const { client, config: normalized } = createClient();
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

const generateDownloadUrl = async (objectKey, expire = 3600) => {
  const { client, config: normalized } = createClient();
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

const completeUpload = async (objectKey, options = {}) => {
  const { client, config: normalized } = createClient();
  const key = normalizeObjectKey(objectKey);
  const head = options.skipNetwork
    ? { res: { headers: { etag: 'test-etag', 'content-length': String(options.size || 0), 'content-type': options.contentType || '' } } }
    : await client.head(key);
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

const testConnection = async (options = {}) => {
  const { client, config: normalized } = createClient();
  if (options.skipNetwork) {
    const signed = await generateUploadUrl(`health/${Date.now()}.txt`, 60);
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

const deleteObject = async (objectKey) => {
  const { client, config: normalized } = createClient();
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
