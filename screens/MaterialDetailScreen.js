import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  COLORS,
  RADIUS,
  ROUTES,
  SPACING,
  STOCK_STATUS_LABELS,
  STOCK_STATUSES,
  TYPOGRAPHY,
} from '../constants';
import { Badge, Button, Card } from '../components';
import { isAuthRequiredError, materialsAPI, stockAPI } from '../utils/api';

const MaterialDetailScreen = ({ route, navigation }) => {
  const { materialId } = route.params || {};
  const [material, setMaterial] = useState(null);
  const [stockLots, setStockLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchMaterialDetail = async () => {
    if (!materialId) {
      Alert.alert('错误', '耗材 ID 不存在');
      navigation.goBack();
      return;
    }

    try {
      setLoading(true);
      let materialData = null;
      try {
        materialData = await materialsAPI.getById(materialId);
        if (materialData && materialData.error) {
          materialData = null;
        }
      } catch (err) {
        if (isAuthRequiredError(err)) {
          throw err;
        }
        console.error('获取耗材详情失败:', err);
        if (err.status === 404 || err.message?.includes('Route not found') || err.message?.includes('404')) {
          try {
            const allMaterials = await materialsAPI.getAll();
            materialData = allMaterials.find(
              (item) => item.id === materialId || String(item.id) === String(materialId)
            );
          } catch (listErr) {
            if (isAuthRequiredError(listErr)) {
              throw listErr;
            }
            console.error('从列表获取耗材失败:', listErr);
            materialData = null;
          }
        }
      }

      let lotsData = [];
      try {
        lotsData = await stockAPI.getLots({ materialId }) || [];
      } catch (err) {
        if (isAuthRequiredError(err)) {
          throw err;
        }
        console.error('获取库存批次失败:', err);
        lotsData = [];
      }

      if (materialData) {
        setMaterial(materialData);
        setStockLots(lotsData);
      } else {
        Alert.alert('错误', '耗材不存在', [
          { text: '确定', onPress: () => navigation.goBack() },
        ]);
      }
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      console.error('获取耗材详情失败:', error);
      Alert.alert('错误', '获取耗材详情失败，请检查网络连接', [
        { text: '确定', onPress: () => navigation.goBack() },
      ]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      '确认删除',
      '确定要删除这个耗材吗？此操作不可恢复。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeleting(true);
              await materialsAPI.delete(materialId);
              Alert.alert('成功', '耗材已删除', [
                { text: '确定', onPress: () => navigation.goBack() },
              ]);
            } catch (error) {
              if (isAuthRequiredError(error)) {
                return;
              }
              Alert.alert('错误', '删除耗材失败');
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
    fetchMaterialDetail();
  }, [materialId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMaterialDetail();
  };

  if (loading && !material) {
    return <CenteredState icon="layers-outline" text="加载耗材中..." loading />;
  }

  if (!material) {
    return (
      <CenteredState
        icon="layers-outline"
        text="耗材不存在"
        actionLabel="返回"
        onAction={() => navigation.goBack()}
      />
    );
  }

  const totalStock = stockLots.reduce((sum, lot) => sum + (lot.qty || 0), 0);
  const materialType = material.type || material.materialType || '未知材质';

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
            <Ionicons name="layers-outline" size={24} color={COLORS.accent} />
          </View>
          <View style={styles.identityText}>
            <Text style={styles.eyebrow}>MATERIAL</Text>
            <Text style={styles.title} numberOfLines={1}>{materialType}</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{material.brand || '未设置品牌'}</Text>
          </View>
        </View>

        <Card style={styles.section}>
          <SectionHeader title="耗材规格" />
          <View style={styles.detailGrid}>
            <DetailTile label="颜色" value={material.color || '未设置'} />
            <DetailTile label="直径" value={material.diameter ? `${material.diameter} mm` : '未设置'} />
            <DetailTile label="密度" value={material.density ? `${material.density} g/cm³` : '未设置'} />
            <DetailTile
              label="单价"
              value={(material.unitPrice || material.unit_price)
                ? `${material.unitPrice || material.unit_price} CNY/${material.unit || 'kg'}`
                : '未设置'}
            />
          </View>
          {material.notes ? (
            <View style={styles.notesBox}>
              <Text style={styles.notesLabel}>备注</Text>
              <Text style={styles.notesText}>{material.notes}</Text>
            </View>
          ) : null}
        </Card>

        <Card style={styles.section}>
          <SectionHeader title="库存概览" />
          <View style={styles.summaryGrid}>
            <SummaryTile label="总库存" value={`${totalStock}g`} icon="scale-outline" highlight />
            <SummaryTile label="批次数量" value={`${stockLots.length} 个`} icon="archive-outline" />
          </View>
        </Card>

        <Card style={styles.section}>
          <SectionHeader title="库存操作" />
          <View style={styles.actionGrid}>
            <TransactionAction
              label="入库"
              icon="enter-outline"
              color={COLORS.success}
              onPress={() => navigation.navigate(ROUTES.INBOUND_TRANSACTION)}
            />
            <TransactionAction
              label="出库"
              icon="exit-outline"
              color={COLORS.warning}
              onPress={() => navigation.navigate(ROUTES.OUTBOUND_TRANSACTION)}
            />
            <TransactionAction
              label="盘点"
              icon="swap-horizontal-outline"
              color={COLORS.primary}
              onPress={() => navigation.navigate(ROUTES.ADJUST_TRANSACTION)}
            />
          </View>
        </Card>

        <Card style={styles.section}>
          <SectionHeader title="库存批次" count={stockLots.length} />
          {stockLots.length > 0 ? stockLots.map((lot) => (
            <LotRow key={lot.id} lot={lot} />
          )) : (
            <EmptySection text="暂无库存批次" />
          )}
        </Card>

        <Card style={styles.dangerSection}>
          <SectionHeader title="危险操作" />
          <Button
            title="删除耗材"
            iconLeft="trash-outline"
            onPress={handleDelete}
            variant="danger"
            disabled={deleting}
            loading={deleting}
            fullWidth
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
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
    {typeof count === 'number' ? <Text style={styles.sectionCount}>{count}</Text> : null}
  </View>
);

const DetailTile = ({ label, value }) => (
  <View style={styles.detailTile}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue} numberOfLines={1}>{value}</Text>
  </View>
);

const SummaryTile = ({ label, value, icon, highlight = false }) => (
  <View style={[styles.summaryTile, highlight && styles.summaryTileHighlight]}>
    <Ionicons name={icon} size={18} color={highlight ? COLORS.primaryDark : COLORS.primary} />
    <Text style={styles.summaryLabel}>{label}</Text>
    <Text style={[styles.summaryValue, highlight && styles.summaryValueHighlight]}>
      {value}
    </Text>
  </View>
);

const TransactionAction = ({ label, icon, color, onPress }) => (
  <TouchableOpacity activeOpacity={0.82} style={styles.transactionAction} onPress={onPress}>
    <View style={[styles.transactionIcon, { backgroundColor: `${color}18` }]}>
      <Ionicons name={icon} size={20} color={color} />
    </View>
    <Text style={styles.transactionLabel}>{label}</Text>
  </TouchableOpacity>
);

const LotRow = ({ lot }) => {
  const state = lot.state || lot.status;
  const color = state === STOCK_STATUSES.IN_STOCK
    ? COLORS.success
    : state === STOCK_STATUSES.SCRAPPED
      ? COLORS.danger
      : COLORS.warning;

  return (
    <View style={styles.lotRow}>
      <View style={styles.lotMain}>
        <Text style={styles.lotNo} numberOfLines={1}>{lot.lotNo || lot.lot_no || '未知批次'}</Text>
        <Text style={styles.lotMeta} numberOfLines={1}>
          {lot.serialNo || lot.serial_no || '未设置序列号'}
        </Text>
      </View>
      <View style={styles.lotRight}>
        <Badge text={STOCK_STATUS_LABELS[state] || '未知'} color={color} size="small" />
        <Text style={styles.lotQty}>{lot.qty || 0}g</Text>
      </View>
      {lot.notes ? <Text style={styles.lotNotes}>{lot.notes}</Text> : null}
    </View>
  );
};

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
    backgroundColor: COLORS.accentSoft,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    ...TYPOGRAPHY.caption,
    color: COLORS.accent,
    marginBottom: 2,
  },
  title: {
    ...TYPOGRAPHY.screenTitle,
    color: COLORS.text,
  },
  subtitle: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
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
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  detailTile: {
    width: '48%',
    minWidth: 0,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
  },
  detailLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textTertiary,
  },
  detailValue: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
    marginTop: 2,
  },
  notesBox: {
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  notesLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  notesText: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  summaryTile: {
    flex: 1,
    minWidth: 0,
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
    marginTop: SPACING.xs,
  },
  summaryValue: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
    marginTop: 2,
  },
  summaryValueHighlight: {
    color: COLORS.primaryDark,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
  },
  actionGrid: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  transactionAction: {
    flex: 1,
    minHeight: 82,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
  },
  transactionIcon: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  transactionLabel: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
  },
  lotRow: {
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  lotMain: {
    marginRight: SPACING.md,
  },
  lotNo: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
  },
  lotMeta: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  lotRight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  lotQty: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
  },
  lotNotes: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
  },
  emptySection: {
    minHeight: 76,
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

export default MaterialDetailScreen;
