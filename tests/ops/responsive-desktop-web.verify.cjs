// Uses an isolated browser context and intercepted fixture APIs; never accesses production data.
const { chromium } = require(process.env.RESPONSIVE_PLAYWRIGHT_MODULE || 'playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(process.env.RESPONSIVE_WEB_DIR || '.tmp/responsive-web');
const output = path.resolve('.tmp/responsive-web-qa');
fs.mkdirSync(output, { recursive: true });
const api = 'http://localhost:59998/api';
const orders = [
 {id:'XL-1024',customer:{name:'拾光设计'},status:'in_progress',total:860,dueDate:'2026-10-26',createdAt:'2026-10-24'},
 {id:'XL-1023',customer:{name:'林间工作室'},status:'pending_review',total:2480,dueDate:'2026-10-28',createdAt:'2026-10-23'},
 {id:'XL-1022',customer:{name:'南岸创意'},status:'completed',total:1120,dueDate:'2026-10-24',createdAt:'2026-10-22'},
];
const server = http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));try{const body=fs.readFileSync(file);res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.png':'image/png','.ttf':'font/ttf','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(body)}catch{res.statusCode=404;res.end()}});
(async()=>{
 await new Promise(r=>server.listen(8198,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true, ...(process.env.RESPONSIVE_BROWSER_EXECUTABLE ? { executablePath: process.env.RESPONSIVE_BROWSER_EXECUTABLE } : {})});
 const errors=[];
 try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route(api+'/**',async route=>{
 const url=new URL(route.request().url());let body={};
 if(url.pathname==='/api/system/info')body={product:'3D Manage',serverId:'responsive-qa',initialized:true,apiVersion:'1',organizationName:'测试工坊'};
 else if(url.pathname==='/api/auth/login')body={token:'qa-fixture',user:{id:'qa-owner',name:'测试管理员',role:'owner',email:'qa@example.test'}};
 else if(url.pathname==='/api/auth/me')body={id:'qa-owner',name:'测试管理员',role:'owner',email:'qa@example.test'};
 else if(url.pathname==='/api/orders'){const selected=orders.filter(o=>!url.searchParams.get('status') || o.status===url.searchParams.get('status'));body={items:selected,total:selected.length};}
 else if(url.pathname.includes('/stock'))body={items:[],total:0};
 else body={items:[],total:0};
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://127.0.0.1:8198');
 await page.getByPlaceholder('例如 192.168.1.10:5000').fill(api);
 await page.getByRole('button',{name:'测试并保存',exact:true}).click();
 await page.getByPlaceholder('请输入邮箱').fill('qa@example.test');await page.getByPlaceholder('请输入密码').fill('test-password');
 await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByText('PRINT WORKSPACE',{exact:true}).waitFor();
 await page.waitForTimeout(800);
 const railWidth=await page.getByText('PRINT WORKSPACE',{exact:true}).evaluate(el=>el.parentElement.parentElement.parentElement.getBoundingClientRect().width);
 console.log('rail width:',railWidth);
 await page.screenshot({path:path.resolve(output,'desktop.png'),fullPage:true});
 assert.ok(railWidth<=240,`sidebar expanded to ${railWidth}px, expected <=240px`);
 await page.getByText('最近订单',{exact:true}).waitFor();
 for(const width of [1024,768,390,1440]){
 await page.setViewportSize({width,height:1000});await page.waitForTimeout(250);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 assert.equal(overflow,false,`page overflow at ${width}`);
 if(width===390){await page.getByRole('tab',{name:'首页',exact:true}).waitFor();await page.screenshot({path:path.resolve(output,'mobile.png'),fullPage:true});}
 }
 await page.emulateMedia({colorScheme:'dark'});await page.waitForTimeout(300);await page.screenshot({path:path.resolve(output,'desktop-dark.png'),fullPage:true});
 await page.getByRole('tab',{name:'订单',exact:true}).click();await page.getByText('订单中心',{exact:true}).waitFor();
 assert.deepEqual(errors,[]); console.log('PASS: rail width, breakpoints, mobile tabs, dark mode, order navigation, no runtime errors');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
