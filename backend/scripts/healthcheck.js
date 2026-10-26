'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

const checkWritable = (dir) => {
  const target = path.join(dir, `.health-${process.pid}`);
  fs.writeFileSync(target, 'ok', { flag: 'wx' });
  fs.unlinkSync(target);
};

const main = async () => {
  const tls = Boolean(process.env.TLS_CERT_FILE);
  const info = await new Promise((resolve, reject) => {
    const request = (tls ? https : http).get({
      hostname: '127.0.0.1', port: process.env.PORT || 5000, path: '/api/system/info',
      ...(tls ? { ca: fs.readFileSync(process.env.TLS_CA_FILE), servername: 'localhost' } : {}),
      headers: { 'Cache-Control': 'no-cache' },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 65536) request.destroy(new Error('Health payload too large')); });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`API health returned ${response.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.setTimeout(3500, () => request.destroy(new Error('API health timeout')));
    request.on('error', reject);
  });
  if (info.product !== '3D Manage' || !info.serverId) throw new Error('Invalid API health payload');
  checkWritable(process.env.DATA_DIR || path.join(__dirname, '../data'));
  checkWritable(process.env.UPLOAD_DIR || path.join(__dirname, '../uploads'));
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
