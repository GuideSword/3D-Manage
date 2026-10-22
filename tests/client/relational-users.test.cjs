'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRelationalUsersApi,userCreate,userChanges,ownPasswordPayload,validatePassword}=require('../../utils/relationalUsersCore.cjs');
const runtime={serverKey:'A',apiBaseUrl:'http://127.0.0.1/api',capabilities:{relationalBusiness:true,businessRulesVersion:2}};
const password='  password-12345  ';
test('user creation normalizes identity but preserves password bytes',()=>{
 assert.deepEqual(userCreate({name:' Alice ',email:' ALICE@example.test ',role:'staff',password}),{name:'Alice',email:'alice@example.test',role:'staff',password});
 for(const changes of [{role:'owner'},{role:'other'},{name:''},{email:'bad'},{password:'short'},{extra:'x'}])assert.throws(()=>userCreate({name:'Alice',email:'a@example.test',role:'viewer',password,...changes}));
});
test('password validates 12 characters and 72 UTF8 bytes without truncating',()=>{
 assert.equal(validatePassword(password),password);assert.equal(validatePassword('密'.repeat(24)),'密'.repeat(24));assert.equal(validatePassword('a'.repeat(72)),'a'.repeat(72));
 for(const bad of ['a'.repeat(73),'密'.repeat(25),'a'.repeat(11),null,12,'\ud800'.repeat(12)])assert.throws(()=>validatePassword(bad));
});
test('user edits accept only name role active and keep false',()=>{
 assert.deepEqual(userChanges({name:' Alice ',active:false,role:'viewer'}),{name:'Alice',active:false,role:'viewer'});
 for(const value of [{},{name:''},{active:'false'},{role:'admin'},{email:'changed@example.test'},{password:'secret'},{tokenVersion:'99'},null])assert.throws(()=>userChanges(value));
});
test('own password payload carries read version and never sends confirmation',()=>{
 assert.deepEqual(ownPasswordPayload({currentPassword:'current',newPassword:password,confirmPassword:password},{id:'self',version:'9007199254740993'}),{version:'9007199254740993',currentPassword:'current',newPassword:password});
 assert.throws(()=>ownPasswordPayload({currentPassword:'',newPassword:password,confirmPassword:password},{version:'1'}));assert.throws(()=>ownPasswordPayload({currentPassword:'old',newPassword:password,confirmPassword:'different'},{version:'1'}));assert.throws(()=>ownPasswordPayload({currentPassword:'old',newPassword:password,confirmPassword:password},{}));
});
test('all account writes carry explicit key business version read version and canonical DTO',async()=>{
 const calls=[];const api=createRelationalUsersApi({getRuntime:()=>runtime,request:async(path,options)=>{calls.push({path,...options});return {}}});
 await api.create({name:'A',email:'a@example.test',role:'staff',password},'create');await api.update('u/a',{version:'9007199254740993',changes:{name:' B ',active:false}},'edit');await api.resetPassword('u/a',{version:'3',password},'reset');await api.delete('u/a','4','delete');await api.changeOwnPassword({version:'5',currentPassword:'old',newPassword:password},'self');
 assert.deepEqual(calls.map(x=>x.path),['/users','/users/u%2Fa','/users/u%2Fa/reset-password','/users/u%2Fa','/auth/change-password']);assert.deepEqual(calls.map(x=>x.method),['POST','PATCH','POST','DELETE','POST']);assert.deepEqual(JSON.parse(calls[1].body),{version:'9007199254740993',changes:{name:'B',active:false}});assert.deepEqual(JSON.parse(calls[2].body),{version:'3',password});
 for(let i=0;i<calls.length;i++)assert.deepEqual(calls[i].headers,{'X-Business-Rules-Version':'2','Idempotency-Key':['create','edit','reset','delete','self'][i]});
});
test('account reads preserve search paging filters and identity',async()=>{
 const calls=[];const api=createRelationalUsersApi({getRuntime:()=>runtime,request:async(path,options)=>{calls.push({path,...options});return {}}});await api.getPage({search:'A & B',active:false,role:'viewer',limit:100,offset:200});await api.getById('u/a');await api.me();assert.equal(calls[0].path,'/users?search=A%20%26%20B&active=false&role=viewer&limit=100&offset=200');assert.equal(calls[1].path,'/users/u%2Fa');assert.equal(calls[2].path,'/auth/me');
 for(const bad of [{limit:201},{offset:-1},{active:'false'},{role:'admin'},{unknown:true}])assert.throws(()=>api.getPage(bad));
});
test('missing versions keys and unexpected secret fields reject before transport',()=>{
 let calls=0;const api=createRelationalUsersApi({getRuntime:()=>runtime,request:()=>{calls++;return {}}});
 assert.throws(()=>api.update('u',{changes:{name:'A'}},'x'));assert.throws(()=>api.update('u',{version:'1',changes:{name:'A'},password:'x'},'x'));assert.throws(()=>api.resetPassword('u',{password},'x'));assert.throws(()=>api.delete('u','1'));assert.throws(()=>api.changeOwnPassword({currentPassword:'x',newPassword:password},'x'));assert.throws(()=>api.changeOwnPassword({version:'1',currentPassword:'x',newPassword:password,confirmPassword:password},'x'));assert.equal(calls,0);
});
test('unsupported legacy server does not silently send relation commands',()=>{
 const api=createRelationalUsersApi({getRuntime:()=>({...runtime,capabilities:{}}),request:()=>assert.fail('no request')});assert.throws(()=>api.me());
});
