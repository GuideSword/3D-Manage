// 备份文件 - 如果简化版本有问题可以恢复
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, ROUTES, SCREEN_TITLES } from '../constants';

import HomeScreen from '../screens/HomeScreen';
import OrdersScreen from '../screens/OrdersScreen';
import ModelsScreen from '../screens/ModelsScreen';
import MaterialsScreen from '../screens/MaterialsScreen';

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
      }}
    >
      <Tab.Screen
        name={ROUTES.HOME}
        component={HomeScreen}
        options={{
          title: SCREEN_TITLES[ROUTES.HOME],
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name={ROUTES.ORDERS}
        component={OrdersScreen}
        options={{
          title: SCREEN_TITLES[ROUTES.ORDERS],
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name={ROUTES.MODELS}
        component={ModelsScreen}
        options={{
          title: SCREEN_TITLES[ROUTES.MODELS],
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cube" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name={ROUTES.MATERIALS}
        component={MaterialsScreen}
        options={{
          title: SCREEN_TITLES[ROUTES.MATERIALS],
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="layers" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

export default TabNavigator;


