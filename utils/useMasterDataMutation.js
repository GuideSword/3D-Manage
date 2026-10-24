import { useCallback, useEffect, useRef, useState } from 'react';
import { isAuthRequiredError } from './api';
import { useBusinessCommand } from './useBusinessCommand';
import { getServerRuntime, isCurrentRuntime } from './serverRuntime';

export const useMasterDataMutation = navigation => {
  const submit = useBusinessCommand({ reusable: true });
  const pendingRef = useRef(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(null);
  const [loading, setLoading] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => navigation.addListener('beforeRemove', event => {
    if (!pendingRef.current || !isCurrentRuntime(pendingRef.current.runtime)) return;
    event.preventDefault();
    setError('请先重试确认上次操作结果，再离开此页。');
  }), [navigation]);
  const resetAfterLoad = useCallback(() => { setConflict(false); setError(''); }, []);
  const run = async (operation, payload, send) => {
    if (busy.current || conflict) return null;
    const command = pendingRef.current || { operation, payload, send, runtime: getServerRuntime() };
    busy.current = true; setLoading(true); setError('');
    pendingRef.current = command; setPending(command);
    try {
      const result = await submit(command.operation, command.payload, command.send);
      if (result !== null) { pendingRef.current = null; setPending(null); }
      return result;
    } catch (failure) {
      const definitive = failure.status >= 400 && failure.status < 500;
      if (definitive) { pendingRef.current = null; setPending(null); }
      if (failure.status === 409 && failure.code === 'VERSION_CONFLICT') setConflict(true);
      if (!isAuthRequiredError(failure) && !failure.staleSession) setError(failure.message || '操作失败，请重试');
      return null;
    } finally { busy.current = false; setLoading(false); }
  };
  return { run, pending, loading, conflict, error, setError, resetAfterLoad };
};
