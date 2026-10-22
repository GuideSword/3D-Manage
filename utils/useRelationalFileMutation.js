import { useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { useAuth } from '../context/AuthContext';
import { isAuthRequiredError } from './api';
import { getServerRuntime } from './serverRuntime';
import { relationalFilesAPI } from './relationalFilesApi';
import commandCore from './relationalFileCommandCore.cjs';

export const useRelationalFileMutation = navigation => {
  const { user } = useAuth();
  const userRef = useRef(user); userRef.current = user;
  const mounted = useRef(true);
  const [error, setError] = useState('');
  const [state, setState] = useState({ pending: false, busy: false, phase: 'idle', uncertain: false });
  const controller = useRef(null);
  const scope = () => { const runtime = getServerRuntime(); return { serverKey: runtime.serverKey, sessionEpoch: runtime.sessionEpoch, userId: userRef.current?.id }; };
  if (!controller.current) controller.current = commandCore.createRelationalFileCommand({ api: relationalFilesAPI, createKey: () => Crypto.randomUUID(), getScope: scope,
    onChange: next => { if (mounted.current) setState(next); } });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => navigation.addListener('beforeRemove', event => {
    const current = controller.current.getState(), active = scope();
    if (current.pending && (current.busy || current.uncertain) && current.scope?.serverKey === active.serverKey
        && current.scope?.sessionEpoch === active.sessionEpoch && current.scope?.userId === active.userId) {
      event.preventDefault(); setError('请先重试确认上次文件操作结果，再离开此页。');
    }
  }), [navigation]);
  const run = async (action, input) => {
    setError('');
    try { return await controller.current[action](input); }
    catch (failure) {
      if (mounted.current && !isAuthRequiredError(failure) && !failure.staleSession) setError(failure.message || '文件操作失败，请重试');
      return null;
    }
  };
  return { ...state, error, start: input => run('start', input), remove: input => run('remove', input), retry: () => run('retry'),
    rebase: record => run('rebase', record), cancel: () => run('cancel'), setError };
};
