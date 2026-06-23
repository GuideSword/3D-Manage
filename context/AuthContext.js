import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { authAPI, isAuthRequiredError, setUnauthorizedHandler } from '../utils/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  const clearUser = useCallback(() => {
    setUser(null);
  }, []);

  useEffect(() => setUnauthorizedHandler(clearUser), [clearUser]);

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
  }, []);

  const signIn = useCallback(async (credentials) => {
    const result = await authAPI.login(credentials);
    setUser(result.user || null);
    return result;
  }, []);

  const register = useCallback(async (payload) => {
    const result = await authAPI.register(payload);
    setUser(result.user || null);
    return result;
  }, []);

  const signOut = useCallback(async () => {
    await authAPI.logout();
    setUser(null);
  }, []);

  const value = useMemo(() => ({
    user,
    initializing,
    isAuthenticated: Boolean(user),
    signIn,
    register,
    signOut,
    refreshUser,
  }), [user, initializing, signIn, register, signOut, refreshUser]);

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
