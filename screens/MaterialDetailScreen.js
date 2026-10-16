import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Platform,
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
  RADIUS,
  ROUTES,
  SPACING,
  STOCK_STATUS_LABELS,
  STOCK_STATUSES,
  TYPOGRAPHY,
} from '../constants';
import { Badge, Button, Card } from '../components';
import { useAppTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useServerConfig } from '../context/ServerConfigContext';
import { useMasterDataMutation } from '../utils/useMasterDataMutation';
import masterDataCore from '../utils/masterDataCore.cjs';
import { relationalModelsAPI, relationalMaterialsAPI } from '../utils/relationalCatalogApi';
import CatalogMutationFeedback from '../components/CatalogMutationFeedback';
import { confirmDeletion } from '../utils/confirmAction';
import { relationalInventoryAPI } from '../utils/relationalInventoryApi';
import { useRelationalPage } from '../utils/useRelationalPage';
import { useInventorySummary } from '../utils/useInventorySummary';
import { useEditRecord } from '../utils/useEditRecord';
import EditLoadState from '../components/EditLoadState';
import PaginationControls from '../components/PaginationControls';
import { canManage, canWrite } from '../utils/permissions';
import { isAuthRequiredError, materialsAPI, stockAPI } from '../utils/api';

const MaterialDetailScreen = ({ route, navigation }) => {
  const { user } = useAuth();
  const { server } = useServerConfig();
  const relational = masterDataCore.supportsMasterData(server);
  const catalogMutation = useMasterDataMutation(navigation);
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const { materialId } = route.params || {};
  const [legacyMaterial, setMaterial] = useState(null);
  const [legacyStockLots, setStockLots] = useState([]);
  const [legacyLoading, setLoading] = useState(true);
  const [legacyRefreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const lotsPage = useRelationalPage(relationalInventoryAPI.getLotsPage, { materialId }, relational && Boolean(materialId));
  const summaryRead = useInventorySummary({ materialId }, relational && Boolean(materialId));
  const materialRead = useEditRecord(relational ? materialId : null, relationalMaterialsAPI, () => catalogMutation.resetAfterLoad());
  const material = relational ? materialRead.record : legacyMaterial;
  const stockLots = relational ? lotsPage.items : legacyStockLots;
  const loading = relational ? materialRead.loadingRecord : legacyLoading;
  const refreshing = relational ? lotsPage.loading || summaryRead.loading : legacyRefreshing;
  const summary = summaryRead.rows?.[0] ?? null;


  const fetchMaterialDetail = async () => {
    if (relational) {
      if (!catalogMutation.pending) materialRead.reload();
      await Promise.all([lotsPage.refresh(), summaryRead.refresh()]); return;
    }
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
        catalogMutation.resetAfterLoad();
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

  const handleDelete = async () => {
    if (deleting || !material || !await confirmDeletion('确定要删除这个耗材吗？此操作不可恢复。')) return;
    try {
      setDeleting(true);
      if (relational) {
        const result = await catalogMutation.run('material.delete', { id: material.id, version: material.version },
          (body, key) => relationalMaterialsAPI.delete(body.id, body.version, key));
        if (result === null) return;
      } else await materialsAPI.delete(materialId);
      if (Platform.OS === 'web') navigation.goBack();
      else Alert.alert('成功', '耗材已删除', [{ text: '确定', onPress: () => navigation.goBack() }]);
    } catch (error) {
      if (!isAuthRequiredError(error)) Alert.alert('错误', error.message || '删除耗材失败');
    } finally { setDeleting(false); }
  };

  useFocusEffect(useCallback(() => {
    fetchMaterialDetail();
  }, [materialId]));

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMaterialDetail();
  };

  if (relational && !material) return <EditLoadState loading={loading} error={materialRead.loadError} onRetry={fetchMaterialDetail} onCancel={() => navigation.goBack()} />;

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

  const totalStock = relational ? summary?.totalQty ?? null : stockLots.reduce((sum, lot) => sum + (lot.qty || 0), 0);
  const materialType = material.type || material.materialType || '未知材质';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
        )}
      >
        <CatalogMutationFeedback mutation={catalogMutation} onReload={fetchMaterialDetail} onSuccess={() => navigation.goBack()} />
        <View style={styles.identity}>
          <View style={styles.identityIcon}>
            <Ionicons name="layers-outline" size={24} color={colors.accent} />
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
          {relational && summaryRead.error ? <><Text style={{ color: colors.danger }}>{summaryRead.error}</Text><Button title="重试库存汇总" onPress={summaryRead.refresh} variant="outline" /></> : null}
          {relational && summary?.balanceIncomplete ? <Text style={{ color: colors.warning }}>部分历史余额待核对，当前合计不包含无效余额。</Text> : relational && summary?.legacyUnverified ? <Text style={{ color: colors.warning }}>存在未核对的历史批次余额。</Text> : null}
          <View style={styles.summaryGrid}>
            <SummaryTile label="总库存" value={totalStock == null ? '暂不可用' : `${totalStock}g`} icon="scale-outline" highlight />
            <SummaryTile label="批次数量" value={relational ? summary ? `${summary.lotCount} 个` : '暂不可用' : `${stockLots.length} 个`} icon="archive-outline" />
          </View>
        </Card>

        {canWrite(user) ? <Card style={styles.section}>
          <SectionHeader title="库存操作" />
          <View style={styles.actionGrid}>
            <TransactionAction
              label="入库"
              icon="enter-outline"
              color={colors.success}
              onPress={() => navigation.navigate(ROUTES.INBOUND_TRANSACTION)}
            />
            <TransactionAction
              label="出库"
              icon="exit-outline"
              color={colors.warning}
              onPress={() => navigation.navigate(ROUTES.OUTBOUND_TRANSACTION)}
            />
            {canManage(user) ? <TransactionAction
              label="盘点"
              icon="swap-horizontal-outline"
              color={colors.primary}
              onPress={() => navigation.navigate(ROUTES.ADJUST_TRANSACTION)}
            /> : null}
          </View>
        </Card> : null}

        <Card style={styles.section}>
          <SectionHeader title="库存批次" count={relational ? lotsPage.total ?? '—' : stockLots.length} />
          {stockLots.length > 0 ? stockLots.map((lot) => (
            <View key={lot.id}>
              <LotRow lot={lot} relational={relational} />
              {canWrite(user) ? <Button title="编辑批次" variant="outline" size="small"
                iconLeft="create-outline" onPress={() => navigation.navigate(ROUTES.EDIT_STOCK_LOT, { lotId: lot.id })} /> : null}
            </View>
          )) : relational && (lotsPage.error || lotsPage.initializing) ? null : (
            <EmptySection text="暂无库存批次" />
          )}
          {relational ? <PaginationControls page={lotsPage} /> : null}
        </Card>

        {canWrite(user) ? <Card style={styles.section}>
          <Button title="编辑耗材" iconLeft="create-outline" fullWidth
            onPress={() => navigation.navigate(ROUTES.CREATE_MATERIAL, { materialId })} />
        </Card> : null}

        {canWrite(user) ? <Card style={styles.dangerSection}>
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
        </Card> : null}
      </ScrollView>
    </SafeAreaView>
  );
};

const CenteredState = ({ icon, text, loading = false, actionLabel, onAction }) => {
  const { colors, styles } = useDetailTheme();
  return (
  <SafeAreaView style={styles.container}>
    <View style={styles.centeredState}>
      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : (
        <Ionicons name={icon} size={54} color={colors.textTertiary} />
      )}
      <Text style={styles.centeredText}>{text}</Text>
      {actionLabel ? (
        <Button title={actionLabel} onPress={onAction} style={styles.centeredButton} />
      ) : null}
    </View>
  </SafeAreaView>
  );
};

const SectionHeader = ({ title, count }) => {
  const { styles } = useDetailTheme();
  return (
  <View style={styles.sectionHeader}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {typeof count === 'number' ? <Text style={styles.sectionCount}>{count}</Text> : null}
  </View>
  );
};

const DetailTile = ({ label, value }) => {
  const { styles } = useDetailTheme();
  return (
  <View style={styles.detailTile}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue} numberOfLines={1}>{value}</Text>
  </View>
  );
};

const SummaryTile = ({ label, value, icon, highlight = false }) => {
  const { colors, styles } = useDetailTheme();
  return (
  <View style={[styles.summaryTile, highlight && styles.summaryTileHighlight]}>
    <Ionicons name={icon} size={18} color={highlight ? colors.primaryDark : colors.primary} />
    <Text style={styles.summaryLabel}>{label}</Text>
    <Text style={[styles.summaryValue, highlight && styles.summaryValueHighlight]}>
      {value}
    </Text>
  </View>
  );
};

const TransactionAction = ({ label, icon, color, onPress }) => {
  const { styles } = useDetailTheme();
  return (
  <TouchableOpacity activeOpacity={0.82} style={styles.transactionAction} onPress={onPress}>
    <View style={[styles.transactionIcon, { backgroundColor: `${color}18` }]}>
      <Ionicons name={icon} size={20} color={color} />
    </View>
    <Text style={styles.transactionLabel}>{label}</Text>
  </TouchableOpacity>
  );
};

const LotRow = ({ lot, relational }) => {
  const { colors, styles } = useDetailTheme();
  const state = lot.state || lot.status;
  const color = state === STOCK_STATUSES.IN_STOCK
    ? colors.success
    : state === STOCK_STATUSES.SCRAPPED
      ? colors.danger
      : colors.warning;

  return (
    <View style={styles.lotRow}>
      <View style={styles.lotMain}>
        <Text style={styles.lotNo} numberOfLines={1}>{lot.lotNo || lot.lot_no || '未知批次'}</Text>
        <Text style={styles.lotMeta} numberOfLines={1}>
          {lot.serialNo || lot.serial_no || '未设置序列号'}
        </Text>
      </View>
      <View style={styles.lotRight}>
        <Badge text={lot.active === false ? '已停用' : STOCK_STATUS_LABELS[state] || '未知'} color={color} size="small" />
        <Text style={styles.lotQty}>{relational ? lot.balanceStatus === 'legacy_invalid' || lot.qty == null ? '待核对' : `${lot.qty}g` : `${lot.qty || 0}g`}</Text>
      </View>
      {lot.balanceStatus?.startsWith('legacy_') ? <Text style={styles.lotNotes}>{lot.balanceStatus === 'legacy_invalid' ? '历史余额无效，需人工核对后迁移' : '历史余额待核对'}</Text> : null}
      {lot.notes ? <Text style={styles.lotNotes}>{lot.notes}</Text> : null}
    </View>
  );
};

const EmptySection = ({ text }) => {
  const { styles } = useDetailTheme();
  return (
  <View style={styles.emptySection}>
    <Text style={styles.emptySectionText}>{text}</Text>
  </View>
  );
};

const useDetailTheme = () => {
  const { colors } = useAppTheme();
  return { colors, styles: React.useMemo(() => createStyles(colors), [colors]) };
};

const createStyles = (COLORS) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
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
