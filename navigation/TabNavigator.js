import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, ROUTES, SCREEN_TITLES } from '../constants';

// 导入屏幕组件（暂时使用占位符，后续创建）
import HomeScreen from '../screens/HomeScreen';
import OrdersScreen from '../screens/OrdersScreen';
import ModelsScreen from '../screens/ModelsScreen';
import MaterialsScreen from '../screens/MaterialsScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator();

const TabNavigator = () => {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textSecondary,
        headerStyle: {
          backgroundColor: COLORS.primary,
        },
        headerTintColor: COLORS.background,
        headerTitleStyle: {
          fontWeight: 'bold',
        },
        tabBarStyle: {
          backgroundColor: COLORS.background,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
        },
      }}
    >
      <Tab.Screen
        name={ROUTES.HOME}
        component={HomeScreen}
        options={{
          title: SCREEN_TITLES[ROUTES.HOME],
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name={ROUTES.ORDERS}
        component={OrdersScreen}
        options={{
          title: SCREEN_TITLES[ROUTES.ORDERS],
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'document-text' : 'document-text-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name={ROUTES.MODELS}
        component={ModelsScreen}
        options={{
          title: SCREEN_TITLES[ROUTES.MODELS],
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'cube' : 'cube-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name={ROUTES.MATERIALS}
        component={MaterialsScreen}
        options={{
          title: SCREEN_TITLES[ROUTES.MATERIALS],
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'layers' : 'layers-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: '设置',
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'settings' : 'settings-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

export default TabNavigator;
