import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '../context/AuthContext';
import { getServerRuntime, subscribeServerRuntime } from './serverRuntime';
import pagerCore from './scopedPagerCore.cjs';

export const useRelationalPage = (fetchPage, parameters = {}, enabled = true) => {
  const { user } = useAuth();
  const runtime = getServerRuntime();
  const queryKey = JSON.stringify(Object.fromEntries(Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b))));
  const pager = useMemo(() => pagerCore.createScopedPager({ fetchPage,
    getScope: () => ({ ...getServerRuntime(), userId: user?.id }) }),
  [fetchPage, queryKey, runtime.serverKey, runtime.sessionEpoch, user?.id]);
  const state = useSyncExternalStore(pager.subscribe, pager.getSnapshot, pager.getSnapshot);
  useEffect(() => {
    if (enabled) pager.refresh(JSON.parse(queryKey));
  }, [pager, enabled, queryKey]);
  useEffect(() => subscribeServerRuntime(() => {
    if (getServerRuntime().sessionEpoch !== runtime.sessionEpoch) pager.invalidate();
  }), [pager, runtime.sessionEpoch]);
  return { ...state, initializing: enabled && state.total === null && !state.error,
    refresh: () => enabled ? pager.refresh(JSON.parse(queryKey)) : Promise.resolve(null), loadMore: pager.loadMore };
};
