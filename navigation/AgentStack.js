import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AgentChatScreen from '../screens/AgentChatScreen';
import AgentSettingsScreen from '../screens/AgentSettingsScreen';

// Stack navigator for the Agent flow:
//   - AgentChat       (default; opened by the DraggableFab)
//   - AgentSettings   (reached via the ⚙️ button in the chat header)
//
// The parent integrates this stack into the root navigator as a
// MODAL so the chat covers the whole screen. See the integration
// instructions at the bottom of this file.

const Stack = createNativeStackNavigator();

export default function AgentStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="AgentChat"
        component={AgentChatScreen}
        options={{ title: 'AI 助手' }}
      />
      <Stack.Screen
        name="AgentSettings"
        component={AgentSettingsScreen}
        options={{ title: 'AI 服务设置' }}
      />
    </Stack.Navigator>
  );
}

// INTEGRATION INSTRUCTIONS (the parent agent runs these):
//
// 1. Register the stack in navigation/AppNavigator.js (or wherever the
//    root stack is defined) and present it as a modal so it covers
//    the tabs underneath:
//
//      import AgentStack from './AgentStack';
//
//      <Stack.Screen
//        name="Agent"
//        component={AgentStack}
//        options={{ headerShown: false, presentation: 'modal' }}
//      />
//
// 2. Mount the DraggableFab in App.js (or in AppNavigator.js, after
//    the auth gate) and navigate to 'Agent' when it's tapped:
//
//      import DraggableFab from './components/agent/DraggableFab';
//      import { useNavigation } from '@react-navigation/native';
//
//      const nav = useNavigation();
//      ... <DraggableFab onPress={() => nav.navigate('Agent')} /> ...
//
// 3. The Agent chat screen already pushes 'AgentSettings' from its
//    header right button — no extra wiring needed.
