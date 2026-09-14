import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import AppNavigator, { navigationRef } from './navigation/AppNavigator';
import { AuthProvider, useAuth } from './context/AuthContext';
import DraggableFab from './components/agent/DraggableFab';
import { ROUTES } from './constants';
import { ThemeProvider, useAppTheme } from './context/ThemeContext';
import { ServerConfigProvider } from './context/ServerConfigContext';
import navigationRouteObserver from './utils/navigationRouteObserver.cjs';

const { subscribeToNavigationRoute } = navigationRouteObserver;

// Mounts the draggable FAB only when the user is authenticated.
// The FAB lives OUTSIDE the NavigationContainer, so we use the navigation
// ref exported by AppNavigator to dispatch the Agent modal.
function AuthenticatedFab() {
  const { isAuthenticated } = useAuth();
  const [routeName, setRouteName] = React.useState(null);
  React.useEffect(
    () => subscribeToNavigationRoute(navigationRef, setRouteName),
    []
  );

  if (!isAuthenticated) return null;
  // These pages provide a dedicated Xiaoli assistant entrance in their own chrome.
  const routesWithEmbeddedAssistant = new Set([
    ROUTES.HOME,
    ROUTES.ORDERS,
    ROUTES.MODELS,
    ROUTES.MATERIALS,
    ROUTES.AGENT,
    ROUTES.AGENT_CHAT,
    ROUTES.AGENT_SETTINGS,
    'Settings',
  ]);
  if (!routeName || routesWithEmbeddedAssistant.has(routeName)) return null;

  const handlePress = () => {
    if (navigationRef.isReady()) {
      navigationRef.navigate(ROUTES.AGENT);
    } else {
      console.warn('[AgentFab] NavigationContainer not ready yet, tap ignored');
    }
  };

  return <DraggableFab onPress={handlePress} />;
}

function AppContent() {
  const { isDark } = useAppTheme();

  return (
    <AuthProvider>
      <AppNavigator />
      <AuthenticatedFab />
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </AuthProvider>
  );
}

export default function App() {
  return (
    <KeyboardProvider>
      <ThemeProvider>
        <ServerConfigProvider>
          <AppContent />
        </ServerConfigProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
}
