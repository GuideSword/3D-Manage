import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TabNavigator from './TabNavigator';
import LoginScreen from '../screens/LoginScreen';
import OrderDetailScreen from '../screens/OrderDetailScreen';
import CreateOrderScreen from '../screens/CreateOrderScreen';
import MaterialDetailScreen from '../screens/MaterialDetailScreen';
import CreateMaterialScreen from '../screens/CreateMaterialScreen';
import CreateModelScreen from '../screens/CreateModelScreen';
import ModelDetailScreen from '../screens/ModelDetailScreen';
import InboundTransactionScreen from '../screens/InboundTransactionScreen';
import OutboundTransactionScreen from '../screens/OutboundTransactionScreen';
import AdjustTransactionScreen from '../screens/AdjustTransactionScreen';
import OSSConfigScreen from '../screens/OSSConfigScreen';
import DataImportScreen from '../screens/DataImportScreen';
import AgentStack from './AgentStack';
import { COLORS, ROUTES, SCREEN_TITLES } from '../constants';
import { useAuth } from '../context/AuthContext';

const Stack = createNativeStackNavigator();

// Navigation ref so the FAB (mounted outside NavigationContainer in App.js)
// can dispatch navigation actions. isReady() guards against the early-render
// window before the container has mounted.
export const navigationRef = createNavigationContainerRef();

const LoadingScreen = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color={COLORS.primary} />
  </View>
);

const AppNavigator = () => {
  const { initializing, isAuthenticated } = useAuth();

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: {
            backgroundColor: COLORS.surfaceElevated,
          },
          headerTintColor: COLORS.primary,
          headerTitleStyle: {
            color: COLORS.text,
            fontWeight: '700',
          },
          headerShadowVisible: true,
          headerBackTitleVisible: false,
          contentStyle: {
            backgroundColor: COLORS.background,
          },
        }}
      >
        {initializing ? (
          <Stack.Screen name="Loading" component={LoadingScreen} options={{ headerShown: false }} />
        ) : !isAuthenticated ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Main" component={TabNavigator} options={{ headerShown: false }} />
            <Stack.Screen
              name="OrderDetail"
              component={OrderDetailScreen}
              options={{ title: SCREEN_TITLES[ROUTES.ORDER_DETAIL] }}
            />
            <Stack.Screen
              name="CreateOrder"
              component={CreateOrderScreen}
              options={{ title: SCREEN_TITLES[ROUTES.CREATE_ORDER] }}
            />
            <Stack.Screen
              name="MaterialDetail"
              component={MaterialDetailScreen}
              options={{ title: SCREEN_TITLES[ROUTES.MATERIAL_DETAIL] }}
            />
            <Stack.Screen
              name="CreateMaterial"
              component={CreateMaterialScreen}
              options={{ title: SCREEN_TITLES[ROUTES.CREATE_MATERIAL] }}
            />
            <Stack.Screen
              name="CreateModel"
              component={CreateModelScreen}
              options={{ title: SCREEN_TITLES[ROUTES.CREATE_MODEL] }}
            />
            <Stack.Screen
              name="ModelDetail"
              component={ModelDetailScreen}
              options={{ title: SCREEN_TITLES[ROUTES.MODEL_DETAIL] }}
            />
            <Stack.Screen
              name={ROUTES.INBOUND_TRANSACTION}
              component={InboundTransactionScreen}
              options={{ title: SCREEN_TITLES[ROUTES.INBOUND_TRANSACTION] }}
            />
            <Stack.Screen
              name={ROUTES.OUTBOUND_TRANSACTION}
              component={OutboundTransactionScreen}
              options={{ title: SCREEN_TITLES[ROUTES.OUTBOUND_TRANSACTION] }}
            />
            <Stack.Screen
              name={ROUTES.ADJUST_TRANSACTION}
              component={AdjustTransactionScreen}
              options={{ title: SCREEN_TITLES[ROUTES.ADJUST_TRANSACTION] }}
            />
            <Stack.Screen
              name={ROUTES.OSS_CONFIG}
              component={OSSConfigScreen}
              options={{ title: SCREEN_TITLES[ROUTES.OSS_CONFIG] }}
            />
            <Stack.Screen
              name={ROUTES.DATA_IMPORT}
              component={DataImportScreen}
              options={{ title: SCREEN_TITLES[ROUTES.DATA_IMPORT] }}
            />
            <Stack.Screen
              name={ROUTES.AGENT}
              component={AgentStack}
              options={{ headerShown: false, presentation: 'modal' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
});

export default AppNavigator;
