import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, ORDER_STATUSES, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS, ROUTES } from '../constants';
import { Card, Button, Badge } from '../components';
import { ordersAPI, isAuthRequiredError } from '../utils/api';

const OrderDetailScreen = ({ route, navigation }) => {
  const { orderId } = route.params;
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState(false);

  // 获取订单详情
  const fetchOrderDetail = async () => {
    try {
      setLoading(true);
      const data = await ordersAPI.getById(orderId);
      setOrder(data);
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      console.error('获取订单详情失败:', error);
      Alert.alert('错误', '获取订单详情失败，请检查网络连接');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // 更新订单状态
  const handleStatusUpdate = (newStatus) => {
    const currentStatus = order.status;
    const statusLabel = ORDER_STATUS_LABELS[newStatus];

    Alert.alert(
      '确认操作',
      `确定要将订单状态更新为"${statusLabel}"吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认',
          onPress: async () => {
            try {
              setUpdating(true);
              await ordersAPI.updateStatus(orderId, newStatus);
              Alert.alert('成功', '订单状态已更新');
              await fetchOrderDetail();
            } catch (error) {
              if (isAuthRequiredError(error)) {
                return;
              }
              Alert.alert('错误', '更新订单状态失败');
            } finally {
              setUpdating(false);
            }
          },
        },
      ]
    );
  };

  // 删除订单
  const handleDelete = () => {
    Alert.alert(
      '确认删除',
      '确定要删除这个订单吗？此操作不可恢复。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              await ordersAPI.delete(orderId);
              Alert.alert('成功', '订单已删除', [
                {
                  text: '确定',
                  onPress: () => navigation.goBack(),
                },
              ]);
            } catch (error) {
              if (isAuthRequiredError(error)) {
                return;
              }
              Alert.alert('错误', '删除订单失败');
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
    fetchOrderDetail();
  }, [orderId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchOrderDetail();
  };

  if (loading && !order) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContainer}>
          <Ionicons name="document-text-outline" size={64} color={COLORS.textSecondary} />
          <Text style={styles.emptyText}>订单不存在</Text>
          <Button title="返回" onPress={() => navigation.goBack()} style={styles.backButton} />
        </View>
      </SafeAreaView>
    );
  }

  const customerName = order.customer?.name || order.customerName || '未知客户';
  const orderItems = order.items || order.orderItems || [];
  const attachments = order.attachments || [];
  const total = order.total || 0;
  const currency = order.currency || 'CNY';

  // 根据当前状态获取可执行的操作
  const getAvailableActions = () => {
    const actions = [];
    const currentStatus = order.status;

    if (currentStatus === ORDER_STATUSES.DRAFT) {
      actions.push({ label: '提交审核', status: ORDER_STATUSES.PENDING_REVIEW, color: COLORS.warning });
    }
    if (currentStatus === ORDER_STATUSES.PENDING_REVIEW) {
      actions.push({ label: '开始执行', status: ORDER_STATUSES.IN_PROGRESS, color: COLORS.primary });
    }
    // 执行中的订单可以标记为完成
    if (currentStatus === ORDER_STATUSES.IN_PROGRESS) {
      actions.push({ label: '标记完成', status: ORDER_STATUSES.COMPLETED, color: COLORS.success });
    }
    // 非终态订单可以取消
    if (currentStatus !== ORDER_STATUSES.COMPLETED && currentStatus !== ORDER_STATUSES.CANCELLED) {
      actions.push({ label: '取消订单', status: ORDER_STATUSES.CANCELLED, color: COLORS.danger });
    }

    return actions;
  };

  const availableActions = getAvailableActions();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
      >
        {/* 订单基本信息 */}
        <Card style={styles.section}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.orderId}>订单 #{order.id}</Text>
              <Text style={styles.customerName}>{customerName}</Text>
            </View>
            <Badge
              text={ORDER_STATUS_LABELS[order.status] || '未知'}
              color={ORDER_STATUS_COLORS[order.status] || COLORS.textSecondary}
            />
          </View>

          <View style={styles.infoRow}>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>创建时间</Text>
              <Text style={styles.infoValue}>{order.createdAt || '未知'}</Text>
            </View>
            {order.dueDate && (
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>截止日期</Text>
                <Text style={styles.infoValue}>{order.dueDate}</Text>
              </View>
            )}
          </View>

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>订单总额</Text>
            <Text style={styles.totalAmount}>
              {currency} {total.toFixed(2)}
            </Text>
          </View>
        </Card>

        {/* 订单项 */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>订单项目</Text>
          {orderItems.length > 0 ? (
            orderItems.map((item, index) => (
              <View key={item.id || index} style={styles.orderItem}>
                <View style={styles.orderItemLeft}>
                  <Text style={styles.orderItemName}>
                    {item.modelName || item.model_name || '未知模型'} - {item.materialType || item.material_type || '未知材质'} - {item.color || '未知颜色'}
                  </Text>
                  <Text style={styles.orderItemSpec}>
                    数量: {item.quantity || item.qty || 0} × {currency} {(item.unitPrice || item.unit_price || 0).toFixed(2)}
                  </Text>
                </View>
                <Text style={styles.orderItemTotal}>
                  {currency} {((item.quantity || item.qty || 0) * (item.unitPrice || item.unit_price || 0)).toFixed(2)}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>暂无订单项</Text>
          )}
        </Card>

        {/* 备注信息 */}
        {order.notes && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>备注</Text>
            <Text style={styles.notesText}>{order.notes}</Text>
          </Card>
        )}

        {attachments.length > 0 && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>附件</Text>
            {attachments.map((attachment, index) => (
              <View key={attachment.fileKey || index} style={styles.attachmentItem}>
                <Ionicons name="attach-outline" size={18} color={COLORS.primary} />
                <View style={styles.attachmentTextGroup}>
                  <Text style={styles.attachmentName}>{attachment.originalName || attachment.fileKey}</Text>
                  {attachment.size ? (
                    <Text style={styles.attachmentMeta}>{Math.round(attachment.size / 1024)} KB</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </Card>
        )}

        {/* 操作按钮 */}
        {availableActions.length > 0 && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>操作</Text>
            {availableActions.map((action, index) => (
              <Button
                key={index}
                title={action.label}
                onPress={() => handleStatusUpdate(action.status)}
                variant={action.color === COLORS.danger ? 'danger' : 'primary'}
                style={styles.actionButton}
                disabled={updating}
                loading={updating}
              />
            ))}
          </Card>
        )}

        {/* 删除按钮 */}
        <Card style={styles.section}>
          <Button
            title="删除订单"
            onPress={handleDelete}
            variant="danger"
            style={styles.deleteButton}
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  backButton: {
    marginTop: 24,
    width: 200,
  },
  section: {
    margin: 16,
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  orderId: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  customerName: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  infoItem: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '500',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  totalAmount: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  orderItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  orderItemLeft: {
    flex: 1,
  },
  orderItemName: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 4,
  },
  orderItemSpec: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  orderItemTotal: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  notesText: {
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 24,
  },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  attachmentTextGroup: {
    flex: 1,
    marginLeft: 8,
  },
  attachmentName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  attachmentMeta: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  actionButton: {
    marginTop: 12,
  },
  deleteButton: {
    marginTop: 0,
  },
});

export default OrderDetailScreen;
