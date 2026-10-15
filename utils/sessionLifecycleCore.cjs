'use strict';

function createSessionLifecycleCore(initial = {}) {
  let runtime = {
    apiBaseUrl: null,
    serverId: null,
    serverKey: null,
    capabilities: Object.freeze({}),
    sessionEpoch: 0,
    ...initial,
  };
  const listeners = new Set();
  const snapshot = () => ({ ...runtime });
  const notify = () => listeners.forEach((listener) => listener(snapshot()));
  return {
    get: snapshot,
    setServer(server) {
      runtime = {
        ...runtime,
        apiBaseUrl: server?.apiBaseUrl || null,
        serverId: server?.serverId || null,
        serverKey: server?.serverKey || null,
        capabilities: Object.freeze(server?.capabilities && typeof server.capabilities === 'object' && !Array.isArray(server.capabilities) ? { ...server.capabilities } : {}),
      };
      notify();
      return snapshot();
    },
    invalidate() {
      runtime = { ...runtime, sessionEpoch: runtime.sessionEpoch + 1 };
      notify();
      return snapshot();
    },
    isCurrent(captured) {
      return Boolean(captured
        && captured.sessionEpoch === runtime.sessionEpoch
        && captured.serverKey === runtime.serverKey
        && captured.apiBaseUrl === runtime.apiBaseUrl);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

module.exports = { createSessionLifecycleCore };
