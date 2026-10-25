import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import storage from './storage';
import { isCurrentRuntime } from './serverRuntime';
import { clearTrackedFiles } from './sessionFiles';
export { clearTrackedFiles, trackPickedAsset, trackSessionFile } from './sessionFiles';

const CLEANUP_PENDING_KEY = 'sessionCleanupPending.v1';
const LEGACY_MIGRATION_KEY = 'legacyCredentialsRemoved.v1';
const memorySession = new Map();
const AGENT_ROLES = new Set(['owner', 'staff', 'viewer']);

const tokenKey = (serverKey) => `jwtToken.v1.${serverKey}`;
const draftsKey = (serverKey) => `drafts.v1.${serverKey}`;
const agentChatStateKey = (serverKey, role) => `agentChatState.v1.${serverKey}.${role}`;

const getWebSessionStorage = () => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch (error) {
    return null;
  }
};

const credentials = {
  async getItem(key) {
    if (Platform.OS !== 'web') return SecureStore.getItemAsync(key);
    const session = getWebSessionStorage();
    return session ? session.getItem(key) : memorySession.get(key) || null;
  },
  async setItem(key, value) {
    if (Platform.OS !== 'web') return SecureStore.setItemAsync(key, String(value));
    const session = getWebSessionStorage();
    if (session) session.setItem(key, String(value));
    else memorySession.set(key, String(value));
    return undefined;
  },
  async deleteItem(key) {
    if (Platform.OS !== 'web') return SecureStore.deleteItemAsync(key);
    const session = getWebSessionStorage();
    session?.removeItem(key);
    memorySession.delete(key);
    return undefined;
  },
};

const requireServerKey = (serverKey) => {
  if (!serverKey || !/^[a-f0-9]{64}$/i.test(serverKey)) {
    throw new Error('会话存储缺少有效的服务器标识');
  }
};

const requireAgentRole = (role) => {
  if (typeof role !== 'string' || !AGENT_ROLES.has(role)) {
    throw new Error('会话存储缺少有效的账号角色');
  }
};

export const getToken = async (serverKey) => {
  requireServerKey(serverKey);
  return credentials.getItem(tokenKey(serverKey));
};

export const getTokenForSnapshot = async (captured) => {
  if (!isCurrentRuntime(captured)) return null;
  const token = await getToken(captured.serverKey);
  return isCurrentRuntime(captured) ? token : null;
};

export const setToken = async (serverKey, token) => {
  requireServerKey(serverKey);
  return credentials.setItem(tokenKey(serverKey), token);
};

export const clearToken = async (serverKey) => {
  if (!serverKey) return;
  requireServerKey(serverKey);
  await credentials.deleteItem(tokenKey(serverKey));
};

export const setTokenForSnapshot = async (captured, token) => {
  if (!isCurrentRuntime(captured)) return false;
  await setToken(captured.serverKey, token);
  if (!isCurrentRuntime(captured)) {
    await clearToken(captured.serverKey);
    return false;
  }
  return true;
};

export const setAgentChatState = async (captured, role, state) => {
  if (!captured?.serverKey || !isCurrentRuntime(captured)) return false;
  requireServerKey(captured.serverKey);
  requireAgentRole(role);
  const key = agentChatStateKey(captured.serverKey, role);
  if (state == null) {
    await credentials.deleteItem(key);
  } else {
    await credentials.setItem(key, JSON.stringify(state));
  }
  if (!isCurrentRuntime(captured)) {
    await credentials.deleteItem(key);
    return false;
  }
  return true;
};

export const getAgentChatState = async (captured, role) => {
  if (!captured?.serverKey || !isCurrentRuntime(captured)) return null;
  requireServerKey(captured.serverKey);
  requireAgentRole(role);
  const key = agentChatStateKey(captured.serverKey, role);
  const raw = await credentials.getItem(key);
  if (!isCurrentRuntime(captured) || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    await credentials.deleteItem(key);
    return null;
  }
};

export const clearSession = async (serverKey) => {
  if (!serverKey) return;
  requireServerKey(serverKey);
  await clearToken(serverKey);
  await credentials.deleteItem(draftsKey(serverKey));
  await Promise.all([...AGENT_ROLES].map((role) => credentials.deleteItem(agentChatStateKey(serverKey, role))));
  await clearTrackedFiles(serverKey);
};

export const clearSessionSafely = async (serverKey) => {
  if (!serverKey) return;
  await storage.setItem(CLEANUP_PENDING_KEY, JSON.stringify({ serverKey }));
  await clearSession(serverKey);
  await storage.deleteItem(CLEANUP_PENDING_KEY);
};

export const recoverPendingSessionCleanup = async () => {
  const raw = await storage.getItem(CLEANUP_PENDING_KEY);
  if (!raw) return;
  let pending;
  try {
    pending = JSON.parse(raw);
  } catch (error) {
    await storage.deleteItem(CLEANUP_PENDING_KEY);
    return;
  }
  if (pending?.serverKey) await clearSession(pending.serverKey);
  await storage.deleteItem(CLEANUP_PENDING_KEY);
};

export const removeLegacyCredentialsOnce = async () => {
  const completed = await storage.getItem(LEGACY_MIGRATION_KEY);
  if (completed === '1') return;
  await storage.deleteItem('jwtToken');
  await storage.deleteItem('ossConfig');
  await storage.setItem(LEGACY_MIGRATION_KEY, '1');
};

export const SESSION_CLEANUP_PENDING_KEY = CLEANUP_PENDING_KEY;
