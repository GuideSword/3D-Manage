'use strict';
const { recordVersion } = require('./masterDataCore.cjs');
const { validateFileAsset } = require('./relationalFilesCore.cjs');
const { createRelationalFileCommand } = require('./relationalFileCommandCore.cjs');
const fail=(message,code='FILE_QUEUE_INVALID')=>{throw Object.assign(new Error(message),{code})};
function validateSavedRecord(record,expected={}) {
  try {
    if(!record||typeof record.id!=='string'||!record.id.trim()||expected.id&&expected.id!==record.id) throw Error();
    const version=recordVersion(record.version);
    if(expected.version!==undefined&&BigInt(version)<=BigInt(recordVersion(expected.version))) throw Error();
  }catch(_){fail('主体保存结果未能确认，请重试原操作','FILE_PARENT_RESULT_INVALID')}
  return record;
}
function validateFileQueue(entity,entries) {
  if(!['models','orders'].includes(entity)||!Array.isArray(entries))fail('附件列表无效');
  return entries.map(entry=>{
    const kind=entity==='models'&&entry?.child==='files'?'models':entity==='models'&&entry?.child==='images'?'images':entity==='orders'&&entry?.child==='attachments'?'attachments':null;
    if(!kind)fail('文件关联用途无效');validateFileAsset(kind,entry.file);
    const metadata=entry.metadata||{};
    if(Object.keys(metadata).some(key=>!['type','sourceFileId'].includes(key))||Object.keys(metadata).length&&kind!=='images'
      ||metadata.type!==undefined&&!['cover','real_print','auto_preview','other'].includes(metadata.type)
      ||metadata.sourceFileId!==undefined&&(typeof metadata.sourceFileId!=='string'||!metadata.sourceFileId))fail('图片资料无效');
    return {child:entry.child,file:typeof Blob!=='undefined'&&entry.file instanceof Blob?entry.file:{...entry.file},metadata:{...metadata}};
  });
}
function createSavedRecordFileQueue({entity,api,createKey,getScope,onChange=()=>{}}) {
  let savedRecord=null,entries=[],index=0,busy=false,completed=false,scope=null;
  const changed=()=>onChange(getState());
  const file=createRelationalFileCommand({api,createKey,getScope,onChange:changed});
  function getState(){return {savedRecord:savedRecord?{...savedRecord}:null,remaining:entries.length-index,total:entries.length,busy,completed,scope:scope?{...scope}:null,file:file.getState()}}
  const current=()=>{const active=getScope();if(!scope||active?.serverKey!==scope.serverKey||active?.sessionEpoch!==scope.sessionEpoch||active?.userId!==scope.userId)throw Object.assign(new Error('请求所属会话已失效，请重新打开页面'),{code:'STALE_SESSION',staleSession:true})};
  const run=async()=>{
    if(busy||completed||!savedRecord)return null;current();busy=true;changed();
    try {
      while(index<entries.length){
        current();const result=await(file.getState().pending?file.retry():file.start({entity,record:savedRecord,...entries[index]}));
        current();if(!result)return null;savedRecord={...result};index++;changed();
      }
      completed=true;return savedRecord;
    }finally{busy=false;changed()}
  };
  return {getState,retry:run,
    async start(record,files){
      if(savedRecord)fail('主体已经保存，请继续完成剩余文件','FILE_QUEUE_STARTED');
      const snapshot=validateFileQueue(entity,files);validateSavedRecord(record);const active=getScope();
      if(!active?.serverKey||!active?.userId||!Number.isSafeInteger(active.sessionEpoch))fail('请重新登录后打开此页','BUSINESS_SESSION_REQUIRED');
      savedRecord={...record};entries=snapshot;scope={serverKey:active.serverKey,userId:active.userId,sessionEpoch:active.sessionEpoch};changed();return run();
    },
    rebase(record){current();validateSavedRecord(record,{id:savedRecord.id});file.rebase(record);savedRecord={...record};changed()},
    finishLater(){
      if(!savedRecord||completed)return null;current();if(busy)fail('请先确认文件操作结果','FILE_RETRY_PENDING');
      file.cancel();index=entries.length;completed=true;changed();return savedRecord;
    },
  };
}
module.exports={createSavedRecordFileQueue,validateFileQueue,validateSavedRecord};
