import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ROUTES, SCREEN_TITLES } from '../constants';
import HomeScreen from '../screens/HomeScreen';
import OrdersScreen from '../screens/OrdersScreen';
import ModelsScreen from '../screens/ModelsScreen';
import MaterialsScreen from '../screens/MaterialsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { useAppTheme } from '../context/ThemeContext';
import CyberTabBar from './CyberTabBar';

const Tab = createBottomTabNavigator();

export default function TabNavigator() {
  const { colors } = useAppTheme();
  return <Tab.Navigator tabBar={props => <CyberTabBar {...props} />} screenOptions={{
    headerStyle: { backgroundColor: colors.surfaceElevated },
    headerTintColor: colors.primary,
    headerTitleStyle: { color: colors.text, fontWeight: '700' },
    headerShadowVisible: true,
  }}>
    <Tab.Screen name={ROUTES.HOME} component={HomeScreen} options={{ title: SCREEN_TITLES[ROUTES.HOME], headerShown: false }} />
    <Tab.Screen name={ROUTES.ORDERS} component={OrdersScreen} options={{ title: SCREEN_TITLES[ROUTES.ORDERS], headerShown: false }} />
    <Tab.Screen name={ROUTES.MODELS} component={ModelsScreen} options={{ title: SCREEN_TITLES[ROUTES.MODELS], headerShown: false }} />
    <Tab.Screen name={ROUTES.MATERIALS} component={MaterialsScreen} options={{ title: SCREEN_TITLES[ROUTES.MATERIALS], headerShown: false }} />
    <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: '设置', headerShown: false }} />
  </Tab.Navigator>;
}
