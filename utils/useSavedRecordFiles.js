import { useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { useAuth } from '../context/AuthContext';
import { isAuthRequiredError } from './api';
import { getServerRuntime } from './serverRuntime';
import { relationalFilesAPI } from './relationalFilesApi';
import queueCore from './savedRecordFilesCore.cjs';

export const useSavedRecordFiles = (navigation, entity, recordAPI) => {
  const { user } = useAuth();
  const userRef = useRef(user); userRef.current = user;
  const mounted = useRef(true), controller = useRef(null);
  const [error, setError] = useState('');
  const [state, setState] = useState({ savedRecord: null, remaining: 0, total: 0, busy: false, completed: false, file: { pending: false } });
  const getScope = () => { const runtime = getServerRuntime(); return { serverKey: runtime.serverKey, sessionEpoch: runtime.sessionEpoch, userId: userRef.current?.id }; };
  if (!controller.current) controller.current = queueCore.createSavedRecordFileQueue({ entity, api: relationalFilesAPI, createKey: () => Crypto.randomUUID(), getScope,
    onChange: next => { if (mounted.current) setState(next); } });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => navigation.addListener('beforeRemove', event => {
    const current = controller.current.getState(), active = getScope();
    if ((current.busy || current.file.uncertain) && current.scope?.serverKey === active.serverKey
        && current.scope?.sessionEpoch === active.sessionEpoch && current.scope?.userId === active.userId) {
      event.preventDefault(); setError('主体已经保存，请先重试确认文件操作结果，再离开此页。');
    }
  }), [navigation]);
  const run = async action => {
    setError('');
    try { return await action(); }
    catch (failure) {
      if (mounted.current && !isAuthRequiredError(failure) && !failure.staleSession) setError(failure.message || '文件保存失败，请继续完成剩余附件');
      return null;
    }
  };
  const retry = () => run(() => controller.current.retry());
  return { ...state, error, start: (record, files) => run(() => controller.current.start(record, files)), retry,
    finishLater: () => run(() => controller.current.finishLater()),
    reload: () => run(async () => {
      const saved = controller.current.getState().savedRecord;
      if (!saved) return null;
      const fresh = await recordAPI.getById(saved.id);
      controller.current.rebase(fresh);
      return fresh;
    }),
    feedback: { ...state.file, busy: state.busy, error, retry },
  };
};
