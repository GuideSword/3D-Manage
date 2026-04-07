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
import { COLORS, STOCK_STATUSES, STOCK_STATUS_LABELS, ROUTES } from '../constants';
import { Card, Button, Badge } from '../components';
import { materialsAPI, stockAPI } from '../utils/api';

const MaterialDetailScreen = ({ route, navigation }) => {
  const { materialId } = route.params || {};
  const [material, setMaterial] = useState(null);
  const [stockLots, setStockLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 获取物料详情和库存批次
  const fetchMaterialDetail = async () => {
    if (!materialId) {
      Alert.alert('错误', '物料ID不存在');
      navigation.goBack();
      return;
    }

    try {
      setLoading(true);
      
      // 先尝试从列表获取物料（如果API不支持/:id路由）
      let materialData = null;
      try {
        materialData = await materialsAPI.getById(materialId);
        // 如果返回的数据包含error字段，说明物料不存在
        if (materialData && materialData.error) {
          materialData = null;
        }
      } catch (err) {
        console.error('获取物料详情失败:', err);
        // 如果API不支持/:id路由，尝试从列表获取
        if (err.status === 404 || err.message?.includes('Route not found') || err.message?.includes('404')) {
          try {
            const allMaterials = await materialsAPI.getAll();
            materialData = allMaterials.find(m => m.id === materialId || String(m.id) === String(materialId));
          } catch (listErr) {
            console.error('从列表获取物料失败:', listErr);
            materialData = null;
          }
        }
      }
      
      // 获取库存批次
      let lotsData = [];
      try {
        lotsData = await stockAPI.getLots({ materialId }) || [];
      } catch (err) {
        console.error('获取库存批次失败:', err);
        lotsData = [];
      }
      
      if (materialData) {
        setMaterial(materialData);
        setStockLots(lotsData);
      } else {
        Alert.alert('错误', '物料不存在', [
          {
            text: '确定',
            onPress: () => navigation.goBack(),
          },
        ]);
        return;
      }
    } catch (error) {
      console.error('获取物料详情失败:', error);
      Alert.alert('错误', '获取物料详情失败，请检查网络连接', [
        {
          text: '确定',
          onPress: () => navigation.goBack(),
        },
      ]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // 删除物料
  const handleDelete = () => {
    Alert.alert(
      '确认删除',
      '确定要删除这个物料吗？此操作不可恢复。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeleting(true);
              await materialsAPI.delete(materialId);
              Alert.alert('成功', '物料已删除', [
                {
                  text: '确定',
                  onPress: () => navigation.goBack(),
                },
              ]);
            } catch (error) {
              Alert.alert('错误', '删除物料失败');
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

  // 计算总库存
  const totalStock = stockLots.reduce((sum, lot) => sum + (lot.qty || 0), 0);

  if (loading && !material) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!material) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContainer}>
          <Ionicons name="cube-outline" size={64} color={COLORS.textSecondary} />
          <Text style={styles.emptyText}>物料不存在</Text>
          <Button title="返回" onPress={() => navigation.goBack()} style={styles.backButton} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
      >
        {/* 基本信息 */}
        <Card style={styles.section}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Text style={styles.materialType}>{material.type || material.materialType || '未知'}</Text>
              <Text style={styles.materialBrand}>{material.brand || ''}</Text>
            </View>
          </View>

          <View style={styles.detailsGrid}>
            {material.diameter && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>直径</Text>
                <Text style={styles.detailValue}>{material.diameter} mm</Text>
              </View>
            )}
            {material.color && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>颜色</Text>
                <Text style={styles.detailValue}>{material.color}</Text>
              </View>
            )}
            {material.density && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>密度</Text>
                <Text style={styles.detailValue}>{material.density} g/cm³</Text>
              </View>
            )}
            {(material.unitPrice || material.unit_price) && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>单价</Text>
                <Text style={styles.detailValue}>
                  {material.unitPrice || material.unit_price}CNY/{material.unit || 'kg'}
                </Text>
              </View>
            )}
          </View>

          {material.notes && (
            <View style={styles.notesSection}>
              <Text style={styles.notesLabel}>备注</Text>
              <Text style={styles.notesText}>{material.notes}</Text>
            </View>
          )}
        </Card>

        {/* 库存统计 */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>库存统计</Text>
          <View style={styles.stockSummary}>
            <View style={styles.stockItem}>
              <Text style={styles.stockLabel}>总库存</Text>
              <Text style={styles.stockValue}>{totalStock}g</Text>
            </View>
            <View style={styles.stockItem}>
              <Text style={styles.stockLabel}>批次数量</Text>
              <Text style={styles.stockValue}>{stockLots.length}个</Text>
            </View>
          </View>
        </Card>

        {/* 库存批次列表 */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>库存批次</Text>
          {stockLots.length > 0 ? (
            stockLots.map((lot) => (
              <View key={lot.id} style={styles.lotItem}>
                <View style={styles.lotHeader}>
                  <View style={styles.lotBasic}>
                    <Text style={styles.lotNo}>{lot.lotNo || lot.lot_no || '未知批次'}</Text>
                    {lot.serialNo || lot.serial_no ? (
                      <Text style={styles.serialNo}>{lot.serialNo || lot.serial_no}</Text>
                    ) : null}
                  </View>
                  <Badge
                    text={STOCK_STATUS_LABELS[lot.state || lot.status] || '未知'}
                    color={(lot.state || lot.status) === STOCK_STATUSES.IN_STOCK ? COLORS.success : COLORS.warning}
                    size="small"
                  />
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
                  {lot.notes && (
                    <Text style={styles.lotNotes}>{lot.notes}</Text>
                  )}
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>暂无库存批次</Text>
          )}
        </Card>

        {/* 操作按钮 */}
        <Card style={styles.section}>
          <Button
            title="删除物料"
            onPress={handleDelete}
            variant="danger"
            style={styles.deleteButton}
            disabled={deleting}
            loading={deleting}
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
  headerLeft: {
    flex: 1,
  },
  materialType: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  materialBrand: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  detailItem: {
    width: '50%',
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  notesSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  notesLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  notesText: {
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  stockSummary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  stockItem: {
    alignItems: 'center',
  },
  stockLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  stockValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  lotItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 12,
  },
  lotHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
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
    marginTop: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  lotNotes: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    marginTop: 8,
  },
  deleteButton: {
    marginTop: 0,
  },
});

export default MaterialDetailScreen;

