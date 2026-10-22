'use strict';
const fs = require('node:fs/promises'), path = require('node:path');
const express = require('../../backend/node_modules/express'), bcrypt = require('../../backend/node_modules/bcryptjs');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const { createRelationalRuntime } = require('../../backend/application/relationalRuntime');
const { createHttpTransport } = require('../../backend/config/httpTransport');
async function main() {
  const directory = path.resolve('.tmp/model-downloads'), config = JSON.parse(await fs.readFile(path.join(directory, 'private-config.json'), 'utf8'));
  const target = new URL(config.connectionString);
  if (target.hostname !== '127.0.0.1' || target.pathname !== '/erp_model_downloads' || config.password.length < 12) throw Error('Isolated download fixture required');
  const pool = await createBusinessPool({ connectionString: config.connectionString });
  await migrateBusinessDatabase(pool);
  const uploads = path.join(directory, 'uploads');
  const existing = (await pool.query('SELECT count(*)::int n FROM erp.users')).rows[0].n;
  if (existing && (!process.argv.includes('--resume') || (await pool.query("SELECT server_id FROM erp.installation WHERE id='default'")).rows[0]?.server_id !== '02d3a500-0000-4000-8000-000000000004')) throw Error('Fresh or verified owned fixture required');
  if (!existing) {
  await pool.query("INSERT INTO erp.installation(id,server_id,organization_name,initialized_at,storage_mode) VALUES('default','02d3a500-0000-4000-8000-000000000004','模型下载隔离验收',now(),'relational')");
  const passwordHash = await bcrypt.hash(config.password, 12);
  for (const role of ['owner', 'staff', 'viewer']) await pool.query('INSERT INTO erp.users(id,email,name,role,password_hash) VALUES($1,$2,$1,$1,$3)', [role, role + '@download-ui.example.test', passwordHash]);
  await pool.query("INSERT INTO erp.models(id,name,source) VALUES('secure-model','下载保护验收模型','original')");
  await pool.query("INSERT INTO erp.warehouses(id,code,name,is_default) VALUES('default','DEFAULT','验收仓库',true)");
  await fs.mkdir(path.join(uploads, 'models'), { recursive: true });
  const bytes = Buffer.from('solid protected_model\nendsolid protected_model');
  await fs.writeFile(path.join(uploads, 'models/verified.stl'), bytes);
  const metadata = { id: 'secure-source', name: 'verified.stl', originalName: 'verified.stl', fileKey: 'models/verified.stl', fileUrl: '/api/files/models/verified.stl', fileType: 'stl', size: bytes.length, sha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex') };
  await pool.query('INSERT INTO erp.model_files(model_id,id,position,file_key,url,metadata) VALUES($1,$2,0,$3,$4,$5)', ['secure-model', metadata.id, metadata.fileKey, metadata.fileUrl, JSON.stringify(metadata)]);
  }
  // Native QA transport is loopback HTTP via an owned ADB reverse only. Never enabled in production factories.
  const app = express(); app.use('/api', (await createRelationalRuntime({ pool, jwtSecret: config.jwtSecret, uploadDirectory: uploads, files: { allowInsecureTest: true } })).router);
  const webroot = path.join(directory, 'web'); app.use(express.static(webroot)); app.get('/{*path}', (_req, res) => res.sendFile(path.join(webroot, 'index.html')));
  const server = createHttpTransport(app, { TLS_CERT_FILE: path.join(directory, 'qa-cert.pem'), TLS_KEY_FILE: path.join(directory, 'qa-key.pem') });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `https://127.0.0.1:${server.address().port}`;
  const native = require('node:http').createServer(app); await new Promise((resolve, reject) => { native.once('error', reject); native.listen(0, '127.0.0.1', resolve); });
  await fs.writeFile(path.join(directory, 'ready.json'), JSON.stringify({ pid: process.pid, origin, nativePort: native.address().port, serverId: '02d3a500-0000-4000-8000-000000000004', runId: config.runId }));
  console.log('Isolated HTTPS model-download UI fixture ready');
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await Promise.all([new Promise(r => server.close(r)), new Promise(r => native.close(r))]); await pool.end(); };
  process.on('SIGTERM', close); process.on('SIGINT', close);
}
main().catch(error => { console.error('Download UI fixture failed:', error.code || error.message); process.exitCode = 1; });
