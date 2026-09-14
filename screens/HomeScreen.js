import React, { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ORDER_STATUSES, ROUTES } from '../constants';
import { useAppTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { isAuthRequiredError, ordersAPI, stockAPI } from '../utils/api';
import { canExport, canWrite } from '../utils/permissions';
import CyberHome from '../components/home/CyberHome';

const itemsOf = response => Array.isArray(response) ? response : response?.items || [];
const countOf = response => response?.total ?? itemsOf(response).length;

export default function HomeScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { isDark } = useAppTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState({ pendingReview: null, inProgress: null, lowStock: null });
  const [recentOrders, setRecentOrders] = useState([]);
  const requestId = useRef(0);

  const loadDashboard = useCallback(async (refresh = false) => {
    const id = ++requestId.current;
    setRefreshing(refresh);
    if (!refresh) setLoading(true);
    const results = await Promise.allSettled([
      ordersAPI.getAll({ status: ORDER_STATUSES.PENDING_REVIEW, pageSize: 1 }),
      ordersAPI.getAll({ status: ORDER_STATUSES.IN_PROGRESS, pageSize: 1 }),
      ordersAPI.getAll({ pageSize: 4 }),
      stockAPI.getLots(),
    ]);
    if (id !== requestId.current) return;
    if (results.some(r => r.status === 'rejected' && isAuthRequiredError(r.reason))) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const [pending, active, recent, stock] = results;
    setStats({
      pendingReview: pending.status === 'fulfilled' ? countOf(pending.value) : null,
      inProgress: active.status === 'fulfilled' ? countOf(active.value) : null,
      lowStock: stock.status === 'fulfilled' ? itemsOf(stock.value).filter(lot => (lot.qty || 0) <= 100).length : null,
    });
    if (recent.status === 'fulfilled') setRecentOrders(itemsOf(recent.value));
    setError(results.some(r => r.status === 'rejected') ? '部分数据加载失败' : '');
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => {
    loadDashboard();
    return () => { requestId.current += 1; };
  }, [loadDashboard]));

  const handleExport = async () => {
    if (!canExport(user) || exporting) return;
    try {
      setExporting(true);
      const [orders, stock] = await Promise.all([ordersAPI.export(), stockAPI.export()]);
      Alert.alert('导出完成', `订单: ${orders.filename || 'orders.csv'} (${orders.count || 0} 条)\n库存: ${stock.filename || 'stock.csv'} (${stock.count || 0} 条)`);
    } catch (err) {
      if (!isAuthRequiredError(err)) Alert.alert('错误', '导出失败，请检查网络连接或稍后重试');
    } finally {
      setExporting(false);
    }
  };

  return <CyberHome dark={isDark} stats={stats} recentOrders={recentOrders} loading={loading}
    refreshing={refreshing} error={error} exporting={exporting} onRefresh={() => loadDashboard(true)}
    onOrders={status => navigation.navigate(ROUTES.ORDERS, { status, homeRequest: Date.now() })}
    onOrder={orderId => navigation.navigate(ROUTES.ORDER_DETAIL, { orderId })}
    onInventory={() => navigation.navigate(ROUTES.MATERIALS, { activeTab: 'inventory', homeRequest: Date.now() })}
    onAgent={() => navigation.navigate(ROUTES.AGENT)}
    onCreate={canWrite(user) ? () => navigation.navigate(ROUTES.CREATE_ORDER) : undefined}
    onModel={canWrite(user) ? () => navigation.navigate(ROUTES.CREATE_MODEL) : undefined}
    onAdjust={canWrite(user) ? () => navigation.navigate(ROUTES.ADJUST_TRANSACTION) : undefined}
    onExport={canExport(user) ? handleExport : undefined} />;
}
