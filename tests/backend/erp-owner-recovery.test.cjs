'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const bcrypt=require('../../backend/node_modules/bcryptjs');
const {promisify}=require('node:util');const execFile=promisify(require('node:child_process').execFile);
const {createBusinessPool}=require('../../backend/business-db/connection');
const {migrateBusinessDatabase}=require('../../backend/business-db/migrator');
const {createMaintenanceService}=require('../../backend/business-db/maintenance');
const {createRelationalServices}=require('../../backend/modules/adapters/services');
const {createHostOwnerRecovery}=require('../../backend/modules/users/hostRecovery');
const {parseArguments}=require('../../backend/scripts/erp-owner-recovery');
const serverId='11111111-1111-4111-8111-111111111111';
const databaseUrl=process.env.ERP_BUSINESS_TEST_DATABASE_URL;
const base=['--target-env','ERP_OWNER_FIXTURE_DATABASE_URL','--server-id',serverId,'--user-id','owner'];
const resetFlags=['--expected-version','1','--reason','隔离恢复','--password-env','ERP_OWNER_FIXTURE_NEW_PASSWORD'];
test('host recovery CLI explicitly binds identity/user/version and accepts password only via named environment',()=>{
 assert.equal(parseArguments(['status',...base]).action,'status');assert.equal(parseArguments(['reset',...base,...resetFlags]).passwordEnvironment,'ERP_OWNER_FIXTURE_NEW_PASSWORD');
 for(const args of [[],['status'],['reset',...base],['status',...base,...resetFlags],['reset',...base,...resetFlags,'--password','secret'],['reset',...base,...resetFlags,'--reason','duplicate'],['reset',...base,...resetFlags.slice(2)],['reset',...base,...resetFlags.slice(0,4),'--password-env','bad-name']])assert.throws(()=>parseArguments(args),{code:'OWNER_RECOVERY_ARGUMENTS_INVALID'});
});
test('host recovery only resets an existing Owner during maintenance, atomically invalidating sessions', {skip:!databaseUrl}, async t=>{
 const url=new URL(databaseUrl);assert.equal(url.pathname,'/erp_02a_verify');assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
 const pool=await createBusinessPool({connectionString:databaseUrl});t.after(()=>pool.end());await migrateBusinessDatabase(pool);
 await pool.query("INSERT INTO erp.installation(id,server_id,organization_name,initialized_at,storage_mode) VALUES('default',$1,'恢复隔离',now(),'relational')",[serverId]);
 const oldPassword='Old-Owner-Fixture-2026!',newPassword='New-Owner-Fixture-2026!';const hash=await bcrypt.hash(oldPassword,12);
 for(const role of ['owner','staff','viewer'])await pool.query('INSERT INTO erp.users(id,email,name,role,password_hash) VALUES($1,$2,$1,$1,$3)',[role,role+'@host.example.test',hash]);
 const recovery=createHostOwnerRecovery(pool),maintenance=createMaintenanceService(pool);
 const target={expectedServerId:serverId,userId:'owner'},request={...target,expectedVersion:'1',reason:'隔离恢复',newPassword};
 const state=async next=>maintenance.setState({expectedServerId:serverId,expectedVersion:(await maintenance.status({expectedServerId:serverId})).version,state:next,reason:'隔离恢复维护'});
 const facts=async()=>JSON.stringify((await pool.query("SELECT jsonb_build_object('users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM erp.users u),'audit',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM erp.audit_logs a)) AS facts")).rows[0].facts);
 const services=createRelationalServices(pool,{jwtSecret:'owner-recovery-test-only-secret-32-bytes-long'});
 const oldLogin=await services.authentication.login({email:'owner@host.example.test',password:oldPassword});
 const staffLogin=await services.authentication.login({email:'staff@host.example.test',password:oldPassword});
 await t.test('status is read only and rejects wrong identity, role, fields and open recovery',async()=>{
  const before=await facts();const status=await recovery.status(target);assert.equal(status.user.id,'owner');assert.equal(status.user.version,'1');assert.equal(status.state,'open');assert.doesNotMatch(JSON.stringify(status),/password|token_version|hash/i);
  await assert.rejects(recovery.reset(request),{code:'OWNER_RECOVERY_REQUIRES_MAINTENANCE'});
  await assert.rejects(recovery.status({...target,expectedServerId:'22222222-2222-4222-8222-222222222222'}),{code:'ERP_STORAGE_IDENTITY_MISMATCH'});
  await assert.rejects(recovery.status({...target,userId:'staff'}),{code:'OWNER_RECOVERY_OWNER_REQUIRED'});
  await assert.rejects(recovery.reset({...request,newPassword:'weak'}),{code:'PASSWORD_INVALID'});
  await assert.rejects(recovery.reset({...request,role:'owner'}));assert.equal(await facts(),before);
 });
 await state('maintenance');
 await t.test('legacy mode, missing maintenance state and exhausted token versions fail without changes',async()=>{
  const before=await facts();
  await pool.query("UPDATE erp.installation SET storage_mode='legacy'");
  try{await assert.rejects(recovery.reset(request),{code:'OWNER_RECOVERY_REQUIRES_RELATIONAL'});}finally{await pool.query("UPDATE erp.installation SET storage_mode='relational'")}
  const control=(await pool.query("SELECT * FROM erp.runtime_control WHERE id='default'")).rows[0];await pool.query("DELETE FROM erp.runtime_control WHERE id='default'");
  try{await assert.rejects(recovery.reset(request),{code:'MAINTENANCE_STATE_INVALID'});}finally{await pool.query('INSERT INTO erp.runtime_control(id,state,reason,version,updated_at) VALUES($1,$2,$3,$4,$5)',[control.id,control.state,control.reason,control.version,control.updated_at])}
  await pool.query("UPDATE erp.users SET token_version=9223372036854775806 WHERE id='owner'");
  try{await assert.rejects(recovery.reset(request),{code:'OWNER_RECOVERY_VERSION_EXHAUSTED'});}finally{await pool.query("UPDATE erp.users SET token_version=1 WHERE id='owner'")}
  assert.equal(await facts(),before);
 });
 await t.test('audit failure rolls back password, active state and both versions',async()=>{
  await pool.query("ALTER TABLE erp.audit_logs ADD CONSTRAINT reject_owner_recovery CHECK(action<>'owner.recover') NOT VALID");const before=await facts();
  try{await assert.rejects(recovery.reset(request));assert.equal(await facts(),before);}finally{await pool.query('ALTER TABLE erp.audit_logs DROP CONSTRAINT reject_owner_recovery')}
 });
 await t.test('successful reset preserves Owner identity and revokes old sessions without credentials in audit',async()=>{
  const unchanged=(await pool.query("SELECT to_jsonb(u)::text AS raw FROM erp.users u WHERE id='staff'")).rows[0].raw;
  const result=await recovery.reset(request);assert.equal(result.user.version,'2');assert.equal(result.sessionsRevoked,true);assert.equal(result.user.active,true);
  const user=(await pool.query("SELECT * FROM erp.users WHERE id='owner'")).rows[0];assert.equal(user.token_version,'2');assert.equal(user.role,'owner');assert.equal(user.email,'owner@host.example.test');assert.ok(await bcrypt.compare(newPassword,user.password_hash));assert.ok(!await bcrypt.compare(oldPassword,user.password_hash));
  assert.equal(await services.authentication.authenticate(oldLogin.token),null);assert.equal((await services.authentication.authenticate(staffLogin.token)).actorId,'staff');await assert.rejects(services.users.me({actorId:'owner',tokenVersion:'1'}),{status:401});assert.equal((await services.users.me({actorId:'owner',tokenVersion:'2'})).id,'owner');
  const audit=(await pool.query("SELECT actor_id,diff FROM erp.audit_logs WHERE action='owner.recover'")).rows;assert.equal(audit.length,1);assert.equal(audit[0].actor_id,null);assert.equal(audit[0].diff.source,'host');assert.doesNotMatch(JSON.stringify(audit),/password|hash|New-Owner|Old-Owner/i);
  assert.equal((await pool.query("SELECT to_jsonb(u)::text AS raw FROM erp.users u WHERE id='staff'")).rows[0].raw,unchanged);
  const before=await facts();await assert.rejects(recovery.reset(request),{code:'VERSION_CONFLICT'});assert.equal(await facts(),before);
 });
 await t.test('inactive Owner can recover but Staff/Viewer cannot be promoted; missing guards fail closed',async()=>{
  for(const userId of ['staff','viewer'])await assert.rejects(recovery.reset({...request,userId}),{code:'OWNER_RECOVERY_OWNER_REQUIRED'});
  await pool.query("INSERT INTO erp.users(id,email,name,role,password_hash) VALUES('other-owner','other@host.example.test','Other Owner','owner',$1)",[hash]);
  await pool.query("UPDATE erp.users SET active=false WHERE id='owner'");
  const result=await recovery.reset({...request,expectedVersion:'2'});assert.equal(result.user.active,true);assert.equal(result.user.version,'3');
  const before=await facts();await pool.query("DELETE FROM erp.user_write_guard WHERE id='default'");
  try{await assert.rejects(recovery.reset({...request,expectedVersion:'3'}),{code:'ERP_USER_GUARD_MISSING'});assert.equal(await facts(),before);}finally{await pool.query("INSERT INTO erp.user_write_guard(id) VALUES('default')")}
 });
 await t.test('maintenance exit waits for recovery holding shared maintenance lock behind user guard',async()=>{
  const blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query("SELECT id FROM erp.user_write_guard WHERE id='default' FOR UPDATE");
  let resetting,leaving;try{
   resetting=recovery.reset({...request,expectedVersion:'3'});resetting.catch(()=>{});
   const deadline=Date.now()+10000;let waiting=false;
   while(Date.now()<deadline){const r=await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%user_write_guard%' AND pid<>pg_backend_pid()");if(r.rowCount){waiting=true;break}await new Promise(r=>setTimeout(r,20))}assert.ok(waiting,'recovery blocked on user guard');
   leaving=state('open');leaving.catch(()=>{});let exclusive=false;
   while(Date.now()<deadline){const r=await pool.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=17042026 AND objid=3 AND NOT granted");if(r.rowCount){exclusive=true;break}await new Promise(r=>setTimeout(r,20))}assert.ok(exclusive,'maintenance exit blocked on recovery');
   await blocker.query('COMMIT');assert.equal((await resetting).user.version,'4');assert.equal((await leaving).state,'open');
  }finally{await blocker.query('ROLLBACK');blocker.release();await Promise.allSettled([resetting,leaving].filter(Boolean))}
 });
 await assert.rejects(services.authentication.login({email:'owner@host.example.test',password:oldPassword}),{code:'AUTHENTICATION_FAILED'});
 assert.equal((await services.authentication.login({email:'owner@host.example.test',password:newPassword})).user.id,'owner');
 await t.test('legacy recovery command refuses relational storage before loading or writing old store',async()=>{
  await pool.query("CREATE TABLE public.app_store(id text PRIMARY KEY,data jsonb NOT NULL); INSERT INTO public.app_store VALUES('default','{\"proof\":9007199254740993.01}')");
  const raw=async()=>(await pool.query('SELECT data::text AS raw FROM public.app_store')).rows[0].raw;const before=await raw();
  const failed=await execFile(process.execPath,['backend/scripts/reset-owner-password.js','owner'],{env:{...process.env,STORE_DRIVER:'postgres',DATABASE_URL:databaseUrl},timeout:20000}).catch(e=>e);
  assert.equal(failed.code,1);assert.match(failed.stderr,/erp-owner-recovery/);assert.equal(await raw(),before);assert.ok(!failed.stderr.includes(databaseUrl));
 });
 await t.test('actual host CLI returns public status and never prints secret connection/password/hash',async()=>{
  const env={...process.env,ERP_OWNER_FIXTURE_DATABASE_URL:databaseUrl,ERP_OWNER_FIXTURE_NEW_PASSWORD:newPassword};
  const run=await execFile(process.execPath,['backend/scripts/erp-owner-recovery.js','status',...base],{env,timeout:20000});assert.equal(JSON.parse(run.stdout).user.version,'4');assert.doesNotMatch(run.stdout,/password|hash|postgres:/i);
  const failed=await execFile(process.execPath,['backend/scripts/erp-owner-recovery.js','reset',...base,...resetFlags],{env,timeout:20000}).catch(e=>e);assert.equal(failed.code,1);assert.ok(!failed.stderr.includes(newPassword));assert.ok(!failed.stderr.includes(databaseUrl));
  await state('maintenance');
  try{const resetArgs=resetFlags.map((v,i)=>i===1?'4':v);const success=await execFile(process.execPath,['backend/scripts/erp-owner-recovery.js','reset',...base,...resetArgs],{env,timeout:20000});assert.equal(JSON.parse(success.stdout).user.version,'5');assert.ok(!success.stdout.includes(newPassword));assert.doesNotMatch(success.stdout,/password|hash|postgres:/i);}finally{await state('open')}
  const missingEnv={...env};delete missingEnv.ERP_OWNER_FIXTURE_NEW_PASSWORD;const missing=await execFile(process.execPath,['backend/scripts/erp-owner-recovery.js','reset',...base,...resetFlags],{env:missingEnv,timeout:20000}).catch(e=>e);assert.equal(missing.code,1);assert.equal(JSON.parse(missing.stderr).code,'OWNER_RECOVERY_ARGUMENTS_INVALID');
 });
});
