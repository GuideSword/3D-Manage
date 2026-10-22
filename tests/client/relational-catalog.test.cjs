'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {catalogChanges,catalogPayload,createRelationalCatalogApi}=require('../../utils/relationalCatalogCore.cjs');
const {createBusinessCommandController}=require('../../utils/masterDataCore.cjs');
const runtime={serverKey:'test-server',apiBaseUrl:'http://127.0.0.1/api',capabilities:{businessRulesVersion:2,relationalBusiness:true}};
const material={type:'PLA',brand:'精确耗材',color:'白色',diameter:'1.750000',unit:'kg',unitPrice:'99999999999999.123456',notes:''};
test('catalog form payload keeps exact decimals and read version, with explicit text clears and nullable diameter',()=>{
 assert.deepEqual(catalogPayload('materials',{...material,diameter:''},{id:'m',version:'9007199254740993'}),{id:'m',version:'9007199254740993',changes:{...material,diameter:null}});
 assert.equal(catalogChanges('materials',{unitPrice:'0'}).unitPrice,'0');
 assert.deepEqual(catalogPayload('models',{name:' 新模型 ',description:'',source:'original'},null),{name:'新模型',description:'',source:'original'});
 assert.deepEqual(catalogChanges('models',{description:''}),{description:''});
});
test('catalog rejects numeric precision loss, invalid decimals, unknown fields and invalid versions',()=>{
 for(const changes of [{unitPrice:1.1},{unitPrice:9007199254740992},{unitPrice:'1.0000001'},{unitPrice:'1e3'},{unitPrice:'-1'},{diameter:'0'},{unitPrice:''},{active:false}]) assert.throws(()=>catalogChanges('materials',changes));
 assert.throws(()=>catalogChanges('models',{name:' '}));assert.throws(()=>catalogChanges('models',{source:'foreign'}));assert.throws(()=>catalogChanges('models',{}));
 for(const version of [undefined,'0','9223372036854775807',9007199254740992])assert.throws(()=>catalogPayload('materials',material,{id:'m',version}));
});
test('catalog API forwards exact create/update/delete versions and fixed keys to registered relational endpoints',async()=>{
 const calls=[];const api=createRelationalCatalogApi({getRuntime:()=>runtime,request:async(path,options)=>{calls.push({path,...options});return {id:'x',unitPrice:material.unitPrice}}});
 await api.materials.create(material,'create-key');
 await api.materials.update('id/child',{version:'9007199254740993',changes:{notes:''}},'update-key');
 await api.models.delete('model','7','delete-key');
 assert.equal(calls[0].path,'/materials');assert.equal(JSON.parse(calls[0].body).unitPrice,material.unitPrice);
 assert.equal(calls[1].path,'/materials/id%2Fchild');assert.deepEqual(JSON.parse(calls[1].body),{version:'9007199254740993',changes:{notes:''}});
 assert.deepEqual(JSON.parse(calls[2].body),{version:'7'});
 for(let i=0;i<calls.length;i++)assert.deepEqual(calls[i].headers,{'X-Business-Rules-Version':'2','Idempotency-Key':['create-key','update-key','delete-key'][i]});
 assert.throws(()=>api.models.update('m',{version:'1',changes:{description:''}}));
});
test('catalog reads retain raw DTO decimals; missing relational capability never invokes the write transport',async()=>{
 let active=runtime,calls=0;const dto={id:'m',unitPrice:material.unitPrice,version:'9007199254740993'};
 const api=createRelationalCatalogApi({getRuntime:()=>active,request:async()=>{calls++;return dto}});
 assert.equal(await api.materials.getById('m'),dto);active={...runtime,capabilities:{}};
 assert.throws(()=>api.materials.create(material,'key'),{code:'MASTER_DATA_UNAVAILABLE'});assert.equal(calls,1);
});
test('catalog retries an unknown create result with same body/key and never creates twice',async()=>{
 let nonce=0,first=true;const commands=new Map(),sent=[];const api=createRelationalCatalogApi({getRuntime:()=>runtime,request:async(path,options)=>{
  const key=options.headers['Idempotency-Key'];sent.push({key,body:options.body});if(!commands.has(key))commands.set(key,{id:'only-model'});if(first){first=false;throw Object.assign(new Error('timeout'),{status:503})}return commands.get(key);
 }});const controller=createBusinessCommandController(()=>`catalog-${++nonce}`);const scope={serverKey:'test-server',userId:'owner',sessionEpoch:1};
 const payload=catalogPayload('models',{name:'模型',description:'',source:'original'});
 const send=(body,key)=>api.models.create(body,key);await assert.rejects(controller.run('model.create',payload,scope,send));
 await assert.rejects(controller.run('model.create',{...payload,name:'不同内容'},scope,send),{code:'BUSINESS_RETRY_PENDING'});
 await assert.rejects(controller.run('model.create',payload,{...scope,sessionEpoch:2},send),{code:'BUSINESS_RETRY_PENDING'});
 assert.equal((await controller.run('model.create',payload,scope,send)).id,'only-model');assert.equal(commands.size,1);assert.deepEqual(sent[0],sent[1]);assert.equal(await controller.run('model.create',payload,scope,send),null);
});
test('version conflict is definitive and permits an explicit reload to create a new command',async()=>{
 let nonce=0;const keys=[];const controller=createBusinessCommandController(()=>`edit-${++nonce}`);const scope={serverKey:'test-server',userId:'owner',sessionEpoch:1};
 const send=async(body,key)=>{keys.push(key);if(body.version==='1')throw Object.assign(new Error('conflict'),{status:409});return body};
 await assert.rejects(controller.run('material.update',catalogPayload('materials',material,{id:'m',version:'1'}),scope,send));
 const result=await controller.run('material.update',catalogPayload('materials',material,{id:'m',version:'2'}),scope,send);assert.equal(result.version,'2');assert.deepEqual(keys,['edit-1','edit-2']);
});
