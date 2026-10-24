'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {authenticatedUser}=require('../../utils/authUserCore.cjs');
test('login and legacy me accept wrapped public user',()=>{const user={id:'u',role:'staff',name:'员工'};assert.equal(authenticatedUser({user}),user);assert.equal(authenticatedUser({token:'token',user}),user)});
test('relational me accepts the direct public DTO including its exact version',()=>{const user={id:'u',role:'viewer',version:'9007199254740993'};assert.equal(authenticatedUser(user),user)});
test('missing or malformed user is not treated as an authenticated session',()=>{for(const value of [null,{},[],{user:null},{id:'u'},{id:'u',role:'admin'},{id:1,role:'owner'}])assert.equal(authenticatedUser(value),null)});
