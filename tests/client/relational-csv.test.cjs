'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {csvDefinition,validateCsvExport,createRelationalCsvApi}=require('../../utils/relationalCsvCore.cjs');
const runtime={serverKey:'A',apiBaseUrl:'http://127.0.0.1/api',capabilities:{relationalBusiness:true,businessRulesVersion:2}};
test('templates use the domain required fields and leave ledger export-only',()=>{
 const {parseCsv}=require('../../backend/modules/adapters/csvCodec');
 const required={orders:['order_id','customer_id','quantity','unit_price'],models:['name'],materials:['type','brand','color','unit_price'],lots:['material_id','qty_g']};
 for(const [kind,headers] of Object.entries(required)){const d=csvDefinition(kind);assert.equal(d.canImport,true);for(const header of headers)assert.ok(d.header.split(',').includes(header));assert.deepEqual(parseCsv(d.header,{requiredHeaders:headers}),[])}
 assert.equal(csvDefinition('transactions').canImport,false);assert.throws(()=>csvDefinition('stockLots'));assert.match(csvDefinition('orders').hint,/客户ID/);assert.match(csvDefinition('lots').hint,/克/);
});
test('CSV writes preserve BOM whitespace multiline and exact decimal text, with fixed business key',async()=>{
 const calls=[],api=createRelationalCsvApi({getRuntime:()=>runtime,request:async(path,options)=>{calls.push({path,...options});return {imported:1}}});const csv='\ufeffmaterial_id,qty_g,notes\r\nm,9007199254740.993,"含逗号,及\n多行"\r\n';
 for(const kind of ['orders','models','materials','lots'])await api.importRecords(kind,{csv},'same-'+kind);
 assert.deepEqual(calls.map(x=>x.path),['/csv/orders','/csv/models','/csv/materials','/csv/lots']);for(let i=0;i<calls.length;i++){assert.equal(JSON.parse(calls[i].body).csv,csv);assert.equal(calls[i].method,'POST');assert.deepEqual(calls[i].headers,{'X-Business-Rules-Version':'2','Idempotency-Key':'same-'+['orders','models','materials','lots'][i]})}
});
test('invalid kind body key or export-only ledger cannot issue an import',()=>{
 let count=0;const api=createRelationalCsvApi({getRuntime:()=>runtime,request:()=>{count++}});
 for(const [kind,body,key] of [['transactions',{csv:'a\n1'},'x'],['other',{csv:'a\n1'},'x'],['models',{csv:'  '},'x'],['models',{csv:'a\n1',extra:true},'x'],['models',{csv:42},'x'],['models',{csv:'a\n1'},undefined]])assert.throws(()=>api.importRecords(kind,body,key));assert.equal(count,0);
});
test('import rejects more than 10MiB of UTF8 without changing valid Unicode content',()=>{
 const api=createRelationalCsvApi({getRuntime:()=>runtime,request:async()=>({imported:1})});assert.throws(()=>api.importRecords('models',{csv:'密'.repeat(3495254)},'oversize'));
});
test('exports use JSON snapshot endpoints and accept only supported filters',async()=>{
 const calls=[],file={filename:'资料.csv',contentType:'text/csv; charset=utf-8',count:0,content:'name\r\n'};const api=createRelationalCsvApi({getRuntime:()=>runtime,request:async(path,options)=>{calls.push({path,...options});return file}});
 for(const kind of ['orders','models','materials','lots','transactions'])assert.equal(await api.exportRecords(kind,kind==='transactions'?{search:'A & B'}:{search:'A & B',active:false}),file);
 assert.deepEqual(calls.map(x=>x.path),['/orders/export?search=A%20%26%20B&active=false','/models/export?search=A%20%26%20B&active=false','/materials/export?search=A%20%26%20B&active=false','/stock/export?type=lots&search=A%20%26%20B&active=false','/stock/export?type=transactions&search=A%20%26%20B']);
 for(const bad of [{limit:100},{active:'false'},{search:1}])assert.throws(()=>api.exportRecords('models',bad));assert.throws(()=>api.exportRecords('transactions',{active:true}));
});
test('invalid export result is an error rather than reported as a downloaded file',async()=>{
 const valid={filename:'models.csv',contentType:'text/csv',count:1,content:'name\r\n模型\r\n'};assert.equal(validateCsvExport(valid),valid);
 for(const patch of [{count:'1'},{count:-1},{content:null},{content:''},{filename:'../../secret.csv'},{filename:'file.exe'},{contentType:'application/json'}])assert.throws(()=>validateCsvExport({...valid,...patch}));
 const api=createRelationalCsvApi({getRuntime:()=>runtime,request:async()=>({items:[]})});await assert.rejects(api.exportRecords('models'));
});
test('legacy server capability never silently uses relational CSV',()=>{const api=createRelationalCsvApi({getRuntime:()=>({...runtime,capabilities:{}}),request:()=>assert.fail('no request')});assert.throws(()=>api.importRecords('models',{csv:'name\nA'},'x'))});

test('malformed successful import result remains uncertain rather than falsely reporting zero imports',async()=>{
 const api=createRelationalCsvApi({getRuntime:()=>runtime,request:async()=>({success:true})});await assert.rejects(api.importRecords('models',{csv:'name\nA'},'original'),e=>e.code==='CSV_IMPORT_RESULT_INVALID'&&e.status===undefined);
});
