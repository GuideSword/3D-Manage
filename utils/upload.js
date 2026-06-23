export const pickerAssetToFormFile = (asset) => {
  if (!asset) {
    return null;
  }

  if (asset.file) {
    return asset.file;
  }

  return {
    uri: asset.uri,
    name: asset.name || 'upload',
    type: asset.mimeType || 'application/octet-stream',
  };
};

export const getFileExtension = (filename = '') => {
  const parts = String(filename).split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
};

export const validateExtension = (asset, allowedExtensions) => {
  const extension = getFileExtension(asset?.name || asset?.uri || '');
  return allowedExtensions.includes(extension);
};
