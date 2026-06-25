import React from 'react';
import { Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, ROUTES, SCREEN_TITLES, SPACING } from '../constants';
import HomeScreen from '../screens/HomeScreen';
import OrdersScreen from '../screens/OrdersScreen';
import ModelsScreen from '../screens/ModelsScreen';
import MaterialsScreen from '../screens/MaterialsScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator();

const getTabIcon = (focused, activeName, inactiveName, color, size) => (
  <Ionicons name={focused ? activeName : inactiveName} size={size} color={color} />
);

const TabNavigator = () => {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textTertiary,
        headerStyle: {
          backgroundColor: COLORS.surfaceElevated,
        },
        headerTintColor: COLORS.primary,
        headerTitleStyle: {
          color: COLORS.text,
          fontWeight: '700',
        },
        headerShadowVisible: true,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '700',
          marginTop: 1,
          marginBottom: Platform.OS === 'web' ? 8 : 2,
        },
        tabBarIconStyle: {
          marginTop: 2,
        },
        tabBarStyle: {
          height: Platform.OS === 'web' ? 76 : 72,
          paddingTop: SPACING.sm,
          paddingBottom: Platform.OS === 'ios' ? 18 : SPACING.sm,
          backgroundColor: COLORS.surfaceElevated,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
          ...Platform.select({
            web: {
              boxShadow: '0 -4px 18px rgba(15, 23, 42, 0.06)',
            },
            default: {
              shadowColor: '#0F172A',
              shadowOffset: { width: 0, height: -3 },
              shadowOpacity: 0.06,
              shadowRadius: 10,
              elevation: 8,
            },
          }),
        },
      }}
    >
      <Tab.Screen
        name={ROUTES.HOME}
        component={HomeScreen}
        options={{
          title: SCREEN_TITLES[ROUTES.HOME],
          tabBarIcon: ({ focused, color, size }) => (
            getTabIcon(focused, 'home', 'home-outline', color, size)
          ),
        }}
      />
      <Tab.Screen
        name={ROUTES.ORDERS}
        component={OrdersScreen}
        options={{
          title: SCREEN_TITLES[ROUTES.ORDERS],
          tabBarIcon: ({ focused, color, size }) => (
            getTabIcon(focused, 'document-text', 'document-text-outline', color, size)
          ),
        }}
      />
      <Tab.Screen
        name={ROUTES.MODELS}
        component={ModelsScreen}
        options={{
          title: SCREEN_TITLES[ROUTES.MODELS],
          tabBarIcon: ({ focused, color, size }) => (
            getTabIcon(focused, 'cube', 'cube-outline', color, size)
          ),
        }}
      />
      <Tab.Screen
        name={ROUTES.MATERIALS}
        component={MaterialsScreen}
        options={{
          title: SCREEN_TITLES[ROUTES.MATERIALS],
          tabBarIcon: ({ focused, color, size }) => (
            getTabIcon(focused, 'layers', 'layers-outline', color, size)
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: '设置',
          tabBarIcon: ({ focused, color, size }) => (
            getTabIcon(focused, 'settings', 'settings-outline', color, size)
          ),
        }}
      />
    </Tab.Navigator>
  );
};

export default TabNavigator;
