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
  testConnection: () => apiRequest('/agent/keys/test'),
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
  if (!snapshot) throw new Error('SERVER_NOT_CONFIGURED');

  const token = await getTokenForSnapshot(snapshot);
  if (!isCurrentRuntime(snapshot)) throw new StaleSessionError();

  const externalController = new AbortController();
  const { controller, release } = registerOperation(snapshot, externalController.signal);
  const safeEvent = (event, data) => {
    if (isCurrentRuntime(snapshot)) onEvent(event, data);
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
  } catch (error) {
    if (error?.name === 'AbortError' || error instanceof StaleSessionError) return;
    safeEvent('error', { message: error?.message || String(error) });
  } finally {
    release();
  }
}
