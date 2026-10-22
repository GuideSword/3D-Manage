'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRelationalFileCommand}=require('../../utils/relationalFileCommandCore.cjs');
const original=Object.assign(new Blob(['solid a\nendsolid']),{name:'part.stl'});
const uploaded={uploadId:'u',fileKey:'models/key.stl',fileUrl:'/api/files/models/key.stl',sha256:'hash',size:'16',originalName:'part.stl',name:'part.stl'};
function fixture(overrides={}) {let serial=0;let scope={serverKey:'s',sessionEpoch:1,userId:'owner'};const calls=[];const api={upload:async(...args)=>{calls.push(['upload',...args]);return uploaded},add:async(...args)=>{calls.push(['add',...args]);return {id:'m',version:'8',files:[uploaded]}},remove:async(...args)=>{calls.push(['remove',...args]);return {id:'m',version:'8',files:[]}},...overrides};const controller=createRelationalFileCommand({api,createKey:()=>`file-${++serial}`,getScope:()=>scope});return {controller,calls,setScope:value=>{scope=value}};}
const input=()=>({entity:'models',record:{id:'m',version:'7'},child:'files',file:original});
test('known upload is retained after unknown registration result and retry sends only original association',async()=>{
 let first=true;const sent=[];const {controller,calls}=fixture({add:async(...args)=>{sent.push(args);if(first){first=false;throw new Error('timeout')}return {id:'m',version:'8'}}});
 await assert.rejects(controller.start(input()));assert.equal(controller.getState().uploaded.uploadId,'u');assert.equal(controller.getState().phase,'registering');
 await controller.retry();assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);assert.equal(calls.filter(x=>x[0]==='upload').length,1);assert.equal(controller.getState().pending,false);
});
test('unknown upload retry preserves original Blob and fixed upload key; no register before confirmed upload',async()=>{
 const calls=[];let once=true;const {controller}=fixture({upload:async(...args)=>{calls.push(args);if(once){once=false;throw new Error('timeout')}return uploaded}});
 await assert.rejects(controller.start(input()));assert.equal(controller.getState().phase,'uploading');await assert.rejects(controller.start({...input(),file:Object.assign(new Blob(['different']),{name:'other.stl'})}),{code:'FILE_RETRY_PENDING'});
 await controller.retry();assert.equal(calls.length,2);assert.equal(calls[0][1],original);assert.equal(calls[0][2],calls[1][2]);
});
test('version conflict retains uploaded bytes and requires explicit same-record reload before retry',async()=>{
 const calls=[];const {controller}=fixture({add:async(...args)=>{calls.push(args);if(args[3].version==='7')throw Object.assign(new Error('changed'),{status:409,code:'VERSION_CONFLICT'});return {id:'m',version:'10'}}});
 await assert.rejects(controller.start(input()));assert.equal(controller.getState().phase,'conflict');await assert.rejects(controller.retry(),{code:'FILE_CONFLICT_RELOAD_REQUIRED'});
 assert.throws(()=>controller.rebase({id:'another',version:'9'}));controller.rebase({id:'m',version:'9'});await controller.retry();
 assert.equal(calls.length,2);assert.equal(calls[1][3].version,'9');assert.notEqual(calls[0][4],calls[1][4]);assert.deepEqual(calls[0][3].file,calls[1][3].file);
});
test('scope invalidation during upload prevents registration and blocks retries into another session',async()=>{
 let finish;const wait=new Promise(resolve=>{finish=resolve});const {controller,calls,setScope}=fixture({upload:async()=>wait});const task=controller.start(input());
 setScope({serverKey:'other',sessionEpoch:2,userId:'owner'});finish(uploaded);await assert.rejects(task,{code:'STALE_SESSION'});assert.equal(calls.length,0);await assert.rejects(controller.retry(),{code:'STALE_SESSION'});
});
test('remove retries exact child identity/version/key; definitive rejection is cancellable',async()=>{
 let once=true;const sent=[];const {controller}=fixture({remove:async(...args)=>{sent.push(args);if(once){once=false;throw new Error('lost')}return {id:'o',version:'5'}}});
 await assert.rejects(controller.remove({entity:'orders',record:{id:'o',version:'4'},child:'attachments',position:3}));assert.equal(controller.getState().uncertain,true);assert.throws(()=>controller.cancel(),{code:'FILE_RETRY_PENDING'});
 await controller.retry();assert.deepEqual(sent[0],sent[1]);assert.deepEqual(sent[0][3],{version:'4',position:3});
 const rejected=fixture({remove:async()=>{throw Object.assign(new Error('referenced'),{status:409,code:'ENTITY_REFERENCED'})}}).controller;
 await assert.rejects(rejected.remove({...input(),childId:'child'}));assert.equal(rejected.getState().uncertain,false);rejected.cancel();assert.equal(rejected.getState().pending,false);
});
test('concurrent submit does not upload twice and finished commands can be used for a different file',async()=>{
 let finish;const wait=new Promise(r=>{finish=r});let count=0;const {controller}=fixture({upload:async()=>{count++;return wait}});
 const a=controller.start(input());assert.equal(await controller.retry(),null);finish(uploaded);await a;await controller.start(input());assert.equal(count,2);
});
test('invalid starting record and signed-out scope never enter the file transport',async()=>{
 const {controller,calls,setScope}=fixture();await assert.rejects(controller.start({...input(),record:{id:'m'}}));setScope({serverKey:'s',sessionEpoch:1,userId:null});await assert.rejects(controller.start(input()));assert.equal(calls.length,0);
});

test('an unchanged version in a success response remains uncertain and keeps the original operation',async()=>{
 const {controller}=fixture({add:async()=>({id:'m',version:'7'})});
 await assert.rejects(controller.start(input()),{code:'FILE_SAVE_RESULT_INVALID'});assert.equal(controller.getState().uncertain,true);assert.equal(controller.getState().uploaded.uploadId,'u');
});
test('native file retry freezes picker name/uri and image metadata at the initial command',async()=>{
 const selected={name:'cover.png',uri:'file:///cache/original.png',type:'image/png'};const metadata={type:'cover'};const sent=[];let once=true;
 const {controller}=fixture({upload:async(...args)=>{sent.push({...args[1]});if(once){once=false;throw new Error('lost')}return uploaded}});
 await assert.rejects(controller.start({entity:'models',record:{id:'m',version:'7'},child:'images',file:selected,metadata}));
 selected.name='changed.png';selected.uri='file:///cache/changed.png';metadata.type='other';await controller.retry();
 assert.equal(sent[1].name,'cover.png');assert.equal(sent[1].uri,'file:///cache/original.png');
});
