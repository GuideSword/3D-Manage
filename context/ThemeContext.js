import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';
import {
  DARK_COLORS,
  DARK_SHADOWS,
  LIGHT_COLORS,
  LIGHT_SHADOWS,
} from '../constants';
import storage from '../utils/storage';

const THEME_STORAGE_KEY = 'ui.themeMode';
const VALID_MODES = new Set(['system', 'light', 'dark']);
const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
  const systemScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState('system');
  const userSelectedModeRef = useRef(false);

  useEffect(() => {
    let active = true;

    storage.getItem(THEME_STORAGE_KEY)
      .then((storedMode) => {
        if (active && !userSelectedModeRef.current && VALID_MODES.has(storedMode)) {
          setThemeModeState(storedMode);
        }
      })
      .catch(() => {
        // Theme persistence is a convenience; storage failure must not block the app.
      });

    return () => {
      active = false;
    };
  }, []);

  const setThemeMode = useCallback((nextMode) => {
    const safeMode = VALID_MODES.has(nextMode) ? nextMode : 'system';
    userSelectedModeRef.current = true;
    setThemeModeState(safeMode);
    storage.setItem(THEME_STORAGE_KEY, safeMode).catch(() => {
      // Keep the selected theme for this session even when persistence is unavailable.
    });
  }, []);

  const resolvedScheme = themeMode === 'system'
    ? (systemScheme === 'dark' ? 'dark' : 'light')
    : themeMode;
  const isDark = resolvedScheme === 'dark';

  const value = useMemo(() => ({
    themeMode,
    resolvedScheme,
    isDark,
    colors: isDark ? DARK_COLORS : LIGHT_COLORS,
    shadows: isDark ? DARK_SHADOWS : LIGHT_SHADOWS,
    setThemeMode,
  }), [themeMode, resolvedScheme, isDark, setThemeMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useAppTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useAppTheme must be used within ThemeProvider');
  }
  return context;
};

export default ThemeProvider;
