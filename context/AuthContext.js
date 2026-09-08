import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { authAPI, isAuthRequiredError, setUnauthorizedHandler } from '../utils/api';
import { useServerConfig } from './ServerConfigContext';
import { clearSessionSafely } from '../utils/sessionStorage';
import { beginSessionInvalidation, subscribeServerRuntime } from '../utils/serverRuntime';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const {
    initializing: serverInitializing,
    server,
    connectionError,
  } = useServerConfig();
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [cleanupError, setCleanupError] = useState(null);

  const clearUser = useCallback(() => {
    setUser(null);
  }, []);

  useEffect(() => setUnauthorizedHandler(clearUser), [clearUser]);
  useEffect(() => subscribeServerRuntime(clearUser), [clearUser]);

  const refreshUser = useCallback(async () => {
    const token = await authAPI.getToken();
    if (!token) {
      setUser(null);
      return null;
    }

    try {
      const result = await authAPI.me();
      const nextUser = result.user || null;
      setUser(nextUser);
      return nextUser;
    } catch (error) {
      if (isAuthRequiredError(error) || error.status === 401) {
        setUser(null);
        return null;
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    let active = true;

    const initializeAuth = async () => {
      if (serverInitializing) return;
      if (!server || connectionError || !server.initialized) {
        setUser(null);
        setInitializing(false);
        return;
      }
      setInitializing(true);
      try {
        const token = await authAPI.getToken();
        if (!active) {
          return;
        }

        if (!token) {
          setUser(null);
          return;
        }

        const result = await authAPI.me();
        if (active) {
          setUser(result.user || null);
        }
      } catch (error) {
        if (active) {
          setUser(null);
        }
      } finally {
        if (active) {
          setInitializing(false);
        }
      }
    };

    initializeAuth();

    return () => {
      active = false;
    };
  }, [serverInitializing, server?.serverKey, server?.initialized, connectionError?.code]);

  const signIn = useCallback(async (credentials) => {
    const result = await authAPI.login(credentials);
    setUser(result.user || null);
    return result;
  }, []);

  const signOut = useCallback(async () => {
    const serverKey = server?.serverKey;
    beginSessionInvalidation();
    setUser(null);
    setCleanupError(null);
    try {
      if (serverKey) await clearSessionSafely(serverKey);
      return true;
    } catch (error) {
      setCleanupError(error);
      throw error;
    }
  }, [server?.serverKey]);

  const retrySessionCleanup = useCallback(async () => {
    const serverKey = server?.serverKey;
    if (!serverKey) return true;
    try {
      await clearSessionSafely(serverKey);
      setCleanupError(null);
      return true;
    } catch (error) {
      setCleanupError(error);
      throw error;
    }
  }, [server?.serverKey]);

  const value = useMemo(() => ({
    user,
    initializing,
    isAuthenticated: Boolean(user),
    signIn,
    signOut,
    refreshUser,
    cleanupError,
    retrySessionCleanup,
  }), [user, initializing, signIn, signOut, refreshUser, cleanupError, retrySessionCleanup]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export default AuthProvider;
