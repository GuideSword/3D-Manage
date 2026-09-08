'use strict';

const fs = require('node:fs');
const path = require('node:path');

const checkWritable = (dir) => {
  const target = path.join(dir, `.health-${process.pid}`);
  fs.writeFileSync(target, 'ok', { flag: 'wx' });
  fs.unlinkSync(target);
};

const main = async () => {
  const response = await fetch('http://127.0.0.1:5000/api/system/info', {
    signal: AbortSignal.timeout(3500),
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!response.ok) throw new Error(`API health returned ${response.status}`);
  const info = await response.json();
  if (info.product !== '3D Manage' || !info.serverId) throw new Error('Invalid API health payload');
  checkWritable(process.env.DATA_DIR || path.join(__dirname, '../data'));
  checkWritable(process.env.UPLOAD_DIR || path.join(__dirname, '../uploads'));
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
