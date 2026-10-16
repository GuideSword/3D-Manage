'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('../../backend/node_modules/express');
const bcrypt = require('../../backend/node_modules/bcryptjs');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const fixtureId = '02d3a000-0000-4000-8000-000000000001';
const workspace = path.resolve(__dirname, '../..');
async function main() {
  const connectionString = process.env.ERP_CATALOG_ACCEPTANCE_DATABASE_URL;
  const target = new URL(connectionString);
  if (target.hostname !== '127.0.0.1' || target.pathname !== '/erp_02d3a_acceptance') throw Error('Explicit isolated system acceptance database required');
  const password = process.env.ERP_CATALOG_ACCEPTANCE_PASSWORD, jwtSecret = process.env.ERP_CATALOG_ACCEPTANCE_JWT_SECRET;
  if (typeof password !== 'string' || password.length < 12 || !jwtSecret || jwtSecret.length < 32) throw Error('Explicit fixture credentials required');
  const directory = path.join(workspace, '.tmp/erp-02d3a');
  const apiPort = Number(process.env.ERP_CATALOG_ACCEPTANCE_API_PORT || 5826), webPort = Number(process.env.ERP_CATALOG_ACCEPTANCE_WEB_PORT || 5825);
  if ([apiPort, webPort].some(port => !Number.isInteger(port) || port < 1024 || port > 65535) || apiPort === webPort) throw Error('Invalid fixture ports');
  await fs.access(path.join(workspace, '.tmp/erp-02d3a-web/index.html'));
  const pool = await createBusinessPool({ connectionString });
  try {
    await migrateBusinessDatabase(pool);
    const current = (await pool.query("SELECT server_id FROM erp.installation WHERE id='default'")).rows[0];
    if (current && current.server_id !== fixtureId) throw Error('Fixture identity mismatch');
    if (!current) {
      if ((await pool.query('SELECT count(*)::int AS n FROM erp.users')).rows[0].n) throw Error('Fixture database must be empty');
      const hash = await bcrypt.hash(password, 12);
      await pool.query("INSERT INTO erp.installation(id,server_id,organization_name,initialized_at,storage_mode) VALUES('default',$1,'隔离资料验收',now(),'relational')", [fixtureId]);
      for (const role of ['owner', 'staff', 'viewer']) await pool.query('INSERT INTO erp.users(id,email,name,role,password_hash) VALUES($1,$2,$3,$1,$4)', [role, `${role}@erp-catalog.example.test`, `系统验收${role}`, hash]);
      await pool.query("INSERT INTO erp.customers(id,code,name) VALUES('customer-a','C001','验收客户')");
      await pool.query("INSERT INTO erp.models(id,name,source) VALUES('model-a','验收模型','original')");
      await pool.query("INSERT INTO erp.materials(id,type,brand,color,unit,unit_price) VALUES('material-a','PLA','验收耗材','白色','kg',25.000001)");
      await pool.query("INSERT INTO erp.warehouses(id,code,name,is_default) VALUES('default','DEFAULT','验收仓库',true)");
      await pool.query("INSERT INTO erp.stock_lots(id,material_id,warehouse_id,qty_mg,baseline_qty_mg,balance_status) SELECT 'low-'||s,'material-a','default',1000,0,'tracked' FROM generate_series(1,105) s");
      await pool.query("INSERT INTO erp.stock_lots(id,material_id,warehouse_id,qty_mg,baseline_qty_mg,balance_status) VALUES('boundary','material-a','default',100000,0,'tracked'),('above','material-a','default',100001,0,'tracked'),('unverified','material-a','default',1000,1000,'legacy_unverified')");
      const states = ['pending_review','pending_review','in_progress','draft'];
      for (let index = 0; index < states.length; index++) {
        const id = `system-order-${index}`;
        await pool.query("INSERT INTO erp.orders(id,number,customer_id,customer_snapshot,status,total,created_by,created_at) VALUES($1,$2,'customer-a','{\"name\":\"验收客户\"}',$3,0.01,'owner',$4)", [id, `SYSTEM-00${index + 1}`, states[index], `2026-10-16T0${index}:00:00Z`]);
        await pool.query("INSERT INTO erp.order_items(order_id,id,position,model_id,model_name_snapshot,quantity,unit_price,subtotal) VALUES($1,$2,0,'model-a','验收模型',0.001,5,0.01)", [id, `line-${index}`]);
      }
      await pool.query("CREATE TABLE public.app_store(id text PRIMARY KEY,data jsonb NOT NULL); INSERT INTO public.app_store VALUES('default','{\"proof\":9007199254740993.01,\"fixture\":\"旧原文\"}')");
    }
  } finally { await pool.end(); }
  Object.assign(process.env, { NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(apiPort), STORE_DRIVER: 'postgres', DATABASE_URL: connectionString,
    JWT_SECRET: jwtSecret, AGENT_KEY_ENC_SECRET: jwtSecret, BOOTSTRAP_TOKEN: jwtSecret, AGENT_ENABLED: 'false', OSS_ENABLED: 'false',
    DATA_DIR: path.join(directory, 'catalog-data'), UPLOAD_DIR: path.join(directory, 'catalog-uploads'), CORS_ORIGINS: `http://127.0.0.1:${webPort}` });
  const app = require('../../backend/server');
  await app.start();
  const web = express();
  web.use(express.static(path.join(workspace, '.tmp/erp-02d3a-web')));
  web.get('/{*path}', (_req, res) => res.sendFile(path.join(workspace, '.tmp/erp-02d3a-web/index.html')));
  const listener = await new Promise((resolve, reject) => { const server = web.listen(webPort, '127.0.0.1', error => error ? reject(error) : resolve(server)); });
  await fs.writeFile(path.join(directory, 'catalog-ui-ready.json'), JSON.stringify({ pid: process.pid, apiPort, webPort, serverId: fixtureId }));
  console.log(`Isolated catalog UI ready on 127.0.0.1:${webPort}, API ${apiPort}`);
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await new Promise(resolve => listener.close(resolve)); await app.shutdown('Catalog UI fixture'); };
  process.on('SIGINT', () => close().catch(() => { process.exitCode = 1; }));
  process.on('SIGTERM', () => close().catch(() => { process.exitCode = 1; }));
}
main().catch(error => { console.error('Isolated catalog UI startup failed:', error.code || 'FIXTURE_FAILED'); process.exitCode = 1; });
