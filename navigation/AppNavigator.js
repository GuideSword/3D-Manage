import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TabNavigator from './TabNavigator';
import OrderDetailScreen from '../screens/OrderDetailScreen';
import CreateOrderScreen from '../screens/CreateOrderScreen';
import MaterialDetailScreen from '../screens/MaterialDetailScreen';
import CreateMaterialScreen from '../screens/CreateMaterialScreen';
import CreateModelScreen from '../screens/CreateModelScreen';
import ModelDetailScreen from '../screens/ModelDetailScreen';
import InboundTransactionScreen from '../screens/InboundTransactionScreen';
import OutboundTransactionScreen from '../screens/OutboundTransactionScreen';
import { SCREEN_TITLES, ROUTES } from '../constants';

const Stack = createNativeStackNavigator();

const AppNavigator = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: {
            backgroundColor: '#007AFF',
          },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: {
            fontWeight: 'bold',
          },
        }}
      >
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
          name="InboundTransaction"
          component={InboundTransactionScreen}
          options={{ title: '入库操作' }}
        />
        <Stack.Screen
          name="OutboundTransaction"
          component={OutboundTransactionScreen}
          options={{ title: '出库操作' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
