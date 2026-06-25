import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  COLORS,
  ORDER_STATUS_COLORS,
  ORDER_STATUS_LABELS,
  ROUTES,
  RADIUS,
  SPACING,
  TYPOGRAPHY,
} from '../constants';
import { Badge, Button, Card } from '../components';
import { isAuthRequiredError, ordersAPI } from '../utils/api';

const OrdersScreen = ({ navigation, route }) => {
  const [orders, setOrders] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showFilter, setShowFilter] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

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
  }, [route?.params?.status]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleGroup}>
          <Text style={styles.eyebrow}>ORDER QUEUE</Text>
          <Text style={styles.title}>订单</Text>
        </View>
        <View style={styles.headerActions}>
          <IconButton
            icon="search"
            active={showSearch}
            onPress={() => setShowSearch((value) => !value)}
          />
          <IconButton
            icon="filter"
            active={showFilter && filterStatus !== 'all'}
            onPress={() => setShowFilter((value) => !value)}
          />
          <IconButton
            icon="add"
            active
            onPress={() => navigation.navigate(ROUTES.CREATE_ORDER)}
          />
        </View>
      </View>

      {showSearch ? (
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color={COLORS.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="搜索客户、订单号或备注"
            placeholderTextColor={COLORS.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.searchClear}>
              <Ionicons name="close" size={16} color={COLORS.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {showFilter ? (
        <ScrollView
          horizontal
          style={styles.filterScroll}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterBar}
        >
          <FilterChip
            label="全部"
            active={filterStatus === 'all'}
            onPress={() => setFilterStatus('all')}
          />
          {Object.entries(ORDER_STATUS_LABELS).map(([status, label]) => (
            <FilterChip
              key={status}
              label={label}
              active={filterStatus === status}
              color={ORDER_STATUS_COLORS[status]}
              onPress={() => setFilterStatus(status)}
            />
          ))}
        </ScrollView>
      ) : null}

      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>加载订单中...</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              navigation={navigation}
              deletingId={deletingId}
              onDelete={handleDelete}
            />
          )}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
              tintColor={COLORS.primary}
            />
          )}
          contentContainerStyle={[
            styles.listContainer,
            orders.length === 0 && styles.emptyListContainer,
          ]}
          ListEmptyComponent={(
            <View style={styles.emptyContainer}>
              <Ionicons name="receipt-outline" size={46} color={COLORS.textTertiary} />
              <Text style={styles.emptyTitle}>
                {searchQuery ? '没有匹配的订单' : '暂无订单'}
              </Text>
              <Text style={styles.emptyText}>
                新建订单后，客户、交期和生产状态会显示在这里。
              </Text>
              <Button
                title="新建订单"
                iconLeft="add"
                onPress={() => navigation.navigate(ROUTES.CREATE_ORDER)}
                style={styles.createButton}
              />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
};

const IconButton = ({ icon, active = false, onPress }) => (
  <TouchableOpacity
    activeOpacity={0.82}
    style={[styles.headerButton, active && styles.headerButtonActive]}
    onPress={onPress}
  >
    <Ionicons name={icon} size={20} color={active ? COLORS.primary : COLORS.textSecondary} />
  </TouchableOpacity>
);

const FilterChip = ({ label, active, color = COLORS.primary, onPress }) => (
  <TouchableOpacity
    activeOpacity={0.82}
    onPress={onPress}
    style={[
      styles.filterChip,
      active && { backgroundColor: `${color}18`, borderColor: color },
    ]}
  >
    <Text style={[styles.filterChipText, active && { color }]} numberOfLines={1}>
      {label}
    </Text>
  </TouchableOpacity>
);

const OrderCard = ({ order, navigation, deletingId, onDelete }) => {
  const customerName = order.customer?.name || order.customerName || '未知客户';
  const orderItems = order.items || order.orderItems || [];
  const statusColor = ORDER_STATUS_COLORS[order.status] || COLORS.textSecondary;
  const statusLabel = ORDER_STATUS_LABELS[order.status] || '未知';

  return (
    <TouchableOpacity
      activeOpacity={0.84}
      onPress={() => navigation.navigate(ROUTES.ORDER_DETAIL, { orderId: order.id })}
    >
      <Card style={styles.orderCard} interactive>
        <View style={styles.orderHeader}>
          <View style={styles.customerInfo}>
            <Text style={styles.customerName} numberOfLines={1}>{customerName}</Text>
            <Text style={styles.orderId}>订单 #{order.id}</Text>
          </View>
          <View style={styles.headerRight}>
            <Badge text={statusLabel} color={statusColor} size="small" />
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={(event) => {
                event.stopPropagation?.();
                onDelete(order.id);
              }}
              disabled={deletingId === order.id}
            >
              {deletingId === order.id ? (
                <ActivityIndicator size="small" color={COLORS.danger} />
              ) : (
                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.metaGrid}>
          <MetaItem label="总价" value={`¥${order.total || 0}`} />
          <MetaItem label="交期" value={order.dueDate || order.due_date || '未设置'} />
          <MetaItem
            label="创建"
            value={order.createdAt || order.created_at || new Date().toLocaleDateString()}
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

const MetaItem = ({ label, value }) => (
  <View style={styles.metaItem}>
    <Text style={styles.metaLabel}>{label}</Text>
    <Text style={styles.metaValue} numberOfLines={1}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  titleGroup: {
    flex: 1,
  },
  eyebrow: {
    ...TYPOGRAPHY.caption,
    color: COLORS.primary,
    marginBottom: 2,
  },
  title: {
    ...TYPOGRAPHY.screenTitle,
    color: COLORS.text,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  headerButtonActive: {
    backgroundColor: COLORS.primarySoft,
    borderColor: COLORS.primarySoft,
  },
  searchContainer: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceElevated,
  },
  searchInput: {
    flex: 1,
    minHeight: 44,
    fontSize: 15,
    color: COLORS.text,
  },
  searchClear: {
    width: 28,
    height: 28,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceMuted,
  },
  filterBar: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xs,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
    alignItems: 'center',
  },
  filterChip: {
    height: 34,
    maxWidth: 108,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceElevated,
  },
  filterChipText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  filterScroll: {
    flexGrow: 0,
    maxHeight: 52,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
  },
  loadingText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
  },
  listContainer: {
    padding: SPACING.lg,
    paddingTop: 0,
    paddingBottom: SPACING.xxl,
  },
  emptyListContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  emptyTitle: {
    ...TYPOGRAPHY.sectionTitle,
    color: COLORS.text,
    marginTop: SPACING.md,
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
  createButton: {
    marginTop: SPACING.lg,
  },
  orderCard: {
    marginHorizontal: 0,
    marginBottom: SPACING.md,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: SPACING.md,
  },
  customerInfo: {
    flex: 1,
  },
  customerName: {
    ...TYPOGRAPHY.sectionTitle,
    color: COLORS.text,
  },
  orderId: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  deleteButton: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.dangerSoft,
  },
  metaGrid: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.lg,
  },
  metaItem: {
    flex: 1,
    minWidth: 0,
    padding: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
  },
  metaLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textTertiary,
  },
  metaValue: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
    marginTop: 2,
  },
  itemsPreview: {
    marginTop: SPACING.lg,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  itemsLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  itemText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
    marginTop: 2,
  },
  moreItems: {
    ...TYPOGRAPHY.caption,
    color: COLORS.primary,
    marginTop: SPACING.xs,
  },
});

export default OrdersScreen;
