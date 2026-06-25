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
import { useFocusEffect } from '@react-navigation/native';
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
import { Badge, Card } from '../components';
import { isAuthRequiredError, materialsAPI, stockAPI } from '../utils/api';

const MaterialsScreen = ({ navigation, route }) => {
  const [materials, setMaterials] = useState([]);
  const [stockLots, setStockLots] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('materials');
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  const fetchMaterials = async () => {
    try {
      setLoading(true);
      const params = {};
      if (searchQuery && searchQuery.trim()) {
        params.search = searchQuery.trim();
      }
      const data = await materialsAPI.getAll(params);
      let filteredData = data || [];
      if (searchQuery && searchQuery.trim()) {
        const searchTerm = searchQuery.trim().toLowerCase();
        filteredData = (data || []).filter((material) => {
          const type = (material.type || material.materialType || '').toLowerCase();
          const brand = (material.brand || '').toLowerCase();
          const color = (material.color || '').toLowerCase();
          return type.includes(searchTerm)
            || brand.includes(searchTerm)
            || color.includes(searchTerm);
        });
      }
      setMaterials(filteredData);
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      console.error('获取耗材失败:', error);
      Alert.alert('错误', '获取耗材列表失败，请检查网络连接');
      setMaterials([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchStockLots = async () => {
    try {
      const data = await stockAPI.getLots();
      setStockLots(data || []);
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      console.error('获取库存批次失败:', error);
      Alert.alert('错误', '获取库存批次失败，请检查网络连接');
      setStockLots([]);
    }
  };

  const loadData = async () => {
    await Promise.all([fetchMaterials(), fetchStockLots()]);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
  };

  useEffect(() => {
    loadData();
  }, [searchQuery]);

  useEffect(() => {
    if (route?.params?.activeTab) {
      setActiveTab(route.params.activeTab);
    }
  }, [route?.params?.activeTab]);

  useFocusEffect(
    React.useCallback(() => {
      loadData();
    }, [])
  );

  const handleDeleteMaterial = async (materialId) => {
    Alert.alert(
      '确认删除',
      '确定要删除这个耗材吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingId(materialId);
              await materialsAPI.delete(materialId);
              Alert.alert('成功', '耗材已删除');
              await fetchMaterials();
            } catch (error) {
              if (isAuthRequiredError(error)) {
                return;
              }
              Alert.alert('错误', '删除耗材失败');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  const handleDeleteLot = async (lotId) => {
    Alert.alert(
      '确认删除',
      '确定要删除这个批次吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingId(lotId);
              await stockAPI.deleteLot(lotId);
              Alert.alert('成功', '批次已删除');
              await fetchStockLots();
            } catch (error) {
              if (isAuthRequiredError(error)) {
                return;
              }
              Alert.alert('错误', '删除批次失败');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  const getMaterialLots = (materialId) => (
    stockLots.filter((lot) => lot.materialId === materialId || lot.material_id === materialId)
  );

  const getMaterialTotalQty = (materialId) => (
    getMaterialLots(materialId).reduce((sum, lot) => sum + (lot.qty || 0), 0)
  );

  const findMaterial = (materialId) => (
    materials.find((material) => material.id === materialId || String(material.id) === String(materialId))
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleGroup}>
          <Text style={styles.eyebrow}>MATERIAL STOCK</Text>
          <Text style={styles.title}>耗材</Text>
        </View>
        <View style={styles.headerActions}>
          <IconButton
            icon="search"
            active={showSearch}
            onPress={() => setShowSearch((value) => !value)}
          />
          {activeTab === 'materials' ? (
            <IconButton
              icon="add"
              active
              onPress={() => navigation.navigate(ROUTES.CREATE_MATERIAL)}
            />
          ) : null}
        </View>
      </View>

      <View style={styles.segmentedControl}>
        <SegmentButton
          label="耗材"
          icon="layers-outline"
          active={activeTab === 'materials'}
          onPress={() => setActiveTab('materials')}
        />
        <SegmentButton
          label="库存"
          icon="archive-outline"
          active={activeTab === 'inventory'}
          onPress={() => setActiveTab('inventory')}
        />
      </View>

      {showSearch ? (
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color={COLORS.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="搜索材质、品牌或颜色"
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

      {activeTab === 'materials' ? (
        renderMaterialsList({
          loading,
          refreshing,
          materials,
          onRefresh,
          navigation,
          deletingId,
          handleDeleteMaterial,
          getMaterialLots,
          getMaterialTotalQty,
          searchQuery,
        })
      ) : (
        renderInventoryList({
          stockLots,
          materials,
          refreshing,
          onRefresh,
          navigation,
          deletingId,
          handleDeleteLot,
          findMaterial,
        })
      )}
    </SafeAreaView>
  );
};

const renderMaterialsList = ({
  loading,
  refreshing,
  materials,
  onRefresh,
  navigation,
  deletingId,
  handleDeleteMaterial,
  getMaterialLots,
  getMaterialTotalQty,
  searchQuery,
}) => {
  if (loading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>加载耗材中...</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={materials}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => (
        <MaterialCard
          material={item}
          totalQty={getMaterialTotalQty(item.id)}
          lotCount={getMaterialLots(item.id).length}
          deletingId={deletingId}
          onDelete={handleDeleteMaterial}
          onPress={() => navigation.navigate(ROUTES.MATERIAL_DETAIL, { materialId: item.id })}
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
        materials.length === 0 && styles.emptyListContainer,
      ]}
      ListEmptyComponent={(
        <View style={styles.emptyContainer}>
          <Ionicons name="layers-outline" size={50} color={COLORS.textTertiary} />
          <Text style={styles.emptyTitle}>{searchQuery ? '没有匹配的耗材' : '暂无耗材'}</Text>
          <Text style={styles.emptyText}>新增耗材后，可以在这里管理规格、库存和批次。</Text>
        </View>
      )}
    />
  );
};

const renderInventoryList = ({
  stockLots,
  materials,
  refreshing,
  onRefresh,
  navigation,
  deletingId,
  handleDeleteLot,
  findMaterial,
}) => (
  <ScrollView
    style={styles.inventoryScroll}
    contentContainerStyle={styles.inventoryContent}
    refreshControl={(
      <RefreshControl
        refreshing={refreshing}
        onRefresh={onRefresh}
        colors={[COLORS.primary]}
        tintColor={COLORS.primary}
      />
    )}
  >
    <InventoryActions navigation={navigation} />
    {stockLots.length > 0 ? stockLots.map((lot) => (
      <LotCard
        key={lot.id}
        lot={lot}
        material={findMaterial(lot.materialId || lot.material_id) || {}}
        deletingId={deletingId}
        onDelete={handleDeleteLot}
      />
    )) : (
      <View style={styles.emptyContainer}>
        <Ionicons name="archive-outline" size={50} color={COLORS.textTertiary} />
        <Text style={styles.emptyTitle}>暂无库存批次</Text>
        <Text style={styles.emptyText}>
          {materials.length > 0 ? '执行入库后会生成库存批次。' : '请先新增耗材，再执行入库。'}
        </Text>
      </View>
    )}
  </ScrollView>
);

const IconButton = ({ icon, active = false, onPress }) => (
  <TouchableOpacity
    activeOpacity={0.82}
    style={[styles.headerButton, active && styles.headerButtonActive]}
    onPress={onPress}
  >
    <Ionicons name={icon} size={20} color={active ? COLORS.primary : COLORS.textSecondary} />
  </TouchableOpacity>
);

const SegmentButton = ({ label, icon, active, onPress }) => (
  <TouchableOpacity
    activeOpacity={0.82}
    onPress={onPress}
    style={[styles.segmentButton, active && styles.segmentButtonActive]}
  >
    <Ionicons name={icon} size={16} color={active ? COLORS.primary : COLORS.textSecondary} />
    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
  </TouchableOpacity>
);

const MaterialCard = ({ material, totalQty, lotCount, deletingId, onDelete, onPress }) => {
  const materialType = material.type || material.materialType || '未知材质';

  return (
    <TouchableOpacity activeOpacity={0.84} onPress={onPress}>
      <Card style={styles.materialCard} interactive>
        <View style={styles.cardHeader}>
          <View style={styles.materialIdentity}>
            <View style={styles.materialSwatch} />
            <View style={styles.materialTitleGroup}>
              <Text style={styles.materialType} numberOfLines={1}>{materialType}</Text>
              <Text style={styles.materialBrand} numberOfLines={1}>{material.brand || '未设置品牌'}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={(event) => {
              event.stopPropagation?.();
              onDelete(material.id);
            }}
            disabled={deletingId === material.id}
          >
            {deletingId === material.id ? (
              <ActivityIndicator size="small" color={COLORS.danger} />
            ) : (
              <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.specRow}>
          <InfoPill label="颜色" value={material.color || '未设置'} />
          <InfoPill label="直径" value={material.diameter ? `${material.diameter}mm` : '未设置'} />
        </View>

        <View style={styles.stockSummary}>
          <SummaryItem label="总库存" value={`${totalQty}g`} />
          <SummaryItem label="批次" value={`${lotCount} 个`} />
          <SummaryItem label="单价" value={(material.unitPrice || material.unit_price) ? `${material.unitPrice || material.unit_price} CNY/${material.unit || 'kg'}` : '未设置'} />
        </View>

        {material.notes ? (
          <Text style={styles.materialNotes} numberOfLines={2}>{material.notes}</Text>
        ) : null}
      </Card>
    </TouchableOpacity>
  );
};

const LotCard = ({ lot, material, deletingId, onDelete }) => {
  const state = lot.state || lot.status;
  const statusColor = getStockStatusColor(state);
  const materialLabel = [
    material.type || material.materialType,
    material.brand,
    material.color,
  ].filter(Boolean).join(' · ') || '未知耗材';

  return (
    <Card style={styles.lotCard} interactive>
      <View style={styles.cardHeader}>
        <View style={styles.lotIdentity}>
          <Text style={styles.lotNo} numberOfLines={1}>{lot.lotNo || lot.lot_no || '未知批次'}</Text>
          <Text style={styles.lotMaterial} numberOfLines={1}>{materialLabel}</Text>
        </View>
        <View style={styles.lotRight}>
          <Badge text={STOCK_STATUS_LABELS[state] || '未知'} color={statusColor} size="small" />
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => onDelete(lot.id)}
            disabled={deletingId === lot.id}
          >
            {deletingId === lot.id ? (
              <ActivityIndicator size="small" color={COLORS.danger} />
            ) : (
              <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
            )}
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.stockSummary}>
        <SummaryItem label="数量" value={`${lot.qty || 0}g`} />
        <SummaryItem label="序列号" value={lot.serialNo || lot.serial_no || '未设置'} />
        <SummaryItem label="入库" value={lot.createdAt ? new Date(lot.createdAt).toLocaleDateString('zh-CN') : '未知'} />
      </View>
    </Card>
  );
};

const InventoryActions = ({ navigation }) => (
  <Card style={styles.inventoryPanel}>
    <Text style={styles.inventoryTitle}>库存操作</Text>
    <View style={styles.inventoryActionRow}>
      <InventoryAction
        title="入库"
        icon="enter-outline"
        color={COLORS.success}
        onPress={() => navigation.navigate(ROUTES.INBOUND_TRANSACTION)}
      />
      <InventoryAction
        title="出库"
        icon="exit-outline"
        color={COLORS.warning}
        onPress={() => navigation.navigate(ROUTES.OUTBOUND_TRANSACTION)}
      />
      <InventoryAction
        title="盘点"
        icon="swap-horizontal-outline"
        color={COLORS.primary}
        onPress={() => navigation.navigate(ROUTES.ADJUST_TRANSACTION)}
      />
    </View>
  </Card>
);

const InventoryAction = ({ title, icon, color, onPress }) => (
  <TouchableOpacity activeOpacity={0.82} style={styles.inventoryAction} onPress={onPress}>
    <View style={[styles.inventoryActionIcon, { backgroundColor: `${color}18` }]}>
      <Ionicons name={icon} size={20} color={color} />
    </View>
    <Text style={styles.inventoryActionText}>{title}</Text>
  </TouchableOpacity>
);

const InfoPill = ({ label, value }) => (
  <View style={styles.infoPill}>
    <Text style={styles.infoPillLabel}>{label}</Text>
    <Text style={styles.infoPillValue} numberOfLines={1}>{value}</Text>
  </View>
);

const SummaryItem = ({ label, value }) => (
  <View style={styles.summaryItem}>
    <Text style={styles.summaryLabel}>{label}</Text>
    <Text style={styles.summaryValue} numberOfLines={1}>{value}</Text>
  </View>
);

const getStockStatusColor = (state) => {
  if (state === STOCK_STATUSES.IN_STOCK) return COLORS.success;
  if (state === STOCK_STATUSES.SCRAPPED) return COLORS.danger;
  return COLORS.warning;
};

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
  segmentedControl: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    padding: SPACING.xs,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
  },
  segmentButton: {
    flex: 1,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    borderRadius: RADIUS.md,
  },
  segmentButtonActive: {
    backgroundColor: COLORS.surfaceElevated,
  },
  segmentText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
  },
  segmentTextActive: {
    color: COLORS.primary,
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
    justifyContent: 'center',
    padding: SPACING.xl,
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
  materialCard: {
    marginHorizontal: 0,
    marginBottom: SPACING.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: SPACING.md,
  },
  materialIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  materialSwatch: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.accentSoft,
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  materialTitleGroup: {
    flex: 1,
  },
  materialType: {
    ...TYPOGRAPHY.sectionTitle,
    color: COLORS.text,
  },
  materialBrand: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  deleteButton: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.dangerSoft,
  },
  specRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.lg,
  },
  infoPill: {
    flex: 1,
    minWidth: 0,
    padding: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
  },
  infoPillLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textTertiary,
  },
  infoPillValue: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
    marginTop: 2,
  },
  stockSummary: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  summaryItem: {
    flex: 1,
    minWidth: 0,
    padding: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
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
  materialNotes: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },
  inventoryScroll: {
    flex: 1,
  },
  inventoryContent: {
    padding: SPACING.lg,
    paddingTop: 0,
    paddingBottom: SPACING.xxl,
  },
  inventoryPanel: {
    marginHorizontal: 0,
    marginBottom: SPACING.md,
  },
  inventoryTitle: {
    ...TYPOGRAPHY.sectionTitle,
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  inventoryActionRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  inventoryAction: {
    flex: 1,
    minHeight: 82,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
  },
  inventoryActionIcon: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  inventoryActionText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
  },
  lotCard: {
    marginHorizontal: 0,
    marginBottom: SPACING.md,
  },
  lotIdentity: {
    flex: 1,
  },
  lotNo: {
    ...TYPOGRAPHY.sectionTitle,
    color: COLORS.text,
  },
  lotMaterial: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  lotRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
});

export default MaterialsScreen;
