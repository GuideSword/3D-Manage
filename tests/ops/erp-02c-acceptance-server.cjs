'use strict';
// Explicit disposable database only. Never use production DATABASE_URL as fallback.
const path = require('node:path');
const fs = require('node:fs/promises');
const express = require('../../backend/node_modules/express');
const bcrypt = require('../../backend/node_modules/bcryptjs');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const { createRelationalRouter } = require('../../backend/modules/adapters/http');
const { withBusinessTransaction } = require('../../backend/business-db/transaction');
const workspace = path.resolve(__dirname, '../..');
const fixtureServerId = '02c00000-0000-4000-8000-000000000001';
async function main() {
  const connectionString = process.env.ERP_02C_ACCEPTANCE_DATABASE_URL;
  const url = new URL(connectionString);
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/erp_02c_acceptance') throw new Error('Explicit loopback acceptance database required');
  const password = process.env.ERP_02C_ACCEPTANCE_PASSWORD;
  const jwtSecret = process.env.ERP_02C_ACCEPTANCE_JWT_SECRET;
  if (typeof password !== 'string' || password.length < 12 || !jwtSecret || jwtSecret.length < 32) throw new Error('Explicit test credentials required');
  const port = Number(process.env.ERP_02C_ACCEPTANCE_PORT || 5823);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid acceptance port');
  const directory = path.join(workspace, '.tmp/erp-02c');
  const uploadDirectory = path.join(directory, 'uploads');
  await fs.mkdir(uploadDirectory, { recursive: true });
  const pool = await createBusinessPool({ connectionString });
  await migrateBusinessDatabase(pool);
  const installation = (await pool.query("SELECT server_id FROM erp.installation WHERE id='default'")).rows[0];
  if (installation && installation.server_id !== fixtureServerId) throw new Error('Acceptance database identity mismatch');
  if (!installation) {
    if ((await pool.query('SELECT count(*)::int AS n FROM erp.users')).rows[0].n) throw new Error('Acceptance database is not empty');
    const hash = await bcrypt.hash(password, 12);
    await withBusinessTransaction(pool, async tx => {
      await tx.query("INSERT INTO erp.installation VALUES('default',$1,'隔离验收',now(),'relational')", [fixtureServerId]);
      for (const role of ['owner', 'staff', 'viewer']) await tx.query('INSERT INTO erp.users(id,email,name,role,password_hash) VALUES($1,$2,$3,$1,$4)', [role, `${role}@erp-02c.example.test`, `验收${role}`, hash]);
      await tx.query("INSERT INTO erp.warehouses(id,code,name,is_default) VALUES('default','DEFAULT','验收仓库',true)");
      await tx.query("INSERT INTO erp.customers(id,code,name,contact_name,phone) VALUES('customer-a','C001','同名客户','联系人甲','13800000001'),('customer-b','C002','同名客户','联系人乙','13800000002')");
      await tx.query("INSERT INTO erp.suppliers(id,code,name) VALUES('supplier-a','S001','验收供应商')");
      await tx.query("INSERT INTO erp.models(id,name,source) VALUES('model-a','验收模型','original')");
      await tx.query("INSERT INTO erp.materials(id,type,brand,color,unit,unit_price) VALUES('material-a','PLA','验收耗材','白色','kg',25.000001)");
    });
  }
  const app = express();
  // Local acceptance-only fault: lose one already-committed Android response.
  // Requires an explicit one-shot file and an ANDROID-RETRY fixture code.
  app.use((req, res, next) => {
    const json = res.json.bind(res);
    res.json = body => {
      if (req.method === 'POST' && req.originalUrl.split('?')[0] === '/api/customers' && res.statusCode === 201
        && typeof req.body?.code === 'string' && req.body.code.startsWith('ANDROID-RETRY-')) {
        const flag = path.join(directory, 'drop-next-android-response');
        const syncFs = require('node:fs');
        if (syncFs.existsSync(flag)) {
          syncFs.unlinkSync(flag);
          syncFs.writeFileSync(path.join(directory, 'android-response-dropped.json'), JSON.stringify({ code: req.body.code, utcTimestamp: new Date().toISOString(), committed: true }));
          res.destroy(); return res;
        }
      }
      return json(body);
    };
    next();
  });
  app.use('/api', createRelationalRouter(pool, { jwtSecret, uploadDirectory }));
  app.use(express.static(path.join(workspace, '.tmp/erp-02c-web')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(workspace, '.tmp/erp-02c-web/index.html')));
  const server = app.listen(port, '127.0.0.1', async () => {
    await fs.writeFile(path.join(directory, 'ready.json'), JSON.stringify({ pid: process.pid, port, serverId: fixtureServerId }));
    console.log(`ERP 02C isolated acceptance ready on http://127.0.0.1:${port}`);
  });
  let closing = false;
  const close = () => { if (closing) return; closing = true; server.close(() => pool.end().then(() => process.exit(0))); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
}
main().catch(() => { console.error('Unable to start isolated acceptance server; production storage was not selected.'); process.exit(1); });
