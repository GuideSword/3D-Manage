'use strict';
const EMPTY = Object.freeze({ items: Object.freeze([]), total: null, loading: false, error: '', hasMore: false });
const scopeKey = scope => scope && typeof scope.serverKey === 'string' && scope.serverKey
  && typeof scope.userId === 'string' && scope.userId && Number.isSafeInteger(scope.sessionEpoch)
  ? JSON.stringify([scope.serverKey, scope.userId, scope.sessionEpoch]) : null;

function createScopedPager({ fetchPage, getScope, pageSize = 100 }) {
  if (typeof fetchPage !== 'function' || typeof getScope !== 'function' || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 200) throw Error('分页配置无效');
  let state = EMPTY, owner = null, generation = 0, query = {}, nextOffset = 0;
  const listeners = new Set();
  const emit = changes => {
    state = Object.freeze({ ...state, ...changes });
    for (const listener of listeners) listener();
  };
  const current = (token, captured) => token === generation && owner === captured && captured === scopeKey(getScope());
  async function read(offset, token, captured) {
    try {
      const result = await fetchPage({ ...query, limit: pageSize, offset });
      if (!current(token, captured)) return null;
      if (!result || !Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0
        || result.items.length > pageSize || offset + result.items.length > result.total
        || (!result.items.length && result.total > offset)) throw Error('分页数据无效，请刷新列表');
      if (offset && result.total !== state.total) throw Error('列表已变化，请刷新后继续');
      const known = new Set(offset ? state.items.map(row => row.id) : []);
      for (const row of result.items) {
        if (!row || typeof row.id !== 'string' || !row.id || known.has(row.id)) throw Error('列表已变化或记录无效，请刷新后继续');
        known.add(row.id);
      }
      nextOffset = offset + result.items.length;
      emit({ items: Object.freeze([...(offset ? state.items : []), ...result.items]), total: result.total,
        loading: false, error: '', hasMore: nextOffset < result.total });
      return state;
    } catch (error) {
      if (current(token, captured)) emit({ loading: false, error: error.authRequired || error.staleSession ? '' : error.message || '加载失败，请重试' });
      return null;
    }
  }
  const refresh = (parameters = {}) => {
    generation += 1; owner = scopeKey(getScope()); query = { ...parameters }; nextOffset = 0;
    state = EMPTY;
    if (!owner) { emit({ error: '当前会话不可用，请重新登录' }); return Promise.resolve(null); }
    emit({ loading: true });
    return read(0, generation, owner);
  };
  return {
    getSnapshot: () => owner && owner !== scopeKey(getScope()) ? EMPTY : state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    invalidate() { generation += 1; owner = null; nextOffset = 0; state = EMPTY; emit({}); },
    refresh,
    loadMore() {
      if (!owner || owner !== scopeKey(getScope())) return Promise.resolve(null);
      if (state.loading || !state.hasMore) return Promise.resolve(null);
      emit({ loading: true, error: '' }); return read(nextOffset, generation, owner);
    },
  };
}
module.exports = { createScopedPager };
