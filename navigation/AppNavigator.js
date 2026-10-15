import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TabNavigator from './TabNavigator';
import LoginScreen from '../screens/LoginScreen';
import OrderDetailScreen from '../screens/OrderDetailScreen';
import CreateOrderScreen from '../screens/CreateOrderScreen';
import MaterialDetailScreen from '../screens/MaterialDetailScreen';
import CreateMaterialScreen from '../screens/CreateMaterialScreen';
import CreateModelScreen from '../screens/CreateModelScreen';
import EditStockLotScreen from '../screens/EditStockLotScreen';
import ModelDetailScreen from '../screens/ModelDetailScreen';
import InboundTransactionScreen from '../screens/InboundTransactionScreen';
import OutboundTransactionScreen from '../screens/OutboundTransactionScreen';
import AdjustTransactionScreen from '../screens/AdjustTransactionScreen';
import DataImportScreen from '../screens/DataImportScreen';
import UsersScreen from '../screens/UsersScreen';
import PartnersScreen from '../screens/PartnersScreen';
import PartnerDetailScreen from '../screens/PartnerDetailScreen';
import EditPartnerScreen from '../screens/EditPartnerScreen';
import WarehouseSettingsScreen from '../screens/WarehouseSettingsScreen';
import masterDataCore from '../utils/masterDataCore.cjs';
import ServerSetupScreen from '../screens/ServerSetupScreen';
import ServerConnectionErrorScreen from '../screens/ServerConnectionErrorScreen';
import BootstrapOwnerScreen from '../screens/BootstrapOwnerScreen';
import AgentStack from './AgentStack';
import { ROUTES, SCREEN_TITLES } from '../constants';
import { useAuth } from '../context/AuthContext';
import { useAppTheme } from '../context/ThemeContext';
import { useServerConfig } from '../context/ServerConfigContext';
import { canExport, canManage, canWrite } from '../utils/permissions';

const Stack = createNativeStackNavigator();

// Navigation ref so the FAB (mounted outside NavigationContainer in App.js)
// can dispatch navigation actions. isReady() guards against the early-render
// window before the container has mounted.
export const navigationRef = createNavigationContainerRef();

const LoadingScreen = () => {
  const { colors } = useAppTheme();

  return (
    <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
};

const AppNavigator = () => {
  const { initializing: authInitializing, isAuthenticated, user } = useAuth();
  const { initializing: serverInitializing, server, connectionError } = useServerConfig();
  const { colors, isDark } = useAppTheme();
  const navigationTheme = useMemo(() => {
    const baseTheme = isDark ? DarkTheme : DefaultTheme;
    return {
      ...baseTheme,
      colors: {
        ...baseTheme.colors,
        primary: colors.primary,
        background: colors.background,
        card: colors.surfaceElevated,
        text: colors.text,
        border: colors.border,
        notification: colors.danger,
      },
    };
  }, [colors, isDark]);

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: {
            backgroundColor: colors.surfaceElevated,
          },
          headerTintColor: colors.primary,
          headerTitleStyle: {
            color: colors.text,
            fontWeight: '700',
          },
          headerShadowVisible: true,
          headerBackTitleVisible: false,
          contentStyle: {
            backgroundColor: colors.background,
          },
        }}
      >
        {serverInitializing ? (
          <Stack.Screen name="Loading" component={LoadingScreen} options={{ headerShown: false }} />
        ) : !server ? (
          <Stack.Screen name={ROUTES.SERVER_SETUP} component={ServerSetupScreen} options={{ headerShown: false }} />
        ) : connectionError ? (
          <>
            <Stack.Screen name={ROUTES.SERVER_CONNECTION_ERROR} component={ServerConnectionErrorScreen} options={{ headerShown: false }} />
            <Stack.Screen name={ROUTES.SERVER_SETUP} component={ServerSetupScreen} options={{ title: SCREEN_TITLES[ROUTES.SERVER_SETUP] }} />
          </>
        ) : !server.initialized ? (
          <Stack.Screen name={ROUTES.BOOTSTRAP_OWNER} component={BootstrapOwnerScreen} options={{ headerShown: false }} />
        ) : authInitializing ? (
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
            {canWrite(user) ? <Stack.Screen
              name="CreateOrder"
              component={CreateOrderScreen}
              options={({ route }) => ({ title: route.params?.orderId ? '编辑订单' : SCREEN_TITLES[ROUTES.CREATE_ORDER] })}
            /> : null}
            <Stack.Screen
              name="MaterialDetail"
              component={MaterialDetailScreen}
              options={{ title: SCREEN_TITLES[ROUTES.MATERIAL_DETAIL] }}
            />
            {canWrite(user) ? <Stack.Screen
              name="CreateMaterial"
              component={CreateMaterialScreen}
              options={({ route }) => ({ title: route.params?.materialId ? '编辑耗材' : SCREEN_TITLES[ROUTES.CREATE_MATERIAL] })}
            /> : null}
            {canWrite(user) ? <Stack.Screen
              name="CreateModel"
              component={CreateModelScreen}
              options={({ route }) => ({ title: route.params?.modelId ? '编辑模型' : SCREEN_TITLES[ROUTES.CREATE_MODEL] })}
            /> : null}
            <Stack.Screen
              name="ModelDetail"
              component={ModelDetailScreen}
              options={{ title: SCREEN_TITLES[ROUTES.MODEL_DETAIL] }}
            />
            {canWrite(user) ? <Stack.Screen
              name={ROUTES.INBOUND_TRANSACTION}
              component={InboundTransactionScreen}
              options={{ title: SCREEN_TITLES[ROUTES.INBOUND_TRANSACTION] }}
            /> : null}
            {canWrite(user) ? <Stack.Screen
              name={ROUTES.EDIT_STOCK_LOT}
              component={EditStockLotScreen}
              options={{ title: SCREEN_TITLES[ROUTES.EDIT_STOCK_LOT] }}
            /> : null}
            {canWrite(user) ? <Stack.Screen
              name={ROUTES.OUTBOUND_TRANSACTION}
              component={OutboundTransactionScreen}
              options={{ title: SCREEN_TITLES[ROUTES.OUTBOUND_TRANSACTION] }}
            /> : null}
            {canWrite(user) ? <Stack.Screen
              name={ROUTES.ADJUST_TRANSACTION}
              component={AdjustTransactionScreen}
              options={{ title: SCREEN_TITLES[ROUTES.ADJUST_TRANSACTION] }}
            /> : null}
            {canExport(user) ? <Stack.Screen
              name={ROUTES.DATA_IMPORT}
              component={DataImportScreen}
              options={{ title: SCREEN_TITLES[ROUTES.DATA_IMPORT] }}
            /> : null}
            {canManage(user) ? <Stack.Screen
              name={ROUTES.USERS}
              component={UsersScreen}
              options={{ title: SCREEN_TITLES[ROUTES.USERS] }}
            /> : null}
            {masterDataCore.supportsMasterData(server) ? <>
              <Stack.Screen name={ROUTES.CUSTOMERS} component={PartnersScreen} initialParams={{ kind: 'customers' }} options={{ title: SCREEN_TITLES[ROUTES.CUSTOMERS] }} />
              <Stack.Screen name={ROUTES.SUPPLIERS} component={PartnersScreen} initialParams={{ kind: 'suppliers' }} options={{ title: SCREEN_TITLES[ROUTES.SUPPLIERS] }} />
              <Stack.Screen name={ROUTES.PARTNER_DETAIL} component={PartnerDetailScreen} options={{ title: SCREEN_TITLES[ROUTES.PARTNER_DETAIL] }} />
              {canWrite(user) ? <Stack.Screen name={ROUTES.EDIT_PARTNER} component={EditPartnerScreen} options={({ route }) => ({ title: `${route.params?.id ? '编辑' : '新增'}${route.params?.kind === 'suppliers' ? '供应商' : '客户'}` })} /> : null}
              <Stack.Screen name={ROUTES.WAREHOUSE_SETTINGS} component={WarehouseSettingsScreen} options={{ title: SCREEN_TITLES[ROUTES.WAREHOUSE_SETTINGS] }} />
            </> : null}
            <Stack.Screen
              name={ROUTES.AGENT}
              component={AgentStack}
              options={{ headerShown: false, presentation: 'modal' }}
            />
            <Stack.Screen
              name={ROUTES.SERVER_SETUP}
              component={ServerSetupScreen}
              options={{ title: SCREEN_TITLES[ROUTES.SERVER_SETUP], presentation: 'modal' }}
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
  },
});

export default AppNavigator;
