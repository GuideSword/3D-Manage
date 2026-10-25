'use strict';
const express=require('express'); const multer=require('multer');
const { createRelationalModelImportService }=require('../modelImport/relationalService');
function createModelImportRouter({pool,uploadDirectory,authentication,downloads}) { const router=express.Router(); const service=createRelationalModelImportService(pool,{uploadDirectory}); const auth=async(req,res,next)=>{try{const h=req.get('Authorization')||''; req.session=h.startsWith('Bearer ')?await authentication.authenticate(h.slice(7)):null;if(!req.session) return res.status(401).json({code:'AUTHENTICATION_REQUIRED'});next();}catch(e){next(e)}}; const write=(req,res,next)=>{if(req.get('X-Business-Rules-Version')!=='2') return res.status(428).json({code:'CLIENT_UPGRADE_REQUIRED'});if(!req.get('Idempotency-Key')) return res.status(400).json({code:'IDEMPOTENCY_KEY_REQUIRED'});next()}; const route=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
 router.use(auth); router.post('/jobs', write, route(async (req,res) => { res.status(201).json(await service.createJob(req.session, req.body)); })); router.post('/jobs/:jobId/items',write,route(async(req,res)=>res.status(201).json(await service.prepareItem(req.session,req.params.jobId,req.body)))); router.get('/jobs/:jobId',route(async(req,res)=>res.json(await service.getJob(req.session,req.params.jobId))));
 const upload=multer({storage:multer.memoryStorage(),limits:{files:1}}); router.post('/jobs/:jobId/items/:itemId/file',write,upload.single('file'),route(async(req,res)=>res.json(await service.completeFile(req.session,req.params.jobId,req.params.itemId,req.file?.buffer)))); router.post('/jobs/:jobId/cleanup',write,route(async(req,res)=>res.json(await service.cleanupJob(req.session,req.params.jobId)))); return router; }
module.exports={createModelImportRouter};




