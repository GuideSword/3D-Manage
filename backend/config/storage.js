const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');

const ensureUploadDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const sanitizeSegment = (segment) => String(segment || '')
  .replace(/[^a-zA-Z0-9._-]/g, '_')
  .replace(/^_+$/, '');

const sanitizeFolder = (folder) => String(folder || 'models')
  .split(/[\\/]+/)
  .map(sanitizeSegment)
  .filter(Boolean)
  .join(path.sep);

const safeStoragePath = (relativePath) => {
  const resolvedDir = path.resolve(UPLOAD_DIR);
  const resolvedPath = path.resolve(path.join(UPLOAD_DIR, relativePath));
  if (!resolvedPath.startsWith(resolvedDir)) {
    throw new Error('Access denied: Invalid file path');
  }
  return resolvedPath;
};

const generateFilePath = (folder, filename) => {
  const timestamp = Date.now();
  const randomStr = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(filename);
  const baseName = sanitizeSegment(path.basename(filename, ext)) || 'file';
  return path.join(sanitizeFolder(folder), `${timestamp}-${randomStr}-${baseName}${ext}`);
};

const saveFile = async (fileBuffer, originalFilename, folder = 'models') => {
  const relativePath = generateFilePath(folder, originalFilename);
  const fullPath = safeStoragePath(relativePath);
  await ensureUploadDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, fileBuffer);

  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  return {
    filePath: relativePath,
    fullPath,
    sha256,
    size: fileBuffer.length,
  };
};

const getFile = async (filePath) => {
  const fullPath = safeStoragePath(filePath);
  return fs.readFile(fullPath);
};

const deleteFileFromStorage = async (filePath) => {
  try {
    const fullPath = safeStoragePath(filePath);
    await fs.unlink(fullPath);
    return { success: true };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { success: true };
    }
    throw error;
  }
};

const getFileInfo = async (filePath) => {
  const fullPath = safeStoragePath(filePath);
  const stats = await fs.stat(fullPath);
  return {
    size: stats.size,
    createdAt: stats.birthtime,
    modifiedAt: stats.mtime,
  };
};

const getFileUrl = (filePath) => {
  const normalizedPath = String(filePath).replace(/\\/g, '/');
  return `/api/files/${normalizedPath}`;
};

const initStorage = async () => {
  await ensureUploadDir(UPLOAD_DIR);
  await ensureUploadDir(path.join(UPLOAD_DIR, 'models'));
  await ensureUploadDir(path.join(UPLOAD_DIR, 'orders'));
  await ensureUploadDir(path.join(UPLOAD_DIR, 'stock'));
  await ensureUploadDir(path.join(UPLOAD_DIR, 'previews'));
  console.log(`File storage initialized: ${UPLOAD_DIR}`);
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
