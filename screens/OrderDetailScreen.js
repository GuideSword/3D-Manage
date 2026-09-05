import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  COLORS,
  ORDER_STATUS_COLORS,
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  RADIUS,
  SPACING,
  TYPOGRAPHY,
} from '../constants';
import { Badge, Button, Card } from '../components';
import { isAuthRequiredError, ordersAPI } from '../utils/api';
import { getRestoreTarget, isRestorable } from '../utils/orderStatus';

const OrderDetailScreen = ({ route, navigation }) => {
  const { orderId } = route.params;
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState(false);

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

  const handleStatusUpdate = (newStatus) => {
    const statusLabel = ORDER_STATUS_LABELS[newStatus];

    Alert.alert(
      '确认操作',
      `确定要将订单状态更新为“${statusLabel}”吗？`,
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

  const handleRestore = () => {
    if (!order) {
      return;
    }
    const target = getRestoreTarget(order.status);
    if (!target) {
      return;
    }
    const targetLabel = ORDER_STATUS_LABELS[target] || '草稿';
    Alert.alert(
      '恢复订单',
      `将该订单恢复为“${targetLabel}”状态后，需要重新走完整流程。\n\n确定要恢复吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '恢复',
          onPress: async () => {
            try {
              setUpdating(true);
              await ordersAPI.updateStatus(orderId, target);
              Alert.alert('成功', `订单已恢复为"${targetLabel}"`, [
                { text: '确定', onPress: () => fetchOrderDetail() },
              ]);
            } catch (error) {
              if (isAuthRequiredError(error)) {
                return;
              }
              Alert.alert('错误', '恢复订单失败');
            } finally {
              setUpdating(false);
            }
          },
        },
      ]
    );
  };

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
                { text: '确定', onPress: () => navigation.goBack() },
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
    return <CenteredState icon="receipt-outline" text="加载订单中..." loading />;
  }

  if (!order) {
    return (
      <CenteredState
        icon="document-text-outline"
        text="订单不存在"
        actionLabel="返回"
        onAction={() => navigation.goBack()}
      />
    );
  }

  const customerName = order.customer?.name || order.customerName || '未知客户';
  const orderItems = order.items || order.orderItems || [];
  const attachments = order.attachments || [];
  const total = Number(order.total || 0);
  const currency = order.currency || 'CNY';
  const statusColor = ORDER_STATUS_COLORS[order.status] || COLORS.textSecondary;
  const availableActions = getAvailableActions(order.status);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        )}
      >
        <View style={styles.identity}>
          <View style={styles.identityIcon}>
            <Ionicons name="receipt-outline" size={24} color={COLORS.primary} />
          </View>
          <View style={styles.identityText}>
            <Text style={styles.eyebrow}>订单 #{order.id}</Text>
            <Text style={styles.title} numberOfLines={1}>{customerName}</Text>
          </View>
          <Badge
            text={ORDER_STATUS_LABELS[order.status] || '未知'}
            color={statusColor}
            size="small"
          />
        </View>

        <Card style={styles.section}>
          <View style={styles.summaryGrid}>
            <SummaryTile label="订单总额" value={`${currency} ${total.toFixed(2)}`} highlight />
            <SummaryTile label="创建时间" value={order.createdAt || order.created_at || '未知'} />
            <SummaryTile label="交付日期" value={order.dueDate || order.due_date || '未设置'} />
          </View>
        </Card>

        <Card style={styles.section}>
          <SectionHeader title="订单项目" count={orderItems.length} />
          {orderItems.length > 0 ? orderItems.map((item, index) => {
            const quantity = item.quantity || item.qty || 0;
            const unitPrice = item.unitPrice || item.unit_price || 0;
            const itemTotal = quantity * unitPrice;
            return (
              <View key={item.id || index} style={styles.orderItem}>
                <View style={styles.orderItemLeft}>
                  <Text style={styles.orderItemName} numberOfLines={2}>
                    {item.modelName || item.model_name || '未知模型'}
                  </Text>
                  <Text style={styles.orderItemSpec} numberOfLines={1}>
                    {item.materialType || item.material_type || '未知材质'} · {item.color || '未知颜色'}
                  </Text>
                  <Text style={styles.orderItemSpec}>
                    数量 {quantity} · 单价 {currency} {Number(unitPrice).toFixed(2)}
                  </Text>
                </View>
                <Text style={styles.orderItemTotal}>
                  {currency} {Number(itemTotal).toFixed(2)}
                </Text>
              </View>
            );
          }) : (
            <EmptySection text="暂无订单项目" />
          )}
        </Card>

        {order.notes ? (
          <Card style={styles.section}>
            <SectionHeader title="备注" />
            <Text style={styles.notesText}>{order.notes}</Text>
          </Card>
        ) : null}

        {attachments.length > 0 ? (
          <Card style={styles.section}>
            <SectionHeader title="附件" count={attachments.length} />
            {attachments.map((attachment, index) => (
              <View key={attachment.fileKey || index} style={styles.attachmentItem}>
                <View style={styles.attachmentIcon}>
                  <Ionicons name="attach-outline" size={18} color={COLORS.primary} />
                </View>
                <View style={styles.attachmentTextGroup}>
                  <Text style={styles.attachmentName} numberOfLines={1}>
                    {attachment.originalName || attachment.fileKey}
                  </Text>
                  {attachment.size ? (
                    <Text style={styles.attachmentMeta}>{Math.round(attachment.size / 1024)} KB</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </Card>
        ) : null}

        {isRestorable(order.status) ? (
          <Card style={styles.section}>
            <SectionHeader title="回收站操作" />
            <View style={styles.restoreNotice}>
              <Ionicons name="trash-outline" size={18} color={COLORS.textSecondary} />
              <Text style={styles.restoreNoticeText}>
                该订单当前处于已取消状态（类似回收站）。可以恢复为草稿重新走流程，或在下方彻底删除。
              </Text>
            </View>
            <Button
              title={`恢复为${ORDER_STATUS_LABELS[getRestoreTarget(order.status)] || '草稿'}`}
              iconLeft="refresh-outline"
              onPress={handleRestore}
              variant="primary"
              disabled={updating}
              loading={updating}
              fullWidth
            />
          </Card>
        ) : null}

        {availableActions.length > 0 ? (
          <Card style={styles.section}>
            <SectionHeader title="状态操作" />
            <View style={styles.actionStack}>
              {availableActions.map((action) => (
                <Button
                  key={action.status}
                  title={action.label}
                  iconLeft={action.icon}
                  onPress={() => handleStatusUpdate(action.status)}
                  variant={action.variant}
                  disabled={updating}
                  loading={updating}
                  fullWidth
                />
              ))}
            </View>
          </Card>
        ) : null}

        <Card style={styles.dangerSection}>
          <SectionHeader title="危险操作" />
          <Button
            title="删除订单"
            iconLeft="trash-outline"
            onPress={handleDelete}
            variant="danger"
            fullWidth
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const getAvailableActions = (currentStatus) => {
  const actions = [];
  if (currentStatus === ORDER_STATUSES.DRAFT) {
    actions.push({
      label: '提交审核',
      status: ORDER_STATUSES.PENDING_REVIEW,
      variant: 'warning',
      icon: 'send-outline',
    });
  }
  if (currentStatus === ORDER_STATUSES.PENDING_REVIEW) {
    actions.push({
      label: '开始执行',
      status: ORDER_STATUSES.IN_PROGRESS,
      variant: 'primary',
      icon: 'play-outline',
    });
  }
  if (currentStatus === ORDER_STATUSES.IN_PROGRESS) {
    actions.push({
      label: '标记完成',
      status: ORDER_STATUSES.COMPLETED,
      variant: 'success',
      icon: 'checkmark-outline',
    });
  }
  if (currentStatus !== ORDER_STATUSES.COMPLETED && currentStatus !== ORDER_STATUSES.CANCELLED) {
    actions.push({
      label: '取消订单',
      status: ORDER_STATUSES.CANCELLED,
      variant: 'danger',
      icon: 'close-outline',
    });
  }
  return actions;
};

const CenteredState = ({ icon, text, loading = false, actionLabel, onAction }) => (
  <SafeAreaView style={styles.container}>
    <View style={styles.centeredState}>
      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} />
      ) : (
        <Ionicons name={icon} size={54} color={COLORS.textTertiary} />
      )}
      <Text style={styles.centeredText}>{text}</Text>
      {actionLabel ? (
        <Button title={actionLabel} onPress={onAction} style={styles.centeredButton} />
      ) : null}
    </View>
  </SafeAreaView>
);

const SectionHeader = ({ title, count }) => (
  <View style={styles.sectionHeader}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {typeof count === 'number' ? (
      <Text style={styles.sectionCount}>{count}</Text>
    ) : null}
  </View>
);

const SummaryTile = ({ label, value, highlight = false }) => (
  <View style={[styles.summaryTile, highlight && styles.summaryTileHighlight]}>
    <Text style={styles.summaryLabel}>{label}</Text>
    <Text style={[styles.summaryValue, highlight && styles.summaryValueHighlight]} numberOfLines={1}>
      {value}
    </Text>
  </View>
);

const EmptySection = ({ text }) => (
  <View style={styles.emptySection}>
    <Text style={styles.emptySectionText}>{text}</Text>
  </View>
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
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  centeredText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },
  centeredButton: {
    marginTop: SPACING.lg,
    minWidth: 160,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  identityIcon: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
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
  section: {
    marginHorizontal: 0,
    marginBottom: SPACING.md,
  },
  dangerSection: {
    marginHorizontal: 0,
    marginBottom: SPACING.md,
    borderColor: COLORS.dangerSoft,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    ...TYPOGRAPHY.sectionTitle,
    color: COLORS.text,
  },
  sectionCount: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  summaryGrid: {
    gap: SPACING.sm,
  },
  summaryTile: {
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
  },
  summaryTileHighlight: {
    backgroundColor: COLORS.primarySoft,
  },
  summaryLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textTertiary,
  },
  summaryValue: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
    marginTop: 2,
  },
  summaryValueHighlight: {
    color: COLORS.primaryDark,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  orderItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  orderItemLeft: {
    flex: 1,
    minWidth: 0,
  },
  orderItemName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  orderItemSpec: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 3,
  },
  orderItemTotal: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
  },
  notesText: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
  },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  attachmentIcon: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
  },
  attachmentTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  attachmentName: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
  },
  attachmentMeta: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  actionStack: {
    gap: SPACING.sm,
  },
  restoreNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
    marginBottom: SPACING.md,
  },
  restoreNoticeText: {
    flex: 1,
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  emptySection: {
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
  },
  emptySectionText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
  },
});

export default OrderDetailScreen;
