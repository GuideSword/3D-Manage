// HTTP helpers for the Agent backend.
// Mirrors the existing pattern in utils/api.js:
//   - API base URL from constants (API_CONFIG.BASE_URL).
//   - Auth token via utils/storage (SecureStore on native, localStorage on web).
//   - Bearer <token> in the Authorization header.
//
// AsyncStorage is NOT installed in this project, so we use the existing
// `storage` helper that already wraps expo-secure-store + a web fallback.

import { API_CONFIG } from '../constants';
import storage from './storage';
import { streamSSE } from '../components/agent/sseClient';

const TOKEN_KEY = 'jwtToken';

async function getToken() {
  try {
    return await storage.getItem(TOKEN_KEY);
  } catch (err) {
    console.warn('[agentApi] getToken failed:', err?.message || err);
    return null;
  }
}

async function authHeaders() {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const jsonHeaders = async () => ({
  'Content-Type': 'application/json',
  ...(await authHeaders()),
});

const AGENT_BASE = () => `${API_CONFIG.BASE_URL}/agent`;

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const agentApi = {
  async listConversations() {
    const headers = await authHeaders();
    return requestJson(`${AGENT_BASE()}/conversations`, { headers });
  },

  async getConversation(id) {
    const headers = await authHeaders();
    return requestJson(`${AGENT_BASE()}/conversations/${id}`, { headers });
  },

  async deleteConversation(id) {
    const headers = await authHeaders();
    return requestJson(`${AGENT_BASE()}/conversations/${id}`, {
      method: 'DELETE',
      headers,
    });
  },

  async confirmDraft(draft) {
    return requestJson(`${AGENT_BASE()}/drafts/confirm`, {
      method: 'POST',
      headers: await jsonHeaders(),
      body: JSON.stringify({ draft }),
    });
  },

  async testConnection() {
    const headers = await authHeaders();
    return requestJson(`${AGENT_BASE()}/keys/test`, { headers });
  },

  async saveSettings(settings) {
    return requestJson(`${AGENT_BASE()}/keys`, {
      method: 'PUT',
      headers: await jsonHeaders(),
      body: JSON.stringify(settings),
    });
  },
};

// Streaming chat — POSTs to /agent/chat and pipes the SSE response
// through streamSSE (XHR-based; fetch+ReadableStream isn't supported in RN).
// The onEvent callback receives (eventName, data) pairs.
export async function streamChat({ message, conversationId, images, onEvent }) {
  if (typeof onEvent !== 'function') {
    throw new Error('streamChat requires an onEvent callback');
  }

  try {
    await streamSSE(
      `${AGENT_BASE()}/chat`,
      {
        method: 'POST',
        headers: await jsonHeaders(),
        body: { message, conversationId, images },
      },
      onEvent
    );
  } catch (err) {
    // 兜底：理论上 streamSSE 内部已经处理了 abort / 错误（不再 reject，
    // 只是 settle），所以这里的 catch 主要接住网络完全失败等异常。
    onEvent('error', { message: err?.message || String(err) });
  }
}
