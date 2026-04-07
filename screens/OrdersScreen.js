import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  RefreshControl,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, ORDER_STATUSES, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS, ROUTES } from '../constants';
import { Card, Button, Badge } from '../components';
import { ordersAPI } from '../utils/api';

const OrdersScreen = ({ navigation }) => {
  const [orders, setOrders] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // 从API获取订单列表
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
      // 假设API返回格式为 { items: [...], total: 100 }
      setOrders(response.items || response || []);
    } catch (error) {
      console.error('获取订单失败:', error);
      Alert.alert('错误', '获取订单列表失败，请检查网络连接');
      // 失败时使用空数组，避免显示旧数据
      setOrders([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // 删除订单
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
              // 重新获取订单列表
              await fetchOrders();
            } catch (error) {
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

  const OrderCard = ({ order }) => {
    const customerName = order.customer?.name || order.customerName || '未知客户';
    const orderItems = order.items || order.orderItems || [];
    
    return (
      <Card style={styles.orderCard}>
        <TouchableOpacity
          onPress={() => {
            navigation.navigate(ROUTES.ORDER_DETAIL, { orderId: order.id });
          }}
          activeOpacity={0.7}
        >
          <View style={styles.orderHeader}>
            <View style={styles.customerInfo}>
              <Text style={styles.customerName}>{customerName}</Text>
              <Text style={styles.orderId}>订单 #{order.id}</Text>
            </View>
            <View style={styles.headerRight}>
              <Badge
                text={ORDER_STATUS_LABELS[order.status] || '未知'}
                color={ORDER_STATUS_COLORS[order.status] || COLORS.textSecondary}
              />
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={(e) => {
                  e.stopPropagation();
                  handleDelete(order.id);
                }}
                disabled={deletingId === order.id}
              >
                {deletingId === order.id ? (
                  <ActivityIndicator size="small" color={COLORS.danger} />
                ) : (
                  <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                )}
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.orderDetails}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>总价:</Text>
              <Text style={styles.detailValue}>¥{order.total || 0}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>交期:</Text>
              <Text style={styles.detailValue}>{order.dueDate || order.due_date || '未设置'}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>创建时间:</Text>
              <Text style={styles.detailValue}>
                {order.createdAt || order.created_at || new Date().toLocaleDateString()}
              </Text>
            </View>
          </View>

          {orderItems.length > 0 && (
            <View style={styles.itemsPreview}>
              <Text style={styles.itemsLabel}>订单项目:</Text>
              {orderItems.slice(0, 2).map((item, index) => {
                // 构建订单项目显示文本：模型名称 + 材质类型 + 颜色 + 数量
                const modelName = item.modelName || item.model_name || '';
                const materialType = item.materialType || item.material_type || '';
                const color = item.color || '';
                const quantity = item.quantity || item.qty || 0;
                
                // 组合显示文本，如果模型名称为空则不显示
                const itemParts = [];
                if (modelName) itemParts.push(modelName);
                if (materialType) itemParts.push(materialType);
                if (color) itemParts.push(color);
                const itemText = itemParts.length > 0 
                  ? `${itemParts.join(' ')} x${quantity}`
                  : `${materialType || '未知'} ${color || ''} x${quantity}`.trim();
                
                return (
                  <Text key={index} style={styles.itemText}>
                    {itemText}
                  </Text>
                );
              })}
              {orderItems.length > 2 && (
                <Text style={styles.moreItems}>...还有{orderItems.length - 2}个项目</Text>
              )}
            </View>
          )}
        </TouchableOpacity>
      </Card>
    );
  };

  const StatusFilter = () => (
    <View style={styles.filterContainer}>
      <TouchableOpacity
        style={[styles.filterButton, filterStatus === 'all' && styles.activeFilter]}
        onPress={() => setFilterStatus('all')}
      >
        <Text style={[styles.filterText, filterStatus === 'all' && styles.activeFilterText]}>
          全部
        </Text>
      </TouchableOpacity>
      {Object.entries(ORDER_STATUS_LABELS)
        .filter(([status]) => 
          status !== ORDER_STATUSES.DRAFT && 
          status !== ORDER_STATUSES.PENDING_REVIEW
        )
        .map(([status, label]) => (
          <TouchableOpacity
            key={status}
            style={[styles.filterButton, filterStatus === status && styles.activeFilter]}
            onPress={() => setFilterStatus(status)}
          >
            <Text style={[styles.filterText, filterStatus === status && styles.activeFilterText]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>订单管理</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setShowSearch(!showSearch)}
          >
            <Ionicons name="search" size={24} color={showSearch ? COLORS.primary : COLORS.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setShowFilter(!showFilter)}
          >
            <Ionicons name="filter" size={24} color={showFilter ? COLORS.primary : COLORS.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => {
              navigation.navigate('CreateOrder');
            }}
          >
            <Ionicons name="add-circle" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* 搜索框 */}
      {showSearch && (
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="搜索订单（客户名称、订单号）"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={24} color={COLORS.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {/* 筛选Modal */}
      <Modal
        visible={showFilter}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFilter(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>筛选订单</Text>
              <TouchableOpacity onPress={() => setShowFilter(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.filterOptions}>
              <TouchableOpacity
                style={[styles.filterOption, filterStatus === 'all' && styles.filterOptionActive]}
                onPress={() => {
                  setFilterStatus('all');
                  setShowFilter(false);
                }}
              >
                <Text style={[styles.filterOptionText, filterStatus === 'all' && styles.filterOptionTextActive]}>
                  全部
                </Text>
              </TouchableOpacity>
              {Object.entries(ORDER_STATUS_LABELS)
                .filter(([status]) => 
                  status !== ORDER_STATUSES.DRAFT && 
                  status !== ORDER_STATUSES.PENDING_REVIEW
                )
                .map(([status, label]) => (
                  <TouchableOpacity
                    key={status}
                    style={[styles.filterOption, filterStatus === status && styles.filterOptionActive]}
                    onPress={() => {
                      setFilterStatus(status);
                      setShowFilter(false);
                    }}
                  >
                    <Text style={[styles.filterOptionText, filterStatus === status && styles.filterOptionTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
            </View>
          </View>
        </View>
      </Modal>

      <StatusFilter />

      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <OrderCard order={item} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
              tintColor={COLORS.primary}
            />
          }
          contentContainerStyle={[
            styles.listContainer,
            orders.length === 0 && styles.emptyListContainer,
          ]}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="document-text-outline" size={64} color={COLORS.textSecondary} />
              <Text style={styles.emptyText}>
                {searchQuery ? '未找到匹配的订单' : '暂无订单'}
              </Text>
              {!searchQuery && (
                <Button
                  title="创建第一个订单"
                  onPress={() => {
                    navigation.navigate('CreateOrder');
                  }}
                  style={styles.createButton}
                />
              )}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.light,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 12,
  },
  headerButton: {
    padding: 4,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  filterButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    borderRadius: 16,
    backgroundColor: COLORS.light,
  },
  activeFilter: {
    backgroundColor: COLORS.primary,
  },
  filterText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  activeFilterText: {
    color: COLORS.background,
    fontWeight: '500',
  },
  listContainer: {
    padding: 16,
  },
  orderCard: {
    marginBottom: 12,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  customerInfo: {
    flex: 1,
  },
  customerName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  orderId: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  orderDetails: {
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  detailLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  itemsPreview: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 8,
  },
  itemsLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 4,
  },
  itemText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  moreItems: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 64,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 16,
    marginBottom: 24,
  },
  createButton: {
    minWidth: 200,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    backgroundColor: COLORS.surface,
    marginRight: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  filterOptions: {
    gap: 12,
  },
  filterOption: {
    padding: 16,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterOptionActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterOptionText: {
    fontSize: 16,
    color: COLORS.text,
  },
  filterOptionTextActive: {
    color: COLORS.background,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 64,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  emptyListContainer: {
    flexGrow: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deleteButton: {
    padding: 4,
  },
});

export default OrdersScreen;

