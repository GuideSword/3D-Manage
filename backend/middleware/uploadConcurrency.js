'use strict';

let activeUploads = 0;

const limitUploadConcurrency = (req, res, next) => {
  const limit = Math.max(1, Number.parseInt(process.env.MAX_UPLOAD_CONCURRENCY || '1', 10) || 1);
  if (activeUploads >= limit) {
    return res.status(503).json({ code: 'UPLOAD_CAPACITY_REACHED', error: 'Upload capacity reached; retry later' });
  }
  activeUploads += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeUploads = Math.max(0, activeUploads - 1);
  };
  res.once('finish', release);
  res.once('close', release);
  return next();
};

module.exports = { limitUploadConcurrency };
