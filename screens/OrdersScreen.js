import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  ORDER_STATUS_LABELS,
  ROUTES,
  TYPOGRAPHY,
} from '../constants';
import {
  Badge,
  Card,
  CyberChip,
  CyberEmptyState,
  CyberIconButton,
  CyberMetricStrip,
  CyberPageHeader,
  CyberSearchField,
  CyberSectionHeading,
  StatusActionSheet,
  cyberTheme,
} from '../components';
import { useAppTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { isAuthRequiredError, ordersAPI } from '../utils/api';
import { isRestorable, isTerminalStatus } from '../utils/orderStatus';
import { canWrite } from '../utils/permissions';

const OrdersScreen = ({ navigation, route }) => {
  const { user } = useAuth();
  const { isDark } = useAppTheme();
  const t = React.useMemo(() => cyberTheme(isDark), [isDark]);
  const styles = React.useMemo(() => createStyles(t), [t]);
  const [orders, setOrders] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [statusSheetOrder, setStatusSheetOrder] = useState(null);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const params = {};
      if (filterStatus !== 'all') {
        params.status = filterStatus;
      }
      if (searchQuery) {
        params.search = searchQuery;
      }
      const response = await ordersAPI.getAll(params);
      setOrders(response.items || response || []);
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      console.error('获取订单失败:', error);
      Alert.alert('错误', '获取订单列表失败，请检查网络连接');
      setOrders([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleDelete = async (orderId) => {
    Alert.alert(
      '确认删除',
      '确定要删除这个订单吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingId(orderId);
              await ordersAPI.delete(orderId);
              Alert.alert('成功', '订单已删除');
              await fetchOrders();
            } catch (error) {
              if (isAuthRequiredError(error)) {
                return;
              }
              Alert.alert('错误', '删除订单失败');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  const handleStatusChange = async (orderId, newStatus) => {
    if (updatingId) {
      return;
    }
    setStatusSheetOrder(null);
    try {
      setUpdatingId(orderId);
      await ordersAPI.updateStatus(orderId, newStatus);
      setOrders((prev) => prev.map((item) => (
        item.id === orderId ? { ...item, status: newStatus } : item
      )));
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      Alert.alert('错误', '修改订单状态失败');
    } finally {
      setUpdatingId(null);
    }
  };

  const showStatusPicker = (order) => {
    if (!order) {
      return;
    }
    if (updatingId || deletingId) {
      Alert.alert('提示', '当前有订单正在处理中，请稍候再试');
      return;
    }
    setStatusSheetOrder(order);
  };

  const closeStatusSheet = () => {
    if (updatingId) {
      return;
    }
    setStatusSheetOrder(null);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchOrders();
  };

  useEffect(() => {
    fetchOrders();
  }, [filterStatus, searchQuery]);

  useEffect(() => {
    if (route?.params?.status) {
      setFilterStatus(route.params.status);
    }
  }, [route?.params?.status, route?.params?.homeRequest]);

  const orderMetrics = React.useMemo(() => [
    { label: '当前列表', value: orders.length, tone: 'primary' },
    {
      label: '待审核',
      value: orders.filter((order) => order.status === 'pending_review').length,
      tone: 'pink',
    },
    {
      label: '执行中',
      value: orders.filter((order) => order.status === 'in_progress').length,
      tone: 'blue',
    },
  ], [orders]);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.container}>
      <View style={styles.page}>
      <CyberPageHeader
        eyebrow="ORDER QUEUE"
        title="订单中心"
        subtitle="今天的委托，也要稳稳送达。"
        onAssistant={() => navigation.navigate(ROUTES.AGENT)}
        actions={canWrite(user) ? (
          <CyberIconButton
            icon="add"
            label="新建订单"
            active
            onPress={() => navigation.navigate(ROUTES.CREATE_ORDER)}
          />
        ) : null}
      />
      <CyberSearchField
        placeholder="搜索客户、订单号或备注"
        value={searchQuery}
        onChangeText={setSearchQuery}
      />
      <CyberMetricStrip metrics={orderMetrics} />
      <ScrollView
        horizontal
        style={styles.filterScroll}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBar}
      >
        <CyberChip
          label="全部"
          active={filterStatus === 'all'}
          onPress={() => setFilterStatus('all')}
        />
        {Object.entries(ORDER_STATUS_LABELS).map(([status, label]) => (
          <CyberChip
            key={status}
            label={label}
            active={filterStatus === status}
            color={getOrderStatusColor(status, t)}
            onPress={() => setFilterStatus(status)}
          />
        ))}
      </ScrollView>
      <CyberSectionHeading
        title="订单列表"
        hint={canWrite(user) ? '长按可更新状态' : `${orders.length} 条结果`}
      />

      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={t.primary} />
          <Text style={styles.loadingText}>加载订单中...</Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={orders}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              navigation={navigation}
              deletingId={deletingId}
              updatingId={updatingId}
              onDelete={handleDelete}
              onLongPress={showStatusPicker}
              editable={canWrite(user)}
            />
          )}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[t.primary]}
              tintColor={t.primary}
            />
          )}
          contentContainerStyle={[
            styles.listContainer,
            orders.length === 0 && styles.emptyListContainer,
          ]}
          ListEmptyComponent={(
            <CyberEmptyState
              title={searchQuery ? '没有找到这份委托' : '还没有订单喵'}
              description="新建订单后，客户、交期和生产状态会显示在这里。"
              actionLabel={canWrite(user) ? '新建订单' : undefined}
              onAction={canWrite(user) ? () => navigation.navigate(ROUTES.CREATE_ORDER) : undefined}
            />
          )}
        />
      )}
      {canWrite(user) ? <StatusActionSheet
        visible={Boolean(statusSheetOrder)}
        order={statusSheetOrder}
        mode={isRestorable(statusSheetOrder?.status) ? 'restore' : 'status'}
        busy={Boolean(updatingId)}
        onSelect={(status) => handleStatusChange(statusSheetOrder.id, status)}
        onConfirmRestore={(status) => handleStatusChange(statusSheetOrder.id, status)}
        onClose={closeStatusSheet}
      /> : null}
      </View>
    </SafeAreaView>
  );
};

const OrderCard = ({ order, navigation, deletingId, updatingId, onDelete, onLongPress, editable }) => {
  const { isDark } = useAppTheme();
  const t = React.useMemo(() => cyberTheme(isDark), [isDark]);
  const styles = React.useMemo(() => createStyles(t), [t]);
  const customerName = order.customer?.name || order.customerName || '未知客户';
  const orderItems = order.items || order.orderItems || [];
  const statusColor = getOrderStatusColor(order.status, t);
  const statusLabel = ORDER_STATUS_LABELS[order.status] || '未知';
  const isUpdating = updatingId === order.id;
  const isDeleting = deletingId === order.id;
  const isBusy = isUpdating || isDeleting;
  const longPressEnabled = editable && !isTerminalStatus(order.status);

  return (
    <TouchableOpacity
      activeOpacity={0.84}
      onPress={() => {
        if (isBusy) {
          return;
        }
        navigation.navigate(ROUTES.ORDER_DETAIL, { orderId: order.id });
      }}
      onLongPress={longPressEnabled ? () => onLongPress?.(order) : undefined}
      delayLongPress={420}
    >
      <Card style={styles.orderCard} interactive>
        <View style={[styles.statusRail, { backgroundColor: statusColor }]} />
        <View style={styles.orderHeader}>
          <View style={styles.customerInfo}>
            <Text style={styles.customerName} numberOfLines={1}>{customerName}</Text>
            <Text style={styles.orderId}>订单 #{order.id}</Text>
          </View>
          <View style={styles.headerRight}>
            {isUpdating ? (
              <View style={styles.statusUpdating}>
                <ActivityIndicator size="small" color={statusColor} />
              </View>
            ) : (
              <Badge text={statusLabel} color={statusColor} size="small" />
            )}
            {editable ? <TouchableOpacity
              style={styles.deleteButton}
              onPress={(event) => {
                event.stopPropagation?.();
                onDelete(order.id);
              }}
              onLongPress={(event) => {
                event?.stopPropagation?.();
              }}
              disabled={isBusy}
            >
              {isDeleting ? (
                <ActivityIndicator size="small" color={t.danger} />
              ) : (
                <Ionicons name="trash-outline" size={18} color={t.danger} />
              )}
            </TouchableOpacity> : null}
          </View>
        </View>

        <View style={styles.metaGrid}>
          <MetaItem label="总价" value={`¥${order.total || 0}`} />
          <MetaItem label="交期" value={formatShortDate(order.dueDate || order.due_date)} />
          <MetaItem
            label="创建"
            value={formatShortDate(order.createdAt || order.created_at)}
            last
          />
        </View>

        {orderItems.length > 0 ? (
          <View style={styles.itemsPreview}>
            <Text style={styles.itemsLabel}>订单项目</Text>
            {orderItems.slice(0, 2).map((item, index) => {
              const modelName = item.modelName || item.model_name || '';
              const materialType = item.materialType || item.material_type || '';
              const color = item.color || '';
              const quantity = item.quantity || item.qty || 0;
              const itemParts = [];
              if (modelName) itemParts.push(modelName);
              if (materialType) itemParts.push(materialType);
              if (color) itemParts.push(color);
              const itemText = itemParts.length > 0
                ? `${itemParts.join(' ')} x${quantity}`
                : `${materialType || '未知'} ${color || ''} x${quantity}`.trim();

              return (
                <Text key={`${order.id}-${index}`} style={styles.itemText} numberOfLines={1}>
                  {itemText}
                </Text>
              );
            })}
            {orderItems.length > 2 ? (
              <Text style={styles.moreItems}>还有 {orderItems.length - 2} 个项目</Text>
            ) : null}
          </View>
        ) : null}
      </Card>
    </TouchableOpacity>
  );
};

const MetaItem = ({ label, value, last = false }) => {
  const { isDark } = useAppTheme();
  const t = React.useMemo(() => cyberTheme(isDark), [isDark]);
  const styles = React.useMemo(() => createStyles(t), [t]);
  return <View style={[styles.metaItem, last && styles.metaItemLast]}>
    <Text style={styles.metaLabel}>{label}</Text>
    <Text style={styles.metaValue} numberOfLines={1}>{value}</Text>
  </View>;
};

const getOrderStatusColor = (status, t) => ({
  draft: t.muted,
  pending_review: t.pink,
  in_progress: t.blue,
  completed: t.success,
  cancelled: t.danger,
}[status] || t.muted);

const formatShortDate = (value) => {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day}`;
};

const createStyles = (t) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.background,
  },
  page: {
    flex: 1,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  filterBar: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
    alignItems: 'center',
  },
  filterScroll: {
    flexGrow: 0,
    maxHeight: 42,
  },
  list: { flex: 1 },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    ...TYPOGRAPHY.meta,
    color: t.muted,
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 22,
  },
  emptyListContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  orderCard: {
    position: 'relative',
    overflow: 'hidden',
    marginHorizontal: 0,
    marginVertical: 0,
    marginBottom: 10,
    borderRadius: 20,
    backgroundColor: t.glass,
    borderColor: t.border,
    shadowColor: t.glow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 2,
  },
  statusRail: {
    position: 'absolute',
    left: 0,
    top: 14,
    bottom: 14,
    width: 3,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    paddingLeft: 6,
  },
  customerInfo: {
    flex: 1,
    minWidth: 0,
  },
  customerName: {
    ...TYPOGRAPHY.sectionTitle,
    color: t.text,
  },
  orderId: {
    ...TYPOGRAPHY.caption,
    color: t.muted,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deleteButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.dangerSoft,
  },
  statusUpdating: {
    minWidth: 60,
    height: 26,
    paddingHorizontal: 8,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.surfaceMuted,
  },
  metaGrid: {
    flexDirection: 'row',
    marginTop: 11,
    marginLeft: 6,
  },
  metaItem: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderRightColor: t.border,
  },
  metaItemLast: { borderRightWidth: 0 },
  metaLabel: {
    ...TYPOGRAPHY.caption,
    color: t.muted,
  },
  metaValue: {
    ...TYPOGRAPHY.meta,
    color: t.text,
    marginTop: 2,
  },
  itemsPreview: {
    marginTop: 9,
    marginLeft: 6,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 11,
    backgroundColor: t.surfaceMuted,
  },
  itemsLabel: {
    ...TYPOGRAPHY.caption,
    color: t.muted,
    marginBottom: 4,
  },
  itemText: {
    ...TYPOGRAPHY.meta,
    color: t.text,
    marginTop: 2,
  },
  moreItems: {
    ...TYPOGRAPHY.caption,
    color: t.primary,
    marginTop: 4,
  },
});

export default OrdersScreen;
