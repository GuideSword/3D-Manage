import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { COLORS, STOCK_STATUSES, STOCK_STATUS_LABELS, INVENTORY_TXN_TYPES } from '../constants';
import { Card, Button, Input, Picker } from '../components';
import { materialsAPI, stockAPI } from '../utils/api';

const InboundTransactionScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [materials, setMaterials] = useState([]);
  const [stockLots, setStockLots] = useState([]);
  const [inTransactionType, setInTransactionType] = useState('existing'); // 'existing' or 'new'
  const [formData, setFormData] = useState({
    lotId: '',
    materialId: '',
    lotNo: '',
    location: '',
    qty: '',
    notes: '',
  });

  // 加载数据
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoadingData(true);
      const [materialsData, lotsData] = await Promise.all([
        materialsAPI.getAll().catch(() => []),
        stockAPI.getLots().catch(() => []),
      ]);
      setMaterials(materialsData || []);
      setStockLots(lotsData || []);
    } catch (error) {
      console.error('加载数据失败:', error);
      Alert.alert('错误', '加载数据失败，请检查网络连接');
    } finally {
      setLoadingData(false);
    }
  };

  // 准备物料选项
  const materialOptions = useMemo(() => {
    return materials.map(material => ({
      value: material.id,
      label: `${material.type || material.materialType || '未知'} ${material.color || ''} - ${material.brand || ''}`.trim(),
    }));
  }, [materials]);

  // 准备批次选项（用于入库选择 - 显示所有非报废状态的批次）
  const inLotOptions = useMemo(() => {
    return stockLots
      .filter(lot => (lot.state || lot.status) !== STOCK_STATUSES.SCRAPPED)
      .map(lot => {
        const material = materials.find(m => m.id === (lot.materialId || lot.material_id));
        const materialName = material 
          ? `${material.type || material.materialType || '未知'} ${material.color || ''}`.trim()
          : '未知物料';
        const status = STOCK_STATUS_LABELS[lot.state || lot.status] || '未知';
        return {
          value: lot.id,
          label: `${lot.lotNo || lot.lot_no || '未知批次'} - ${materialName} (${status}, 库存: ${lot.qty || 0}g)`,
        };
      });
  }, [stockLots, materials]);

  // 获取物料的所有批次
  const getMaterialLotsForIn = useCallback((materialId) => {
    return stockLots.filter(lot => 
      (lot.materialId || lot.material_id) === materialId && 
      (lot.state || lot.status) !== STOCK_STATUSES.SCRAPPED
    );
  }, [stockLots]);

  // 处理物料选择变化
  const handleMaterialChange = useCallback((value) => {
    setFormData(prev => ({ ...prev, materialId: value }));
    // 检查该物料是否已有批次
    const existingLots = getMaterialLotsForIn(value);
    if (existingLots.length > 0) {
      Alert.alert(
        '提示',
        `该物料已有 ${existingLots.length} 个批次，您可以选择"选择现有批次"来入库`,
        [{ text: '确定' }]
      );
    }
  }, [getMaterialLotsForIn]);

  // 验证表单
  const validateForm = () => {
    if (inTransactionType === 'existing') {
      if (!formData.lotId) {
        Alert.alert('验证失败', '请选择批次');
        return false;
      }
    } else {
      if (!formData.materialId) {
        Alert.alert('验证失败', '请选择物料');
        return false;
      }
      if (!formData.lotNo || !formData.lotNo.trim()) {
        Alert.alert('验证失败', '请输入批次号');
        return false;
      }
    }
    if (!formData.qty || parseFloat(formData.qty) <= 0) {
      Alert.alert('验证失败', '请输入有效的数量');
      return false;
    }
    return true;
  };

  // 提交入库操作
  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      
      let targetLotId = formData.lotId;
      
      // 如果是新建批次，先创建批次
      if (inTransactionType === 'new') {
        const newLot = await stockAPI.createLot({
          materialId: formData.materialId,
          lotNo: formData.lotNo.trim(),
          location: formData.location.trim() || undefined,
          qty: 0, // 初始数量为0，然后通过入库操作增加
          state: STOCK_STATUSES.IN_STOCK,
          notes: formData.notes.trim() || undefined,
        });
        targetLotId = newLot.id;
      }
      
      // 执行入库操作
      await stockAPI.inventoryTransaction({
        lotId: targetLotId,
        type: INVENTORY_TXN_TYPES.IN,
        qty: parseFloat(formData.qty),
        notes: formData.notes.trim() || undefined,
      });
      
      Alert.alert(
        '成功',
        '入库操作成功！',
        [
          {
            text: '确定',
            onPress: () => {
              navigation.goBack();
            },
          },
        ]
      );
    } catch (error) {
      console.error('入库失败:', error);
      Alert.alert('错误', '入库操作失败，请检查网络连接或稍后重试');
    } finally {
      setLoading(false);
    }
  };

  if (loadingData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
        {/* 入库类型选择 */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>入库类型</Text>
          <View style={styles.transactionTypeContainer}>
            <TouchableOpacity
              style={[
                styles.transactionTypeButton,
                inTransactionType === 'existing' && styles.transactionTypeButtonActive,
              ]}
              onPress={() => {
                setInTransactionType('existing');
                setFormData(prev => ({ ...prev, materialId: '', lotNo: '', location: '' }));
              }}
            >
              <Text
                style={[
                  styles.transactionTypeText,
                  inTransactionType === 'existing' && styles.transactionTypeTextActive,
                ]}
              >
                选择现有批次
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.transactionTypeButton,
                inTransactionType === 'new' && styles.transactionTypeButtonActive,
              ]}
              onPress={() => {
                setInTransactionType('new');
                setFormData(prev => ({ ...prev, lotId: '' }));
              }}
            >
              <Text
                style={[
                  styles.transactionTypeText,
                  inTransactionType === 'new' && styles.transactionTypeTextActive,
                ]}
              >
                新建批次入库
              </Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* 批次/物料选择 */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>批次信息</Text>
          
          {inTransactionType === 'existing' ? (
            // 选择现有批次
            <>
              {inLotOptions.length === 0 ? (
                <View style={styles.emptyOptionsContainer}>
                  <Text style={styles.emptyOptionsText}>暂无可用批次</Text>
                  <Text style={styles.emptyOptionsHint}>请选择"新建批次入库"来创建新批次</Text>
                </View>
              ) : (
                <Picker
                  label="选择批次 *"
                  placeholder="请选择要入库的批次"
                  value={formData.lotId}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, lotId: value }))}
                  options={inLotOptions}
                />
              )}
            </>
          ) : (
            // 新建批次入库
            <>
              <Picker
                label="选择物料 *"
                placeholder="请选择物料"
                value={formData.materialId}
                onValueChange={handleMaterialChange}
                options={materialOptions}
              />
              <Input
                label="批次号 *"
                placeholder="请输入批次号（如：LOT-2024-001）"
                value={formData.lotNo}
                onChangeText={(text) => setFormData(prev => ({ ...prev, lotNo: text }))}
              />
              <Input
                label="位置"
                placeholder="请输入存放位置（可选）"
                value={formData.location}
                onChangeText={(text) => setFormData(prev => ({ ...prev, location: text }))}
              />
            </>
          )}
        </Card>

        {/* 入库信息 */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>入库信息</Text>
          
          <Input
            label="入库数量 (g) *"
            placeholder="请输入入库数量"
            value={formData.qty}
            onChangeText={(text) => setFormData(prev => ({ ...prev, qty: text }))}
            keyboardType="decimal-pad"
          />

          <Input
            label="备注"
            placeholder="请输入备注信息（可选）"
            value={formData.notes}
            onChangeText={(text) => setFormData(prev => ({ ...prev, notes: text }))}
            multiline
            numberOfLines={3}
          />
        </Card>

        {/* 提交按钮 */}
        <View style={styles.buttonContainer}>
          <Button
            title={loading ? '提交中...' : '确认入库'}
            onPress={handleSubmit}
            disabled={loading}
            loading={loading}
            variant="success"
            style={styles.submitButton}
          />
          <Button
            title="取消"
            onPress={() => navigation.goBack()}
            variant="outline"
            style={styles.cancelButton}
          />
        </View>
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
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  section: {
    margin: 16,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  transactionTypeContainer: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 4,
  },
  transactionTypeButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  transactionTypeButtonActive: {
    backgroundColor: COLORS.background,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  transactionTypeText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  transactionTypeTextActive: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  emptyOptionsContainer: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 8,
  },
  emptyOptionsText: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptyOptionsHint: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  buttonContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  submitButton: {
    marginBottom: 12,
  },
  cancelButton: {
    marginTop: 0,
  },
});

export default InboundTransactionScreen;




