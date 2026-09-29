import { useCallback, useEffect, useRef, useState } from 'react';
import { isAuthRequiredError } from './api';

// Load once per record, not on every focus: returning from a picker must preserve edits.
export const useEditRecord = (id, api, onLoad) => {
  const [record, setRecord] = useState(null);
  const [loadingRecord, setLoadingRecord] = useState(Boolean(id));
  const [loadError, setLoadError] = useState('');
  const [reloadCount, setReloadCount] = useState(0);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(() => {
    let current = true;
    setRecord(null);
    setLoadError('');
    setLoadingRecord(Boolean(id));
    if (id) {
      api.getById(id).then((value) => {
        if (!current) return;
        onLoadRef.current(value);
        setRecord(value);
      }).catch((error) => {
        if (current && !isAuthRequiredError(error)) setLoadError(error.message || '加载原记录失败，请重试');
      }).finally(() => {
        if (current) setLoadingRecord(false);
      });
    }
    return () => { current = false; };
  }, [id, api, reloadCount]);

  const reload = useCallback(() => setReloadCount((value) => value + 1), []);
  return { record, loadingRecord, loadError, reload };
};
