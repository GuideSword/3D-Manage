'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createBusinessPool}=require('../../backend/business-db/connection');
const {createModelService}=require('../../backend/modules/models/service');
async function main(){
 const config=JSON.parse(await fs.readFile(process.argv[2],'utf8')),directory=path.dirname(path.resolve(process.argv[2])),target=new URL(config.connectionString);
 assert.equal(target.hostname,'127.0.0.1');assert.equal(target.pathname,'/erp_02d3a_files');
 const pool=await createBusinessPool({connectionString:config.connectionString});assert.equal((await pool.query("SELECT server_id FROM erp.installation WHERE id='default'")).rows[0].server_id,'02d3a500-0000-4000-8000-000000000002');
 const browser=await require(process.env.ERP_02C_PLAYWRIGHT_MODULE).chromium.launch({headless:true,executablePath:process.env.ERP_02C_BROWSER_EXECUTABLE});
 const origin=`http://127.0.0.1:${config.webPort}`,api=`http://127.0.0.1:${config.apiPort}/api`,checks=[],errors=[];let page;
 const report=path.join(directory,'model-file-web-verification.json');
 const pass=value=>{checks.push(value);console.log(value)};
 const button=name=>page.getByRole('button',{name,exact:true}).filter({visible:true}).first();
 const facts=async()=> (await pool.query('SELECT (SELECT count(*)::int FROM erp.object_uploads) uploads,(SELECT count(*)::int FROM erp.model_files) files,(SELECT count(*)::int FROM erp.model_images) images')).rows[0];
 const pick=async(label,file)=>{const chooser=page.waitForEvent('filechooser');await button(label).click();await(await chooser).setFiles(file)};
 async function login(role){const context=await browser.newContext({viewport:{width:1366,height:1100},acceptDownloads:true});page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(origin);await page.getByPlaceholder('例如 192.168.1.10:5000').fill(api);await button('测试并保存').click();await page.getByPlaceholder('请输入邮箱').fill(`${role}@erp-files.example.test`);await page.getByPlaceholder('请输入密码').fill(config.password);await button('登录').click();await page.getByText('模型',{exact:true}).filter({visible:true}).last().click();await page.getByText('文件页面验收模型',{exact:true}).click();await page.getByText('模型概览',{exact:true}).waitFor();return context}
 try{
 await login('owner');const bytes=Buffer.from('solid page\nendsolid');const sent=[];let lost=true;
 await page.route(api+'/models/file-model/files/add',async route=>{sent.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});if(lost){lost=false;const response=await route.fetch();assert.equal(response.status(),201);return route.abort('failed')}return route.continue()});
 await pick('上传模型文件',{name:'web-part.stl',mimeType:'application/octet-stream',buffer:bytes});await button('重试原文件操作').waitFor();assert.deepEqual(await facts(),{uploads:1,files:1,images:0});assert.equal(await button('编辑模型').isDisabled(),true);
 await button('重试原文件操作').click();await page.getByText('web-part.stl',{exact:true}).waitFor();assert.deepEqual(sent[0],sent[1]);assert.deepEqual(await facts(),{uploads:1,files:1,images:0});pass('实际页面上传后登记丢响应：原键重试、一次上传/一次关联、冻结编辑');await page.unroute(api+'/models/file-model/files/add');
 const download=page.waitForEvent('download');await button('下载').click();const item=await download;assert.equal(await item.failure(),null);assert.deepEqual(await fs.readFile(await item.path()),bytes);pass('页面受保护下载的真实字节与上传一致');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM7sAAAAASUVORK5CYII=','base64');
 await pick('添加图片',{name:'cover.png',mimeType:'image/png',buffer:png});await page.getByRole('button',{name:'放大查看封面图',exact:true}).waitFor();assert.deepEqual(await facts(),{uploads:2,files:1,images:1});pass('实际页面图片上传及封面登记');
 await page.getByRole('button',{name:'放大查看封面图',exact:true}).click();await button('关闭图片预览').waitFor();
 const preview=page.getByText('双指缩放 · 放大后拖动',{exact:true}).locator('..');await preview.locator('img').first().waitFor({state:'attached'});
 await page.waitForFunction(node=>[...node.querySelectorAll('img')].some(image=>image.complete&&image.naturalWidth===1),await preview.elementHandle());
 await page.screenshot({path:path.join(directory,'model-file-preview.png'),fullPage:true});await button('关闭图片预览').click();pass('受保护图片实际解码，并可打开/关闭大图预览');
 await page.getByRole('button',{name:'删除cover.png',exact:true}).click();await page.waitForFunction(()=>!document.body.innerText.includes('正在保存文件关联'));await page.getByText('暂无图片',{exact:true}).waitFor();assert.deepEqual(await facts(),{uploads:2,files:1,images:0});pass('实际页面移除图片并刷新，物理上传事实保留');
 let conflict=true;const registrations=[],service=createModelService(pool,{uploadDirectory:path.join(directory,'uploads')});
 await page.route(api+'/models/file-model/files/add',async route=>{registrations.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});if(conflict){conflict=false;const current=await service.get({actorId:'owner',tokenVersion:'1'},'file-model');await service.execute({actorId:'owner',tokenVersion:'1',key:'concurrent-file-web-edit',operation:'model.update',payload:{id:current.id,version:current.version,changes:{description:'并发修改，需要核对'}}})}return route.continue()});
 await pick('上传模型文件',{name:'conflict.stl',mimeType:'application/octet-stream',buffer:Buffer.from('solid conflict\nendsolid')});await button('重新加载并核对记录').waitFor();assert.equal((await facts()).uploads,3);await button('重新加载并核对记录').click();await page.getByText('并发修改，需要核对',{exact:true}).waitFor();await button('重试原文件操作').click();await page.getByText('conflict.stl',{exact:true}).waitFor();assert.equal((await facts()).uploads,3);assert.equal((await facts()).files,2);assert.notEqual(registrations[0].key,registrations[1].key);assert.deepEqual(registrations[0].body.file,registrations[1].body.file);pass('实际页面版本冲突保留已上传文件，显式重载后只重试登记');await page.unroute(api+'/models/file-model/files/add');
 await button('移除文件').click();await page.getByText('web-part.stl',{exact:true}).waitFor({state:'hidden'});assert.equal((await facts()).files,1);pass('实际页面按服务器子文件ID移除关联');
 await page.screenshot({path:path.join(directory,'model-file-owner.png'),fullPage:true});
 await login('viewer');assert.equal(await button('上传模型文件').count(),0);assert.equal(await button('添加图片').count(),0);assert.equal(await button('移除文件').count(),0);assert.equal(await button('下载').count(),1);pass('Viewer可读下载，页面不显示上传/移除');
 assert.deepEqual(errors,[]);await fs.writeFile(report,JSON.stringify({result:'passed',checks,pageErrors:errors},null,2));
 }catch(error){if(page){await fs.writeFile(path.join(directory,'model-file-web-failure.txt'),await page.locator('body').innerText());await page.screenshot({path:path.join(directory,'model-file-web-failure.png'),fullPage:true})}await fs.writeFile(report,JSON.stringify({result:'failed',checks,error:error.message,pageErrors:errors},null,2));throw error}
 finally{await browser.close();await pool.end()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
