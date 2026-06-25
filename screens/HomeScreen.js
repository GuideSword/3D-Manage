import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  COLORS,
  ORDER_STATUSES,
  RADIUS,
  ROUTES,
  SPACING,
  TYPOGRAPHY,
} from '../constants';
import { Card } from '../components';
import { isAuthRequiredError, ordersAPI, stockAPI } from '../utils/api';

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

  const displayValue = (value) => (loading && !refreshing ? '...' : value);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.primary]}
            tintColor={COLORS.primary}
          />
        )}
      >
        <View style={styles.hero}>
          <View style={styles.heroTextGroup}>
            <Text style={styles.eyebrow}>运营概览</Text>
            <Text style={styles.title}>欢迎回来</Text>
            <Text style={styles.subtitle}>
              关注待审核订单、生产进度和库存风险。
            </Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.82}
            onPress={handleExport}
            disabled={exporting}
            style={[styles.exportButton, exporting && styles.exportButtonDisabled]}
          >
            {exporting ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Ionicons name="download-outline" size={19} color={COLORS.primary} />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.statsGrid}>
          <StatCard
            title="待审核订单"
            value={displayValue(stats.pendingReview)}
            subtitle="需要确认后进入执行"
            color={COLORS.warning}
            icon="time-outline"
            onPress={() => navigation.navigate(ROUTES.ORDERS, { status: ORDER_STATUSES.PENDING_REVIEW })}
          />
          <StatCard
            title="执行中订单"
            value={displayValue(stats.inProgress)}
            subtitle="正在生产或准备中"
            color={COLORS.primary}
            icon="construct-outline"
            onPress={() => navigation.navigate(ROUTES.ORDERS, { status: ORDER_STATUSES.IN_PROGRESS })}
          />
          <StatCard
            title="低库存批次"
            value={displayValue(stats.lowStock)}
            subtitle={`低于 ${LOW_STOCK_THRESHOLD_GRAMS}g`}
            color={COLORS.danger}
            icon="alert-circle-outline"
            onPress={() => navigation.navigate(ROUTES.MATERIALS, { activeTab: 'inventory' })}
          />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>快捷操作</Text>
          </View>
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

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>最近订单</Text>
            <TouchableOpacity
              activeOpacity={0.82}
              onPress={() => navigation.navigate(ROUTES.ORDERS)}
              style={styles.sectionLink}
            >
              <Text style={styles.sectionLinkText}>查看全部</Text>
              <Ionicons name="arrow-forward" size={14} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
          <Card padding="none" style={styles.recentCard}>
            {recentOrders.length > 0 ? recentOrders.slice(0, 4).map((order, index) => (
              <TouchableOpacity
                key={order.id}
                style={[
                  styles.activityRow,
                  index === recentOrders.slice(0, 4).length - 1 && styles.activityRowLast,
                ]}
                activeOpacity={0.82}
                onPress={() => navigation.navigate(ROUTES.ORDER_DETAIL, { orderId: order.id })}
              >
                <View style={styles.activityIcon}>
                  <Ionicons name="receipt-outline" size={18} color={COLORS.primary} />
                </View>
                <View style={styles.activityTextGroup}>
                  <Text style={styles.activityTitle} numberOfLines={1}>
                    {order.customer?.name || '未知客户'}
                  </Text>
                  <Text style={styles.activityMeta} numberOfLines={1}>
                    订单 #{order.id} · {order.status || '未知状态'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textTertiary} />
              </TouchableOpacity>
            )) : (
              <View style={styles.emptyState}>
                <Ionicons name="file-tray-outline" size={30} color={COLORS.textTertiary} />
                <Text style={styles.emptyText}>暂无最近订单</Text>
              </View>
            )}
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const StatCard = ({ title, value, subtitle, color, icon, onPress }) => (
  <TouchableOpacity activeOpacity={0.82} onPress={onPress} style={styles.statCardWrapper}>
    <Card style={styles.statCard} interactive>
      <View style={styles.statTopRow}>
        <View style={[styles.iconBadge, { backgroundColor: `${color}18` }]}>
          <Ionicons name={icon} size={18} color={color} />
        </View>
        <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
      <Text style={styles.statSubtitle} numberOfLines={1}>{subtitle}</Text>
    </Card>
  </TouchableOpacity>
);

const ActionCard = ({ title, icon, onPress, disabled = false }) => (
  <TouchableOpacity
    style={styles.actionCardWrapper}
    onPress={disabled ? undefined : onPress}
    activeOpacity={0.82}
    disabled={disabled}
  >
    <Card style={[styles.actionCard, disabled && styles.disabledCard]} interactive>
      <View style={styles.actionIcon}>
        {disabled ? (
          <ActivityIndicator size="small" color={COLORS.primary} />
        ) : (
          <Ionicons name={icon} size={22} color={COLORS.primary} />
        )}
      </View>
      <Text style={styles.actionText} numberOfLines={1}>{title}</Text>
    </Card>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  heroTextGroup: {
    flex: 1,
  },
  eyebrow: {
    ...TYPOGRAPHY.caption,
    color: COLORS.primary,
    marginBottom: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.screenTitle,
    color: COLORS.text,
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  exportButton: {
    width: 42,
    height: 42,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  exportButtonDisabled: {
    opacity: 0.72,
  },
  statsGrid: {
    gap: SPACING.md,
    marginBottom: SPACING.xl,
  },
  statCardWrapper: {
    minHeight: 136,
  },
  statCard: {
    minHeight: 128,
    justifyContent: 'space-between',
    marginHorizontal: 0,
  },
  statTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconBadge: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: SPACING.md,
  },
  statTitle: {
    ...TYPOGRAPHY.sectionTitle,
    color: COLORS.text,
    marginTop: SPACING.xs,
  },
  statSubtitle: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  sectionHeader: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    ...TYPOGRAPHY.sectionTitle,
    color: COLORS.text,
  },
  sectionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  sectionLinkText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.primary,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: SPACING.md,
  },
  actionCardWrapper: {
    width: '48%',
  },
  actionCard: {
    minHeight: 104,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginHorizontal: 0,
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
    marginBottom: SPACING.md,
  },
  disabledCard: {
    opacity: 0.72,
  },
  actionText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
  },
  recentCard: {
    marginHorizontal: 0,
    overflow: 'hidden',
  },
  activityRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  activityRowLast: {
    borderBottomWidth: 0,
  },
  activityIcon: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
    marginRight: SPACING.md,
  },
  activityTextGroup: {
    flex: 1,
    marginRight: SPACING.md,
  },
  activityTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 2,
  },
  activityMeta: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  emptyState: {
    minHeight: 118,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  emptyText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
  },
});

export default HomeScreen;
