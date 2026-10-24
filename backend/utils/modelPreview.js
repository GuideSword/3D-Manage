const path = require('path');
const zlib = require('zlib');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

const getExtension = (filename = '') => path.extname(filename).toLowerCase();

const getImageExtensionFromBuffer = (buffer) => {
  if (!buffer || buffer.length < 8) {
    return null;
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  return null;
};

const findEndOfCentralDirectory = (buffer) => {
  const minOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return -1;
};

const isThumbnailCandidate = (entryName) => {
  const lowerName = entryName.toLowerCase();
  const ext = getExtension(lowerName);
  if (!IMAGE_EXTENSIONS.has(ext)) {
    return false;
  }
  return (
    lowerName.includes('thumbnail')
    || lowerName.includes('thumb')
    || lowerName.includes('preview')
    || lowerName.includes('metadata')
  );
};

const readZipEntries = (buffer) => {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset === -1) {
    return [];
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount && offset < buffer.length; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      break;
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const filenameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + filenameLength;
    const name = buffer.slice(nameStart, nameEnd).toString('utf8');

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
};

const extractZipEntry = (buffer, entry) => {
  const localOffset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE_SIGNATURE) {
    return null;
  }

  const filenameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + filenameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  const compressed = buffer.slice(dataStart, dataEnd);

  if (entry.compressionMethod === 0) {
    return compressed;
  }

  if (entry.compressionMethod === 8) {
    return zlib.inflateRawSync(compressed, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  }

  return null;
};

const extract3mfThumbnail = (fileBuffer) => {
  const entries = readZipEntries(fileBuffer)
    .filter((entry) => entry.uncompressedSize > 0 && isThumbnailCandidate(entry.name))
    .sort((left, right) => {
      const leftName = left.name.toLowerCase();
      const rightName = right.name.toLowerCase();
      const leftScore = leftName.includes('thumbnail') ? 0 : 1;
      const rightScore = rightName.includes('thumbnail') ? 0 : 1;
      return leftScore - rightScore;
    });

  for (const entry of entries) {
    try {
      const imageBuffer = extractZipEntry(fileBuffer, entry);
      const extension = getImageExtensionFromBuffer(imageBuffer);
      if (extension) {
        return {
          buffer: imageBuffer,
          extension,
          source: '3mf_thumbnail',
        };
      }
    } catch (error) {
      // Try the next thumbnail-like entry.
    }
  }

  return null;
};

const createModelPreview = async ({ fileBuffer, originalName }) => {
  const extension = getExtension(originalName);

  if (extension === '.3mf') {
    const embeddedThumbnail = extract3mfThumbnail(fileBuffer);
    if (embeddedThumbnail) {
      return embeddedThumbnail;
    }
  }

  // System thumbnail providers can launch the installed slicer as a side effect.
  // Missing embedded previews stay empty; opening a slicer requires a separate user action.
  return null;
};

module.exports = {
  createModelPreview,
  extract3mfThumbnail,
};
