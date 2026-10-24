'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const express=require('../../backend/node_modules/express'),bcrypt=require('../../backend/node_modules/bcryptjs');
const {createBusinessPool}=require('../../backend/business-db/connection'),{migrateBusinessDatabase}=require('../../backend/business-db/migrator');
const workspace=path.resolve(__dirname,'../..'),directory=path.join(workspace,'.tmp/erp-02d3a-files');
async function main(){
 const c=JSON.parse(await fs.readFile(process.env.ERP_FILES_ACCEPTANCE_CONFIG,'utf8'));const target=new URL(c.connectionString);
 if(target.hostname!=='127.0.0.1'||target.pathname!=='/erp_02d3a_files'||c.password.length<12||c.jwtSecret.length<32)throw Error('Explicit isolated files fixture required');
 const pool=await createBusinessPool({connectionString:c.connectionString});try{await migrateBusinessDatabase(pool);if((await pool.query('SELECT count(*)::int AS n FROM erp.installation')).rows[0].n||(await pool.query('SELECT count(*)::int AS n FROM erp.users')).rows[0].n)throw Error('Fresh empty fixture required');
 await pool.query("INSERT INTO erp.installation(id,server_id,organization_name,initialized_at,storage_mode) VALUES('default','02d3a500-0000-4000-8000-000000000002','隔离文件验收',now(),'relational')");const hash=await bcrypt.hash(c.password,12);for(const role of ['owner','staff','viewer'])await pool.query('INSERT INTO erp.users(id,email,name,role,password_hash) VALUES($1,$2,$3,$1,$4)',[role,`${role}@erp-files.example.test`,`Files-${role}`,hash]);
 await pool.query("INSERT INTO erp.models(id,name,source) VALUES('file-model','文件页面验收模型','original')");await pool.query("INSERT INTO erp.warehouses(id,code,name,is_default) VALUES('default','DEFAULT','验收仓库',true)");
 await pool.query("INSERT INTO erp.customers(id,code,name) VALUES('file-customer','FILE-C','附件验收客户')");
 await pool.query(`INSERT INTO erp.orders(id,number,customer_id,customer_snapshot,status,total,created_by) VALUES('file-order','FILE-001','file-customer','{"name":"附件验收客户"}','draft',1,'owner')`);
 await pool.query("INSERT INTO erp.order_items(order_id,id,position,model_id,model_name_snapshot,quantity,unit_price,subtotal) VALUES('file-order','file-order-line',0,'file-model','文件页面验收模型',1,1,1)");
 }finally{await pool.end()}
 const webroot=path.join(directory,'web-model-file-ui');await fs.access(path.join(webroot,'index.html'));
 Object.assign(process.env,{NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(c.apiPort),STORE_DRIVER:'postgres',DATABASE_URL:c.connectionString,JWT_SECRET:c.jwtSecret,AGENT_KEY_ENC_SECRET:c.jwtSecret,BOOTSTRAP_TOKEN:c.jwtSecret,AGENT_ENABLED:'false',OSS_ENABLED:'false',DATA_DIR:path.join(directory,'data'),UPLOAD_DIR:path.join(directory,'uploads'),CORS_ORIGINS:`http://127.0.0.1:${c.webPort}`});
 const app=require('../../backend/server');await app.start();const web=express();web.use(express.static(webroot));web.get('/{*path}',(_req,res)=>res.sendFile(path.join(webroot,'index.html')));
 const listener=await new Promise((resolve,reject)=>{const server=web.listen(c.webPort,'127.0.0.1',error=>error?reject(error):resolve(server))});
 await fs.writeFile(path.join(directory,'files-ui-ready.json'),JSON.stringify({pid:process.pid,apiPort:c.apiPort,webPort:c.webPort,serverId:'02d3a500-0000-4000-8000-000000000002'}));console.log('Isolated files UI ready');
 let closing=false;const close=async()=>{if(closing)return;closing=true;await new Promise(r=>listener.close(r));await app.shutdown('Files fixture')};process.on('SIGTERM',close);process.on('SIGINT',close);
}
main().catch(error=>{console.error('Files fixture startup failed:',error.code||error.message);process.exitCode=1});
