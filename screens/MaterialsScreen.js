import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  RefreshControl,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, STOCK_STATUSES, STOCK_STATUS_LABELS, INVENTORY_TXN_TYPES, INVENTORY_TXN_LABELS, ROUTES } from '../constants';
import { Card, Button, Badge } from '../components';
import { materialsAPI, stockAPI, isAuthRequiredError } from '../utils/api';

const MaterialsScreen = ({ navigation, route }) => {
  const [materials, setMaterials] = useState([]);
  const [stockLots, setStockLots] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('materials'); // 'materials' or 'inventory'
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  // 获取物料列表
  const fetchMaterials = async () => {
    try {
      setLoading(true);
      const params = {};
      if (searchQuery && searchQuery.trim()) {
        params.search = searchQuery.trim();
      }
      const data = await materialsAPI.getAll(params);
      // 如果后端没有过滤，前端再次过滤确保准确性
      let filteredData = data || [];
      if (searchQuery && searchQuery.trim()) {
        const searchTerm = searchQuery.trim().toLowerCase();
        filteredData = (data || []).filter(material => {
          const type = (material.type || material.materialType || '').toLowerCase();
          const brand = (material.brand || '').toLowerCase();
          const color = (material.color || '').toLowerCase();
          return type.includes(searchTerm) || 
                 brand.includes(searchTerm) || 
                 color.includes(searchTerm);
        });
      }
      setMaterials(filteredData);
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      console.error('获取物料列表失败:', error);
      Alert.alert('错误', '获取物料列表失败，请检查网络连接');
      setMaterials([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // 获取库存批次列表
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

  // 加载数据
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

  // 当屏幕获得焦点时刷新数据
  useFocusEffect(
    React.useCallback(() => {
      loadData();
    }, [])
  );

  // 删除物料
  const handleDeleteMaterial = async (materialId) => {
    Alert.alert(
      '确认删除',
      '确定要删除这个物料吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingId(materialId);
              await materialsAPI.delete(materialId);
              Alert.alert('成功', '物料已删除');
              await fetchMaterials();
            } catch (error) {
              if (isAuthRequiredError(error)) {
                return;
              }
              Alert.alert('错误', '删除物料失败');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  // 获取物料的批次列表
  const getMaterialLots = (materialId) => {
    return stockLots.filter(lot => lot.materialId === materialId || lot.material_id === materialId);
  };

  // 计算物料总库存
  const getMaterialTotalQty = (materialId) => {
    const lots = getMaterialLots(materialId);
    return lots.reduce((sum, lot) => sum + (lot.qty || 0), 0);
  };

  const MaterialCard = ({ material }) => {
    const materialLots = getMaterialLots(material.id);
    const totalQty = getMaterialTotalQty(material.id);

    return (
      <Card style={styles.materialCard}>
        <TouchableOpacity
          onPress={() => navigation.navigate('MaterialDetail', { materialId: material.id })}
          activeOpacity={0.7}
        >
          <View style={styles.materialHeader}>
            <View style={styles.materialBasic}>
              <Text style={styles.materialType}>{material.type || material.materialType || '未知'}</Text>
              <Text style={styles.materialBrand}>{material.brand || ''}</Text>
            </View>
            <View style={styles.headerRight}>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={(e) => {
                  e.stopPropagation();
                  handleDeleteMaterial(material.id);
                }}
                disabled={deletingId === material.id}
              >
                {deletingId === material.id ? (
                  <ActivityIndicator size="small" color={COLORS.danger} />
                ) : (
                  <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                )}
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.materialSpecs}>
            {material.diameter && (
              <Text style={styles.specText}>直径: {material.diameter}mm</Text>
            )}
            {material.color && (
              <Text style={styles.specText}>颜色: {material.color}</Text>
            )}
          </View>

          <View style={styles.materialDetails}>
            {material.density && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>密度:</Text>
                <Text style={styles.detailValue}>{material.density} g/cm³</Text>
              </View>
            )}
            {(material.unitPrice || material.unit_price) && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>单价:</Text>
                <Text style={styles.detailValue}>
                  {material.unitPrice || material.unit_price}CNY/{material.unit || 'kg'}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.lotsSummary}>
            <Text style={styles.lotsTitle}>库存批次: {materialLots.length}个</Text>
            <View style={styles.totalQty}>
              <Text style={styles.totalQtyLabel}>总库存:</Text>
              <Text style={styles.totalQtyValue}>{totalQty}g</Text>
            </View>
          </View>

          {material.notes && (
            <Text style={styles.materialNotes}>{material.notes}</Text>
          )}
        </TouchableOpacity>
      </Card>
    );
  };


  // 删除批次
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

  const LotCard = ({ lot, material }) => (
    <Card style={styles.lotCard}>
      <View style={styles.lotHeader}>
        <View style={styles.lotBasic}>
          <Text style={styles.lotNo}>{lot.lotNo || lot.lot_no || '未知批次'}</Text>
          {lot.serialNo || lot.serial_no ? (
            <Text style={styles.serialNo}>{lot.serialNo || lot.serial_no}</Text>
          ) : null}
        </View>
        <View style={styles.lotHeaderRight}>
          <Badge
            text={STOCK_STATUS_LABELS[lot.state || lot.status] || '未知'}
            color={(lot.state || lot.status) === STOCK_STATUSES.IN_STOCK ? COLORS.success : COLORS.warning}
            size="small"
          />
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDeleteLot(lot.id)}
            disabled={deletingId === lot.id}
          >
            {deletingId === lot.id ? (
              <ActivityIndicator size="small" color={COLORS.danger} />
            ) : (
              <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.lotDetails}>
        {lot.location && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>位置:</Text>
            <Text style={styles.detailValue}>{lot.location}</Text>
          </View>
        )}
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>数量:</Text>
          <Text style={styles.detailValue}>{lot.qty || 0}g</Text>
        </View>
        {material && (material.type || material.materialType) && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>物料:</Text>
            <Text style={styles.detailValue}>
              {material.type || material.materialType} {material.color || ''}
            </Text>
          </View>
        )}
      </View>

      {lot.notes && (
        <Text style={styles.lotNotes}>{lot.notes}</Text>
      )}
    </Card>
  );

  const InventoryPanel = () => (
    <Card style={styles.inventoryPanel}>
      <Text style={styles.panelTitle}>库存操作</Text>
      <View style={styles.inventoryActions}>
        <TouchableOpacity 
          style={styles.inventoryButton} 
          onPress={() => navigation.navigate(ROUTES.INBOUND_TRANSACTION)}
        >
          <Ionicons name="add-circle" size={20} color={COLORS.success} />
          <Text style={styles.inventoryButtonText}>入库</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.inventoryButton} 
          onPress={() => navigation.navigate(ROUTES.OUTBOUND_TRANSACTION)}
        >
          <Ionicons name="remove-circle" size={20} color={COLORS.danger} />
          <Text style={styles.inventoryButtonText}>出库</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.inventoryButton}
          onPress={() => navigation.navigate(ROUTES.ADJUST_TRANSACTION)}
        >
          <Ionicons name="swap-horizontal" size={20} color={COLORS.warning} />
          <Text style={styles.inventoryButtonText}>盘点</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );


  const TabSelector = () => (
    <View style={styles.tabContainer}>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'materials' && styles.activeTab]}
        onPress={() => setActiveTab('materials')}
      >
        <Text style={[styles.tabText, activeTab === 'materials' && styles.activeTabText]}>
          物料主数据
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'inventory' && styles.activeTab]}
        onPress={() => setActiveTab('inventory')}
      >
        <Text style={[styles.tabText, activeTab === 'inventory' && styles.activeTabText]}>
          库存管理
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderContent = () => {
    if (activeTab === 'materials') {
      if (loading && !refreshing) {
        return (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>加载中...</Text>
          </View>
        );
      }
      return (
        <FlatList
          data={materials}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <MaterialCard material={item} />}
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
            materials.length === 0 && styles.emptyListContainer,
          ]}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="cube-outline" size={64} color={COLORS.textSecondary} />
              <Text style={styles.emptyText}>
                {searchQuery ? '未找到匹配的物料' : '暂无物料'}
              </Text>
            </View>
          }
        />
      );
    } else {
      return (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
              tintColor={COLORS.primary}
            />
          }
          contentContainerStyle={styles.inventoryContainer}
        >
          <InventoryPanel />

          <View style={styles.lotsList}>
            <Text style={styles.sectionTitle}>库存批次</Text>
            {stockLots.length > 0 ? (
              stockLots.map(lot => {
                // 查找关联的物料
                const material = materials.find(m => m.id === (lot.materialId || lot.material_id));
                return <LotCard key={lot.id} lot={lot} material={material || {}} />;
              })
            ) : (
              <View style={styles.emptyContainer}>
                <Ionicons name="cube-outline" size={64} color={COLORS.textSecondary} />
                <Text style={styles.emptyText}>暂无库存批次</Text>
              </View>
            )}
          </View>
        </ScrollView>
      );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>耗材管理</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setShowSearch(!showSearch)}
          >
            <Ionicons name="search" size={24} color={showSearch ? COLORS.primary : COLORS.text} />
          </TouchableOpacity>
          {activeTab === 'materials' && (
            <TouchableOpacity
              style={styles.headerButton}
              onPress={() => {
                navigation.navigate('CreateMaterial');
              }}
            >
              <Ionicons name="add-circle" size={24} color={COLORS.primary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 搜索框 */}
      {showSearch && (
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="搜索物料（类型、品牌、颜色）"
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

      <TabSelector />
      {renderContent()}
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    color: COLORS.text,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
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
    padding: 32,
    minHeight: 300,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  emptyListContainer: {
    flexGrow: 1,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: COLORS.primary,
  },
  tabText: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  activeTabText: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  listContainer: {
    padding: 16,
  },
  inventoryContainer: {
    padding: 16,
  },
  materialCard: {
    marginBottom: 12,
  },
  materialHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  materialBasic: {
    flex: 1,
  },
  materialType: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  materialBrand: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  materialSpecs: {
    alignItems: 'flex-end',
  },
  specText: {
    fontSize: 14,
    color: COLORS.text,
    marginBottom: 2,
  },
  materialDetails: {
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
  lotsSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  lotsTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  totalQty: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  totalQtyLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginRight: 4,
  },
  totalQtyValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  materialNotes: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },
  inventoryPanel: {
    marginBottom: 16,
  },
  panelTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  inventoryActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  inventoryButton: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    flex: 1,
    marginHorizontal: 4,
  },
  inventoryButtonText: {
    fontSize: 12,
    color: COLORS.text,
    marginTop: 4,
  },
  lotsList: {
    // 批次列表样式
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  lotCard: {
    marginBottom: 8,
  },
  lotHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  lotHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lotBasic: {
    flex: 1,
  },
  lotNo: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  serialNo: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  lotDetails: {
    marginBottom: 8,
  },
  lotNotes: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },
  deleteButton: {
    padding: 4,
  },
});

export default MaterialsScreen;
