import React from 'react';
import { StatusBar } from 'expo-status-bar';
import AppNavigator, { navigationRef } from './navigation/AppNavigator';
import { AuthProvider, useAuth } from './context/AuthContext';
import DraggableFab from './components/agent/DraggableFab';
import { ROUTES } from './constants';

// Mounts the draggable FAB only when the user is authenticated.
// The FAB lives OUTSIDE the NavigationContainer, so we use the navigation
// ref exported by AppNavigator to dispatch the Agent modal.
function AuthenticatedFab() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) return null;

  const handlePress = () => {
    if (navigationRef.isReady()) {
      navigationRef.navigate(ROUTES.AGENT);
    } else {
      console.warn('[AgentFab] NavigationContainer not ready yet, tap ignored');
    }
  };

  return <DraggableFab onPress={handlePress} />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppNavigator />
      <AuthenticatedFab />
      <StatusBar style="auto" />
    </AuthProvider>
  );
}
