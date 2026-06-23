import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
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
import { COLORS, SCREEN_TITLES, ROUTES } from '../constants';
import { useAuth } from '../context/AuthContext';

const Stack = createNativeStackNavigator();

const LoadingScreen = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color={COLORS.primary} />
  </View>
);

const AppNavigator = () => {
  const { initializing, isAuthenticated } = useAuth();

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: {
            backgroundColor: COLORS.primary,
          },
          headerTintColor: COLORS.background,
          headerTitleStyle: {
            fontWeight: 'bold',
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
              options={{ title: SCREEN_TITLES[ROUTES.ORDER_DETAIL] || '订单详情' }}
            />
            <Stack.Screen
              name="CreateOrder"
              component={CreateOrderScreen}
              options={{ title: '新建订单' }}
            />
            <Stack.Screen
              name="MaterialDetail"
              component={MaterialDetailScreen}
              options={{ title: SCREEN_TITLES[ROUTES.MATERIAL_DETAIL] || '物料详情' }}
            />
            <Stack.Screen
              name="CreateMaterial"
              component={CreateMaterialScreen}
              options={{ title: '新建物料' }}
            />
            <Stack.Screen
              name="CreateModel"
              component={CreateModelScreen}
              options={{ title: '新建模型' }}
            />
            <Stack.Screen
              name="ModelDetail"
              component={ModelDetailScreen}
              options={{ title: SCREEN_TITLES[ROUTES.MODEL_DETAIL] || '模型详情' }}
            />
            <Stack.Screen
              name={ROUTES.INBOUND_TRANSACTION}
              component={InboundTransactionScreen}
              options={{ title: SCREEN_TITLES[ROUTES.INBOUND_TRANSACTION] || '入库操作' }}
            />
            <Stack.Screen
              name={ROUTES.OUTBOUND_TRANSACTION}
              component={OutboundTransactionScreen}
              options={{ title: SCREEN_TITLES[ROUTES.OUTBOUND_TRANSACTION] || '出库操作' }}
            />
            <Stack.Screen
              name={ROUTES.ADJUST_TRANSACTION}
              component={AdjustTransactionScreen}
              options={{ title: SCREEN_TITLES[ROUTES.ADJUST_TRANSACTION] || '库存盘点' }}
            />
            <Stack.Screen
              name={ROUTES.OSS_CONFIG}
              component={OSSConfigScreen}
              options={{ title: SCREEN_TITLES[ROUTES.OSS_CONFIG] || 'OSS 配置' }}
            />
            <Stack.Screen
              name={ROUTES.DATA_IMPORT}
              component={DataImportScreen}
              options={{ title: SCREEN_TITLES[ROUTES.DATA_IMPORT] || '数据导入' }}
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
