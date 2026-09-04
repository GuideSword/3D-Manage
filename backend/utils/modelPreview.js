const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { execFile } = require('child_process');

const execFileAsync = promisify(execFile);

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

const getExtension = (filename = '') => path.extname(filename).toLowerCase();

const isTruthyEnv = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());

const shouldSkipWindowsShellThumbnail = () => (
  process.env.NODE_ENV === 'test'
  || isTruthyEnv(process.env.SKIP_WINDOWS_SHELL_THUMBNAIL)
);

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

const writeWindowsThumbnailScript = () => `
Add-Type -AssemblyName System.Drawing
$code = @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct SIZE {
  public int cx;
  public int cy;
  public SIZE(int x, int y) { cx = x; cy = y; }
}

[Flags]
public enum SIIGBF {
  ResizeToFit = 0x00,
  BiggerSizeOk = 0x01,
  MemoryOnly = 0x02,
  IconOnly = 0x04,
  ThumbnailOnly = 0x08,
  InCacheOnly = 0x10
}

[ComImport]
[Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IShellItemImageFactory {
  void GetImage([In, MarshalAs(UnmanagedType.Struct)] SIZE size, [In] SIIGBF flags, out IntPtr phbm);
}

public static class ShellThumbnail {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(
    [MarshalAs(UnmanagedType.LPWStr)] string path,
    IntPtr pbc,
    ref Guid riid,
    [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory shellItem
  );

  [DllImport("gdi32.dll")]
  private static extern bool DeleteObject(IntPtr hObject);

  public static void Save(string inputPath, string outputPath, int size) {
    Guid guid = typeof(IShellItemImageFactory).GUID;
    IShellItemImageFactory factory;
    SHCreateItemFromParsingName(inputPath, IntPtr.Zero, ref guid, out factory);
    IntPtr hbitmap;
    factory.GetImage(new SIZE(size, size), SIIGBF.ThumbnailOnly | SIIGBF.BiggerSizeOk, out hbitmap);
    try {
      using (Bitmap bitmap = Image.FromHbitmap(hbitmap)) {
        bitmap.Save(outputPath, ImageFormat.Png);
      }
    } finally {
      DeleteObject(hbitmap);
    }
  }
}
"@
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing
[ShellThumbnail]::Save($args[0], $args[1], 512)
`;

const tryWindowsShellThumbnail = async (fullPath) => {
  if (process.platform !== 'win32' || !fullPath || shouldSkipWindowsShellThumbnail()) {
    return null;
  }

  const outputPath = path.join(os.tmpdir(), `model-preview-${Date.now()}-${process.pid}.png`);
  try {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        writeWindowsThumbnailScript(),
        fullPath,
        outputPath,
      ],
      { timeout: 15000, windowsHide: true }
    );

    const imageBuffer = await fs.readFile(outputPath);
    if (getImageExtensionFromBuffer(imageBuffer)) {
      return {
        buffer: imageBuffer,
        extension: 'png',
        source: 'windows_shell',
      };
    }
  } catch (error) {
    return null;
  } finally {
    await fs.unlink(outputPath).catch(() => {});
  }

  return null;
};

const createModelPreview = async ({ fileBuffer, originalName, fullPath }) => {
  const extension = getExtension(originalName);

  if (extension === '.3mf') {
    const embeddedThumbnail = extract3mfThumbnail(fileBuffer);
    if (embeddedThumbnail) {
      return embeddedThumbnail;
    }
  }

  return tryWindowsShellThumbnail(fullPath);
};

module.exports = {
  createModelPreview,
  extract3mfThumbnail,
};
