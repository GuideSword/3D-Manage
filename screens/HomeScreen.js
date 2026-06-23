import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, ROUTES, ORDER_STATUSES } from '../constants';
import { Card } from '../components';
import { ordersAPI, stockAPI, isAuthRequiredError } from '../utils/api';

const LOW_STOCK_THRESHOLD_GRAMS = 100;

const HomeScreen = () => {
  const navigation = useNavigation();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [stats, setStats] = useState({
    pendingReview: 0,
    inProgress: 0,
    lowStock: 0,
  });
  const [recentOrders, setRecentOrders] = useState([]);

  const loadDashboard = async (isRefreshing = false) => {
    try {
      if (!isRefreshing) {
        setLoading(true);
      }

      const [pendingOrders, activeOrders, allOrders, stockLots] = await Promise.all([
        ordersAPI.getAll({ status: ORDER_STATUSES.PENDING_REVIEW }).catch((error) => {
          if (isAuthRequiredError(error)) throw error;
          return { items: [] };
        }),
        ordersAPI.getAll({ status: ORDER_STATUSES.IN_PROGRESS }).catch((error) => {
          if (isAuthRequiredError(error)) throw error;
          return { items: [] };
        }),
        ordersAPI.getAll({ pageSize: 5 }).catch((error) => {
          if (isAuthRequiredError(error)) throw error;
          return { items: [] };
        }),
        stockAPI.getLots().catch((error) => {
          if (isAuthRequiredError(error)) throw error;
          return [];
        }),
      ]);

      const lots = Array.isArray(stockLots) ? stockLots : stockLots.items || [];
      setStats({
        pendingReview: (pendingOrders.items || pendingOrders || []).length,
        inProgress: (activeOrders.items || activeOrders || []).length,
        lowStock: lots.filter((lot) => (lot.qty || 0) <= LOW_STOCK_THRESHOLD_GRAMS).length,
      });
      setRecentOrders(allOrders.items || allOrders || []);
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      console.error('加载首页数据失败:', error);
      Alert.alert('错误', '加载首页数据失败，请检查网络连接');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboard(true);
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      loadDashboard();
    }, [])
  );

  const handleExport = async () => {
    try {
      setExporting(true);
      const [ordersExport, stockExport] = await Promise.all([
        ordersAPI.export(),
        stockAPI.export(),
      ]);
      Alert.alert(
        '导出完成',
        `订单: ${ordersExport.filename || 'orders.csv'} (${ordersExport.count || 0} 条)\n库存: ${stockExport.filename || 'stock.csv'} (${stockExport.count || 0} 条)`,
        [{ text: '确定' }]
      );
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      console.error('导出失败:', error);
      Alert.alert('错误', '导出失败，请检查网络连接或稍后重试');
    } finally {
      setExporting(false);
    }
  };

  const StatCard = ({ title, value, subtitle, color, icon, onPress }) => (
    <TouchableOpacity activeOpacity={0.75} onPress={onPress} style={styles.statCardWrapper}>
      <Card style={styles.statCard}>
        <View style={styles.statHeader}>
          <View style={[styles.iconBadge, { backgroundColor: color }]}>
            <Ionicons name={icon} size={18} color={COLORS.background} />
          </View>
          <Text style={styles.statTitle}>{title}</Text>
        </View>
        <Text style={[styles.statValue, { color }]}>{loading && !refreshing ? '...' : value}</Text>
        <Text style={styles.statSubtitle}>{subtitle}</Text>
      </Card>
    </TouchableOpacity>
  );

  const ActionCard = ({ title, icon, onPress, disabled = false }) => (
    <TouchableOpacity
      style={styles.actionCardWrapper}
      onPress={disabled ? undefined : onPress}
      activeOpacity={0.75}
      disabled={disabled}
    >
      <Card style={[styles.actionCard, disabled && styles.disabledCard]}>
        {disabled ? (
          <ActivityIndicator size="small" color={COLORS.primary} />
        ) : (
          <Ionicons name={icon} size={24} color={COLORS.primary} />
        )}
        <Text style={styles.actionText}>{title}</Text>
      </Card>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.primary]}
            tintColor={COLORS.primary}
          />
        )}
      >
        <View style={styles.header}>
          <Text style={styles.welcomeText}>欢迎使用</Text>
          <Text style={styles.appTitle}>3D打印管理系统</Text>
        </View>

        <View style={styles.statsContainer}>
          <StatCard
            title="待审核订单"
            value={stats.pendingReview}
            subtitle="需要确认后进入执行"
            color={COLORS.warning}
            icon="time-outline"
            onPress={() => navigation.navigate(ROUTES.ORDERS, { status: ORDER_STATUSES.PENDING_REVIEW })}
          />
          <StatCard
            title="执行中订单"
            value={stats.inProgress}
            subtitle="正在生产或准备中"
            color={COLORS.primary}
            icon="construct-outline"
            onPress={() => navigation.navigate(ROUTES.ORDERS, { status: ORDER_STATUSES.IN_PROGRESS })}
          />
          <StatCard
            title="低库存批次"
            value={stats.lowStock}
            subtitle={`低于 ${LOW_STOCK_THRESHOLD_GRAMS}g`}
            color={COLORS.danger}
            icon="alert-circle-outline"
            onPress={() => navigation.navigate(ROUTES.MATERIALS, { activeTab: 'inventory' })}
          />
        </View>

        <View style={styles.quickActions}>
          <Text style={styles.sectionTitle}>快捷操作</Text>
          <View style={styles.actionsGrid}>
            <ActionCard
              title="新建订单"
              icon="document-text-outline"
              onPress={() => navigation.navigate(ROUTES.CREATE_ORDER)}
            />
            <ActionCard
              title="新增模型"
              icon="cube-outline"
              onPress={() => navigation.navigate(ROUTES.CREATE_MODEL)}
            />
            <ActionCard
              title="库存盘点"
              icon="swap-horizontal-outline"
              onPress={() => navigation.navigate(ROUTES.ADJUST_TRANSACTION)}
            />
            <ActionCard
              title={exporting ? '导出中...' : '导出数据'}
              icon="download-outline"
              onPress={handleExport}
              disabled={exporting}
            />
          </View>
        </View>

        <View style={styles.recentActivity}>
          <Text style={styles.sectionTitle}>最近订单</Text>
          <Card style={styles.activityCard}>
            {recentOrders.length > 0 ? recentOrders.slice(0, 3).map((order) => (
              <TouchableOpacity
                key={order.id}
                style={styles.activityRow}
                onPress={() => navigation.navigate(ROUTES.ORDER_DETAIL, { orderId: order.id })}
              >
                <View style={styles.activityTextGroup}>
                  <Text style={styles.activityTitle}>{order.customer?.name || '未知客户'}</Text>
                  <Text style={styles.activityMeta}>订单 #{order.id} · {order.status}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )) : (
              <Text style={styles.emptyText}>暂无最近订单</Text>
            )}
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.light,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 20,
    backgroundColor: COLORS.primary,
  },
  welcomeText: {
    fontSize: 16,
    color: COLORS.background,
    opacity: 0.85,
  },
  appTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.background,
    marginTop: 4,
  },
  statsContainer: {
    padding: 16,
  },
  statCardWrapper: {
    marginBottom: 12,
  },
  statCard: {
    minHeight: 112,
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  statTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  statValue: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  quickActions: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  actionCardWrapper: {
    width: '48%',
    marginBottom: 12,
  },
  actionCard: {
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledCard: {
    opacity: 0.7,
  },
  actionText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 8,
  },
  recentActivity: {
    padding: 16,
    paddingBottom: 32,
  },
  activityCard: {
    paddingVertical: 4,
  },
  activityRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: 10,
  },
  activityTextGroup: {
    flex: 1,
    marginRight: 12,
  },
  activityTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  activityMeta: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingVertical: 18,
  },
});

export default HomeScreen;
