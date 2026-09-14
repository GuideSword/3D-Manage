import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useEffect,
} from 'react';
import {
  clearServerConfig,
  loadServerConfig,
  probeServer,
  saveServerConfig,
} from '../utils/serverConfig';
import {
  clearSessionSafely,
  recoverPendingSessionCleanup,
  removeLegacyCredentialsOnce,
} from '../utils/sessionStorage';
import {
  beginSessionInvalidation,
  setServerRuntime,
} from '../utils/serverRuntime';
import userErrorCore from '../utils/userErrorCore.cjs';

const { localizeTransportError } = userErrorCore;

const ServerConfigContext = createContext(null);

export const ServerConfigProvider = ({ children }) => {
  const [initializing, setInitializing] = useState(true);
  const [server, setServer] = useState(null);
  const [connectionError, setConnectionError] = useState(null);
  const [isReplacing, setIsReplacing] = useState(false);
  const serverRef = useRef(null);
  const replacingRef = useRef(false);

  const publishServer = useCallback((nextServer) => {
    serverRef.current = nextServer;
    setServer(nextServer);
    setServerRuntime(nextServer);
  }, []);

  const detectIdentityChange = useCallback(async (saved, probed) => {
    if (saved.serverId === probed.serverId) return false;
    beginSessionInvalidation();
    try {
      await clearSessionSafely(saved.serverKey);
    } catch (error) {
      const localizedError = localizeTransportError(error, { fallback: '本地会话清理失败，请稍后重试' });
      setConnectionError({ code: 'SESSION_CLEANUP_FAILED', message: localizedError.message, candidate: probed });
      return true;
    }
    setConnectionError({
      code: 'SERVER_ID_CHANGED',
      message: '该地址返回了新的服务器身份。为保护账号，旧会话已退出。',
      candidate: probed,
    });
    return true;
  }, []);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        await removeLegacyCredentialsOnce();
        await recoverPendingSessionCleanup();
        const saved = await loadServerConfig();
        if (!active) return;
        if (!saved) {
          publishServer(null);
          return;
        }
        publishServer(saved);
        try {
          const refreshed = await probeServer(saved.apiBaseUrl);
          if (!active) return;
          if (await detectIdentityChange(saved, refreshed)) return;
          const persisted = await saveServerConfig(refreshed);
          if (active) publishServer(persisted);
        } catch (error) {
          const localizedError = localizeTransportError(error, { fallback: '无法连接服务器' });
          if (active) setConnectionError({ code: error.code || 'SERVER_UNREACHABLE', message: localizedError.message });
        }
      } catch (error) {
        const localizedError = localizeTransportError(error, { fallback: '本地数据读写失败，请稍后重试' });
        if (active) setConnectionError({ code: 'CLIENT_STORAGE_FAILED', message: localizedError.message });
      } finally {
        if (active) setInitializing(false);
      }
    };
    initialize();
    return () => { active = false; };
  }, [detectIdentityChange, publishServer]);

  const configureServer = useCallback(async (input) => {
    const candidate = await probeServer(input);
    const persisted = await saveServerConfig(candidate);
    publishServer(persisted);
    setConnectionError(null);
    return persisted;
  }, [publishServer]);

  const refreshServer = useCallback(async () => {
    const current = serverRef.current;
    if (!current) return null;
    try {
      const refreshed = await probeServer(current.apiBaseUrl);
      if (await detectIdentityChange(current, refreshed)) return null;
      const persisted = await saveServerConfig(refreshed);
      publishServer(persisted);
      setConnectionError(null);
      return persisted;
    } catch (error) {
      const localizedError = localizeTransportError(error, { fallback: '无法连接服务器' });
      setConnectionError({ code: error.code || 'SERVER_UNREACHABLE', message: localizedError.message });
      throw localizedError;
    }
  }, [detectIdentityChange, publishServer]);

  const replaceServer = useCallback(async (input) => {
    if (replacingRef.current) {
      const error = new Error('服务器更换正在进行');
      error.code = 'SERVER_REPLACEMENT_IN_PROGRESS';
      throw error;
    }
    replacingRef.current = true;
    setIsReplacing(true);
    try {
      const candidate = await probeServer(input);
      const current = serverRef.current;
      beginSessionInvalidation();
      try {
        if (current?.serverKey) await clearSessionSafely(current.serverKey);
        if (candidate.serverKey !== current?.serverKey) await clearSessionSafely(candidate.serverKey);
        const persisted = await saveServerConfig(candidate);
        publishServer(persisted);
        setConnectionError(null);
        return persisted;
      } catch (error) {
        const localizedError = localizeTransportError(error, { fallback: '本地会话清理失败，请稍后重试' });
        publishServer(current);
        setConnectionError({
          code: 'SESSION_CLEANUP_FAILED',
          message: `服务器更换未完成：${localizedError.message}`,
          candidate,
        });
        throw localizedError;
      }
    } finally {
      replacingRef.current = false;
      setIsReplacing(false);
    }
  }, [publishServer]);

  const retryPendingReplacement = useCallback(async () => {
    const candidate = connectionError?.candidate;
    if (!candidate) return refreshServer();
    if (replacingRef.current) throw new Error('服务器更换正在进行');
    replacingRef.current = true;
    setIsReplacing(true);
    try {
      const current = serverRef.current;
      beginSessionInvalidation();
      if (current?.serverKey) await clearSessionSafely(current.serverKey);
      if (candidate.serverKey !== current?.serverKey) await clearSessionSafely(candidate.serverKey);
      const persisted = await saveServerConfig(candidate);
      publishServer(persisted);
      setConnectionError(null);
      return persisted;
    } catch (error) {
      const localizedError = localizeTransportError(error, { fallback: '本地会话清理失败，请稍后重试' });
      setConnectionError((previous) => ({
        ...previous,
        code: 'SESSION_CLEANUP_FAILED',
        message: `服务器更换未完成：${localizedError.message}`,
        candidate,
      }));
      throw localizedError;
    } finally {
      replacingRef.current = false;
      setIsReplacing(false);
    }
  }, [connectionError, publishServer, refreshServer]);

  const clearServer = useCallback(async () => {
    try {
      const current = serverRef.current;
      beginSessionInvalidation();
      if (current?.serverKey) await clearSessionSafely(current.serverKey);
      await clearServerConfig();
      publishServer(null);
      setConnectionError(null);
    } catch (error) {
      throw localizeTransportError(error, { fallback: '清除服务器配置失败，请稍后重试' });
    }
  }, [publishServer]);

  const value = useMemo(() => ({
    initializing,
    server,
    connectionError,
    isReplacing,
    configureServer,
    refreshServer,
    replaceServer,
    retryPendingReplacement,
    clearServer,
  }), [
    initializing,
    server,
    connectionError,
    isReplacing,
    configureServer,
    refreshServer,
    replaceServer,
    retryPendingReplacement,
    clearServer,
  ]);

  return <ServerConfigContext.Provider value={value}>{children}</ServerConfigContext.Provider>;
};

export const useServerConfig = () => {
  const context = useContext(ServerConfigContext);
  if (!context) throw new Error('useServerConfig must be used within ServerConfigProvider');
  return context;
};

export default ServerConfigProvider;
