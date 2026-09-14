import { streamSSE } from '../components/agent/sseClient';
import { apiRequest } from './api';
import { getTokenForSnapshot } from './sessionStorage';
import {
  getServerRuntime,
  isCurrentRuntime,
  registerOperation,
  StaleSessionError,
} from './serverRuntime';

export const agentApi = {
  listConversations: () => apiRequest('/agent/conversations'),
  getConversation: (id) => apiRequest(`/agent/conversations/${id}`),
  deleteConversation: (id) => apiRequest(`/agent/conversations/${id}`, { method: 'DELETE' }),
  confirmDraft: (draft) => apiRequest('/agent/drafts/confirm', {
    method: 'POST',
    body: JSON.stringify({ draft }),
  }),
  getSettings: () => apiRequest('/agent/keys'),
  testSettings: (settings) => apiRequest('/agent/keys/test', {
    method: 'POST',
    body: JSON.stringify(settings),
  }),
  testConnection: (settings) => apiRequest('/agent/keys/test', {
    method: 'POST',
    body: JSON.stringify(settings || {}),
  }),
  saveSettings: (settings) => apiRequest('/agent/keys', {
    method: 'PUT',
    body: JSON.stringify(settings),
  }),
};

export async function streamChat({ message, conversationId, images, onEvent }) {
  if (typeof onEvent !== 'function') {
    throw new Error('streamChat requires an onEvent callback');
  }

  const snapshot = getServerRuntime();
  if (!snapshot) {
    const error = new Error('尚未配置服务器');
    error.code = 'SERVER_NOT_CONFIGURED';
    throw error;
  }

  const token = await getTokenForSnapshot(snapshot);
  if (!isCurrentRuntime(snapshot)) throw new StaleSessionError();

  const externalController = new AbortController();
  const { controller, release } = registerOperation(snapshot, externalController.signal);
  let terminalEvent = null;
  let terminalData = null;
  const safeEvent = (event, data) => {
    if (!isCurrentRuntime(snapshot)) return;
    if (event === 'done' || event === 'error') {
      terminalEvent = event;
      terminalData = data;
    }
    onEvent(event, data);
  };

  try {
    await streamSSE(
      `${snapshot.apiBaseUrl}/agent/chat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: { message, conversationId, images },
        signal: controller.signal,
      },
      safeEvent
    );
    if (!isCurrentRuntime(snapshot)) throw new StaleSessionError();
    return { terminalEvent: terminalEvent || 'error', data: terminalData };
  } catch (error) {
    if (error?.name === 'AbortError' || error instanceof StaleSessionError) {
      return { terminalEvent: 'error', data: { message: error?.message || '请求已取消' } };
    }
    const data = { message: error?.message || String(error), ...(error?.code ? { code: error.code } : {}) };
    if (!error?.reported) safeEvent('error', data);
    return { terminalEvent: 'error', data };
  } finally {
    release();
  }
}
