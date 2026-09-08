import { cancelAllOperations, registerRequestOperation } from './requestRegistry';
import lifecycleCore from './sessionLifecycleCore.cjs';

const lifecycle = lifecycleCore.createSessionLifecycleCore({
  apiBaseUrl: null,
  serverId: null,
  serverKey: null,
  sessionEpoch: 0,
});

export const getServerRuntime = lifecycle.get;

export const setServerRuntime = lifecycle.setServer;

export const isCurrentRuntime = lifecycle.isCurrent;

export const beginSessionInvalidation = () => {
  cancelAllOperations();
  return lifecycle.invalidate();
};

export const registerOperation = (captured, externalSignal) => {
  return registerRequestOperation(captured, isCurrentRuntime, externalSignal);
};

export const subscribeServerRuntime = lifecycle.subscribe;

export class StaleSessionError extends Error {
  constructor() {
    super('请求所属会话已失效');
    this.name = 'StaleSessionError';
    this.code = 'STALE_SESSION';
    this.staleSession = true;
  }
}
