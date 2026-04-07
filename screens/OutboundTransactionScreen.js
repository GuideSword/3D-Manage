import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { COLORS, STOCK_STATUSES, STOCK_STATUS_LABELS, INVENTORY_TXN_TYPES } from '../constants';
import { Card, Button, Input, Picker } from '../components';
import { materialsAPI, stockAPI } from '../utils/api';

const OutboundTransactionScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [materials, setMaterials] = useState([]);
  const [stockLots, setStockLots] = useState([]);
  const [selectedLotInfo, setSelectedLotInfo] = useState(null);
  const [formData, setFormData] = useState({
    lotId: '',
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

  // 准备批次选项（用于出库选择 - 只显示在库状态的批次）
  const outLotOptions = useMemo(() => {
    return stockLots
      .filter(lot => (lot.state || lot.status) === STOCK_STATUSES.IN_STOCK)
      .map(lot => {
        const material = materials.find(m => m.id === (lot.materialId || lot.material_id));
        const materialName = material 
          ? `${material.type || material.materialType || '未知'} ${material.color || ''}`.trim()
          : '未知物料';
        return {
          value: lot.id,
          label: `${lot.lotNo || lot.lot_no || '未知批次'} - ${materialName} (库存: ${lot.qty || 0}g)`,
        };
      });
  }, [stockLots, materials]);

  // 处理批次选择变化
  const handleLotChange = (value) => {
    setFormData(prev => ({ ...prev, lotId: value }));
    // 保存选中的批次信息
    const selectedLot = stockLots.find(lot => lot.id === value);
    setSelectedLotInfo(selectedLot || null);
  };

  // 验证表单
  const validateForm = () => {
    if (!formData.lotId) {
      Alert.alert('验证失败', '请选择批次');
      return false;
    }
    if (!formData.qty || parseFloat(formData.qty) <= 0) {
      Alert.alert('验证失败', '请输入有效的数量');
      return false;
    }
    
    // 检查库存是否充足
    if (selectedLotInfo && (selectedLotInfo.qty || 0) < parseFloat(formData.qty)) {
      Alert.alert('验证失败', `库存不足，当前库存：${selectedLotInfo.qty || 0}g`);
      return false;
    }
    
    return true;
  };

  // 提交出库操作
  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      await stockAPI.inventoryTransaction({
        lotId: formData.lotId,
        type: INVENTORY_TXN_TYPES.OUT,
        qty: parseFloat(formData.qty),
        notes: formData.notes.trim() || undefined,
      });
      
      Alert.alert(
        '成功',
        '出库操作成功！',
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
      console.error('出库失败:', error);
      Alert.alert('错误', '出库操作失败，请检查网络连接或稍后重试');
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
        {/* 批次选择 */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>批次信息</Text>
          
          {outLotOptions.length === 0 ? (
            <View style={styles.emptyOptionsContainer}>
              <Text style={styles.emptyOptionsText}>暂无在库批次</Text>
              <Text style={styles.emptyOptionsHint}>请先进行入库操作</Text>
            </View>
          ) : (
            <>
              <Picker
                label="选择批次 *"
                placeholder="请选择要出库的批次"
                value={formData.lotId}
                onValueChange={handleLotChange}
                options={outLotOptions}
              />
              
              {selectedLotInfo && (
                <View style={styles.lotInfoBox}>
                  <Text style={styles.lotInfoLabel}>当前库存：</Text>
                  <Text style={styles.lotInfoValue}>{selectedLotInfo.qty || 0}g</Text>
                </View>
              )}
            </>
          )}
        </Card>

        {/* 出库信息 */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>出库信息</Text>
          
          <Input
            label="出库数量 (g) *"
            placeholder="请输入出库数量"
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
            title={loading ? '提交中...' : '确认出库'}
            onPress={handleSubmit}
            disabled={loading}
            loading={loading}
            variant="danger"
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
  lotInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    marginTop: 8,
  },
  lotInfoLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginRight: 8,
  },
  lotInfoValue: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
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

export default OutboundTransactionScreen;




