'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('../../backend/node_modules/express');
const bcrypt = require('../../backend/node_modules/bcryptjs');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const { createMaterialService } = require('../../backend/modules/materials/service');
const { createModelService } = require('../../backend/modules/models/service');
const { createInventoryService } = require('../../backend/modules/inventory/service');
const { createPartnerService } = require('../../backend/modules/partners/service');
const fixtureId = '02d3a400-0000-4000-8000-000000000001';
const workspace = path.resolve(__dirname, '../..');
async function main() {
  const connectionString = process.env.ERP_CSV_ACCEPTANCE_DATABASE_URL;
  const target = new URL(connectionString);
  if (target.hostname !== '127.0.0.1' || target.pathname !== '/erp_02d3a_csv') throw Error('Explicit isolated inventory database required');
  const password = process.env.ERP_CSV_ACCEPTANCE_PASSWORD, jwtSecret = process.env.ERP_CSV_ACCEPTANCE_JWT_SECRET;
  if (typeof password !== 'string' || password.length < 12 || !jwtSecret || jwtSecret.length < 32) throw Error('Explicit fixture credentials required');
  const directory = path.join(workspace, '.tmp/erp-02d3a-csv');
  const apiPort = Number(process.env.ERP_CSV_ACCEPTANCE_API_PORT || 5846), webPort = Number(process.env.ERP_CSV_ACCEPTANCE_WEB_PORT || 5845);
  if ([apiPort, webPort].some(port => !Number.isInteger(port) || port < 1024 || port > 65535) || apiPort === webPort) throw Error('Invalid fixture ports');
  await fs.access(path.join(workspace, '.tmp/erp-02d3a-csv-web/index.html'));
  const pool = await createBusinessPool({ connectionString });
  let publicFixture;
  try {
    await migrateBusinessDatabase(pool);
    const current = (await pool.query("SELECT server_id FROM erp.installation WHERE id='default'")).rows[0];
    if (current) throw Error('Fresh empty fixture database required; do not reseed an existing target');
    if ((await pool.query('SELECT count(*)::int AS n FROM erp.users')).rows[0].n) throw Error('Fixture database must be empty');
    const hash = await bcrypt.hash(password, 12);
    await pool.query("INSERT INTO erp.installation(id,server_id,organization_name,initialized_at,storage_mode) VALUES('default',$1,'隔离CSV验收',now(),'relational')", [fixtureId]);
    for (const role of ['owner', 'staff', 'viewer']) await pool.query('INSERT INTO erp.users(id,email,name,role,password_hash) VALUES($1,$2,$3,$1,$4)', [role, `${role}@erp-csv.example.test`, `库存验收${role}`, hash]);
    await pool.query("INSERT INTO erp.warehouses(id,code,name,is_default) VALUES('default','DEFAULT','验收仓库',true)");
    const materials = createMaterialService(pool), models = createModelService(pool), inventory = createInventoryService(pool);
    let sequence = 0;
    const command = async (service, operation, payload) => (await service.execute({ actorId: 'owner', tokenVersion: '1', key: `csv-fixture-${++sequence}`, operation, payload })).body;
    const customer = await command(createPartnerService(pool, 'customers'), 'customer.create', { code: 'CSV-CUSTOMER', name: 'CSV客户' });
    const material = await command(materials, 'material.create', { type: 'PLA', brand: '库存精度耗材', color: '白色', unitPrice: '25.000001' });
    let firstLot, lastLot, firstModel;
    for (let index = 0; index < 205; index++) {
      const lot = await command(inventory, 'lot.create', { materialId: material.id, lotNo: `INV-${String(index).padStart(3,'0')}`, qty: index === 204 ? '9007199254740.993' : '1.001', notes: '真实初始入库' });
      if (!index) firstLot = lot;
      lastLot = lot;
      const model = await command(models, 'model.create', { name: `CSV-Model-${String(index).padStart(3,'0')}`, description: index === 0 ? '中文,逗号"引号"\n第二行' : '' });
      if (!index) firstModel = model;
      await command(materials, 'material.create', { type: 'PETG', brand: `CSV-Material-${String(index).padStart(3,'0')}`, color: '白色', unitPrice: '1' });
      if (index % 50 === 0) console.log(`Seeded real CSV fixture commands: ${index + 1}/205 batches`);
    }
    await pool.query("CREATE TABLE public.app_store(id text PRIMARY KEY,data jsonb NOT NULL); INSERT INTO public.app_store VALUES('default','{\"proof\":9007199254740993.01,\"fixture\":\"旧原文\"}')");
    const summary = (await inventory.summary({ actorId: 'owner', tokenVersion: '1' }, { materialId: material.id }))[0];
    publicFixture = { customer, material, firstLot, lastLot, firstModel, summary, models: 205, materials: 206, lots: 205 };
    await fs.writeFile(path.join(directory, 'csv-fixture.json'), JSON.stringify(publicFixture, null, 2));
  } finally { await pool.end(); }
  Object.assign(process.env, { NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(apiPort), STORE_DRIVER: 'postgres', DATABASE_URL: connectionString,
    JWT_SECRET: jwtSecret, AGENT_KEY_ENC_SECRET: jwtSecret, BOOTSTRAP_TOKEN: jwtSecret, AGENT_ENABLED: 'false', OSS_ENABLED: 'false',
    DATA_DIR: path.join(directory, 'inventory-data'), UPLOAD_DIR: path.join(directory, 'inventory-uploads'), CORS_ORIGINS: `http://127.0.0.1:${webPort}` });
  const app = require('../../backend/server');
  await app.start();
  const web = express();
  web.use(express.static(path.join(workspace, '.tmp/erp-02d3a-csv-web')));
  web.get('/{*path}', (_req, res) => res.sendFile(path.join(workspace, '.tmp/erp-02d3a-csv-web/index.html')));
  const listener = await new Promise((resolve, reject) => { const server = web.listen(webPort, '127.0.0.1', error => error ? reject(error) : resolve(server)); });
  await fs.writeFile(path.join(directory, 'csv-ui-ready.json'), JSON.stringify({ pid: process.pid, apiPort, webPort, serverId: fixtureId }));
  console.log(`Isolated CSV UI ready on 127.0.0.1:${webPort}, API ${apiPort}`);
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await new Promise(resolve => listener.close(resolve)); await app.shutdown('CSV UI fixture'); };
  process.on('SIGINT', () => close().catch(() => { process.exitCode = 1; }));
  process.on('SIGTERM', () => close().catch(() => { process.exitCode = 1; }));
}
main().catch(error => { console.error('Isolated CSV UI startup failed:', error.code || 'FIXTURE_FAILED'); process.exitCode = 1; });
