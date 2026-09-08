let runtime = {
  apiBaseUrl: null,
  serverId: null,
  serverKey: null,
  sessionEpoch: 0,
};

const operations = new Set();
const listeners = new Set();

const snapshot = () => ({ ...runtime });

const notify = () => {
  const current = snapshot();
  for (const listener of listeners) {
    try {
      listener(current);
    } catch (error) {
      // A subscriber must not prevent cancellation or runtime publication.
    }
  }
};

export const getServerRuntime = snapshot;

export const setServerRuntime = (server) => {
  runtime = {
    ...runtime,
    apiBaseUrl: server?.apiBaseUrl || null,
    serverId: server?.serverId || null,
    serverKey: server?.serverKey || null,
  };
  notify();
  return snapshot();
};

export const isCurrentRuntime = (captured) => Boolean(
  captured
  && captured.sessionEpoch === runtime.sessionEpoch
  && captured.serverKey === runtime.serverKey
  && captured.apiBaseUrl === runtime.apiBaseUrl
);

export const beginSessionInvalidation = () => {
  for (const operation of operations) {
    try {
      operation.abort();
    } catch (error) {
      // Cancellation is best-effort; epoch checks are the final guard.
    }
  }
  operations.clear();
  runtime = { ...runtime, sessionEpoch: runtime.sessionEpoch + 1 };
  notify();
  return snapshot();
};

export const registerOperation = (captured, externalSignal) => {
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
  }
  if (!isCurrentRuntime(captured)) controller.abort();
  operations.add(controller);

  const release = () => {
    operations.delete(controller);
    externalSignal?.removeEventListener?.('abort', abortFromExternal);
  };
  return { controller, release };
};

export const subscribeServerRuntime = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export class StaleSessionError extends Error {
  constructor() {
    super('请求所属会话已失效');
    this.name = 'StaleSessionError';
    this.code = 'STALE_SESSION';
    this.staleSession = true;
  }
}
