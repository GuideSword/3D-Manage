'use strict';
const fs = require('node:fs');
const path = require('node:path');
function createHttpTransport(app, env = process.env) {
  const certFile = env.TLS_CERT_FILE, keyFile = env.TLS_KEY_FILE;
  if (!certFile && !keyFile) return require('node:http').createServer(app);
  if (!certFile || !keyFile || !path.isAbsolute(certFile) || !path.isAbsolute(keyFile)) throw new Error('TLS_CERT_FILE和TLS_KEY_FILE必须同时配置为绝对路径');
  return require('node:https').createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile), minVersion: 'TLSv1.2' }, app);
}
module.exports = { createHttpTransport };
