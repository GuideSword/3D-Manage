const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');

// 确保上传目录存在
const ensureUploadDir = async (dirPath) => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
};

// 生成文件保存路径
const generateFilePath = (folder, filename) => {
  const timestamp = Date.now();
  const randomStr = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext);
  // 使用安全的文件名（移除特殊字符）
  const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(folder, `${timestamp}-${randomStr}-${safeName}${ext}`);
};

// 保存上传的文件
const saveFile = async (fileBuffer, originalFilename, folder = 'models') => {
  const folderPath = path.join(UPLOAD_DIR, folder);
  await ensureUploadDir(folderPath);
  
  const filePath = generateFilePath(folderPath, originalFilename);
  await fs.writeFile(filePath, fileBuffer);
  
  // 计算SHA256
  const hash = crypto.createHash('sha256');
  hash.update(fileBuffer);
  const sha256 = hash.digest('hex');
  
  // 返回相对路径（用于数据库存储）
  const relativePath = path.relative(UPLOAD_DIR, filePath);
  
  return {
    filePath: relativePath, // 存储这个到数据库
    fullPath: filePath,
    sha256,
    size: fileBuffer.length,
  };
};

// 获取文件
const getFile = async (filePath) => {
  const fullPath = path.join(UPLOAD_DIR, filePath);
  // 安全检查：防止路径遍历攻击
  const resolvedPath = path.resolve(fullPath);
  const resolvedDir = path.resolve(UPLOAD_DIR);
  if (!resolvedPath.startsWith(resolvedDir)) {
    throw new Error('Access denied: Invalid file path');
  }
  return await fs.readFile(resolvedPath);
};

// 删除文件
const deleteFileFromStorage = async (filePath) => {
  try {
    const fullPath = path.join(UPLOAD_DIR, filePath);
    // 安全检查
    const resolvedPath = path.resolve(fullPath);
    const resolvedDir = path.resolve(UPLOAD_DIR);
    if (!resolvedPath.startsWith(resolvedDir)) {
      throw new Error('Access denied: Invalid file path');
    }
    await fs.unlink(resolvedPath);
    return { success: true };
  } catch (error) {
    if (error.code === 'ENOENT') {
      // 文件不存在，认为删除成功
      return { success: true };
    }
    throw error;
  }
};

// 获取文件信息
const getFileInfo = async (filePath) => {
  const fullPath = path.join(UPLOAD_DIR, filePath);
  // 安全检查
  const resolvedPath = path.resolve(fullPath);
  const resolvedDir = path.resolve(UPLOAD_DIR);
  if (!resolvedPath.startsWith(resolvedDir)) {
    throw new Error('Access denied: Invalid file path');
  }
  
  const stats = await fs.stat(resolvedPath);
  return {
    size: stats.size,
    createdAt: stats.birthtime,
    modifiedAt: stats.mtime,
  };
};

// 获取文件下载URL（直接返回服务器路径）
const getFileUrl = (filePath) => {
  // 返回相对于服务器的URL路径
  // 将路径中的反斜杠替换为正斜杠（Windows兼容）
  const normalizedPath = filePath.replace(/\\/g, '/');
  return `/api/files/${normalizedPath}`;
};

// 初始化上传目录
const initStorage = async () => {
  await ensureUploadDir(UPLOAD_DIR);
  await ensureUploadDir(path.join(UPLOAD_DIR, 'models'));
  await ensureUploadDir(path.join(UPLOAD_DIR, 'orders'));
  await ensureUploadDir(path.join(UPLOAD_DIR, 'stock'));
  await ensureUploadDir(path.join(UPLOAD_DIR, 'previews'));
  console.log(`📁 文件存储目录已初始化: ${UPLOAD_DIR}`);
};

module.exports = {
  saveFile,
  getFile,
  deleteFile: deleteFileFromStorage,
  getFileInfo,
  getFileUrl,
  UPLOAD_DIR,
  initStorage,
};


