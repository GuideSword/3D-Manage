import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import storage from './storage';
import { isCurrentRuntime } from './serverRuntime';
import { clearTrackedFiles } from './sessionFiles';
export { clearTrackedFiles, trackPickedAsset, trackSessionFile } from './sessionFiles';

const CLEANUP_PENDING_KEY = 'sessionCleanupPending.v1';
const LEGACY_MIGRATION_KEY = 'legacyCredentialsRemoved.v1';
const memorySession = new Map();

const tokenKey = (serverKey) => `jwtToken.v1.${serverKey}`;
const draftsKey = (serverKey) => `drafts.v1.${serverKey}`;

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
    throw new Error('A valid serverKey is required for session storage');
  }
};

export const getToken = async (serverKey) => {
  requireServerKey(serverKey);
  return credentials.getItem(tokenKey(serverKey));
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

export const clearSession = async (serverKey) => {
  if (!serverKey) return;
  requireServerKey(serverKey);
  await clearToken(serverKey);
  await credentials.deleteItem(draftsKey(serverKey));
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
