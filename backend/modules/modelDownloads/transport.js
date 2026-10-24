'use strict';
function assertDownloadTransport(req, allowInsecureTest = false) {
  if (!req.secure && !allowInsecureTest) throw Object.assign(new Error('此操作需要受信HTTPS连接，请先配置服务器加密访问'), { status: 400, code: 'DOWNLOAD_HTTPS_REQUIRED' });
}
module.exports = { assertDownloadTransport };
