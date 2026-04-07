const OSS = require('alioss');
const dotenv = require('dotenv');

dotenv.config();

const client = new OSS({
  region: process.env.OSS_REGION || 'oss-cn-hangzhou',
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_SECRET_ACCESS_KEY,
  bucket: process.env.OSS_BUCKET,
});

const generateUploadUrl = async (objectKey, expire = 600) => {
  try {
    if (!client.bucket) {
      throw new Error('OSS 配置未设置，请检查环境变量');
    }
    const params = {
      Expires: expire,
      'Content-Type': 'application/octet-stream',
    };
    const url = client.signatureUrl('putObject', params, objectKey);
    return { url, objectKey };
  } catch (error) {
    console.error('OSS URL 生成失败:', error);
    throw new Error(`OSS URL 生成失败: ${error.message}`);
  }
};

const generateDownloadUrl = async (objectKey, expire = 3600) => {
  try {
    const params = { Expires: expire };
    const url = client.signatureUrl('getObject', params, objectKey);
    return url;
  } catch (error) {
    throw new Error(`OSS 下载 URL 生成失败: ${error.message}`);
  }
};

const completeUpload = async (objectKey) => {
  try {
    const result = await client.get(objectKey);
    return {
      etag: result.res.headers.etag,
      size: result.content.length,
      contentType: result.res.headers['content-type'],
    };
  } catch (error) {
    console.error('OSS 文件验证失败:', error);
    throw new Error(`OSS 文件验证失败: ${error.message}`);
  }
};

const testConnection = async (config = {}) => {
  try {
    const testClient = new OSS({
      region: config.region || process.env.OSS_REGION,
      accessKeyId: config.accessKeyId || process.env.OSS_ACCESS_KEY_ID,
      accessKeySecret: config.secretAccessKey || process.env.OSS_SECRET_ACCESS_KEY,
      bucket: config.bucket || process.env.OSS_BUCKET,
    });
    const buckets = await testClient.listBuckets();
    return { success: true, buckets: buckets.buckets.map(b => b.name) };
  } catch (error) {
    throw new Error(`OSS 连接测试失败: ${error.message}`);
  }
};

const deleteObject = async (objectKey) => {
  try {
    await client.delete(objectKey);
    return { success: true };
  } catch (error) {
    throw new Error(`OSS 删除失败: ${error.message}`);
  }
};

module.exports = {
  client,
  generateUploadUrl,
  generateDownloadUrl,
  completeUpload,
  testConnection,
  deleteObject,
};


