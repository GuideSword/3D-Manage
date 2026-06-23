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
import { COLORS, STOCK_STATUSES, INVENTORY_TXN_TYPES } from '../constants';
import { Card, Button, Input, Picker } from '../components';
import { materialsAPI, stockAPI, isAuthRequiredError } from '../utils/api';

const AdjustTransactionScreen = ({ navigation }) => {
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

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoadingData(true);
      const [materialsData, lotsData] = await Promise.all([
        materialsAPI.getAll().catch((error) => {
          if (isAuthRequiredError(error)) throw error;
          return [];
        }),
        stockAPI.getLots().catch((error) => {
          if (isAuthRequiredError(error)) throw error;
          return [];
        }),
      ]);
      setMaterials(materialsData || []);
      setStockLots(lotsData || []);
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      console.error('加载数据失败:', error);
      Alert.alert('错误', '加载数据失败，请检查网络连接');
    } finally {
      setLoadingData(false);
    }
  };

  const lotOptions = useMemo(() => stockLots
    .filter((lot) => (lot.state || lot.status) !== STOCK_STATUSES.SCRAPPED)
    .map((lot) => {
      const material = materials.find((item) => item.id === (lot.materialId || lot.material_id));
      const materialName = material
        ? `${material.type || material.materialType || '未知'} ${material.color || ''}`.trim()
        : '未知物料';
      return {
        value: lot.id,
        label: `${lot.lotNo || lot.lot_no || '未知批次'} - ${materialName} (当前: ${lot.qty || 0}g)`,
      };
    }), [stockLots, materials]);

  const handleLotChange = (value) => {
    const selectedLot = stockLots.find((lot) => lot.id === value);
    setSelectedLotInfo(selectedLot || null);
    setFormData((prev) => ({
      ...prev,
      lotId: value,
      qty: selectedLot ? String(selectedLot.qty || 0) : prev.qty,
    }));
  };

  const validateForm = () => {
    if (!formData.lotId) {
      Alert.alert('验证失败', '请选择批次');
      return false;
    }
    if (formData.qty === '' || Number.isNaN(Number.parseFloat(formData.qty)) || Number.parseFloat(formData.qty) < 0) {
      Alert.alert('验证失败', '请输入有效的盘点数量');
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      await stockAPI.inventoryTransaction({
        lotId: formData.lotId,
        type: INVENTORY_TXN_TYPES.ADJUST,
        qty: Number.parseFloat(formData.qty),
        notes: formData.notes.trim() || '库存盘点调整',
      });

      Alert.alert('成功', '库存盘点已记录', [
        { text: '确定', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      console.error('库存盘点失败:', error);
      Alert.alert('错误', '库存盘点失败，请检查网络连接或稍后重试');
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
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>批次信息</Text>
          {lotOptions.length === 0 ? (
            <View style={styles.emptyOptionsContainer}>
              <Text style={styles.emptyOptionsText}>暂无可盘点批次</Text>
              <Text style={styles.emptyOptionsHint}>请先创建物料并完成入库</Text>
            </View>
          ) : (
            <>
              <Picker
                label="选择批次 *"
                placeholder="请选择要盘点的批次"
                value={formData.lotId}
                onValueChange={handleLotChange}
                options={lotOptions}
              />
              {selectedLotInfo && (
                <View style={styles.lotInfoBox}>
                  <Text style={styles.lotInfoLabel}>当前账面库存:</Text>
                  <Text style={styles.lotInfoValue}>{selectedLotInfo.qty || 0}g</Text>
                </View>
              )}
            </>
          )}
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>盘点结果</Text>
          <Input
            label="实际库存数量 (g) *"
            placeholder="请输入盘点后的实际数量"
            value={formData.qty}
            onChangeText={(text) => setFormData((prev) => ({ ...prev, qty: text }))}
            keyboardType="decimal-pad"
          />
          <Input
            label="备注"
            placeholder="请输入盘点原因或备注（可选）"
            value={formData.notes}
            onChangeText={(text) => setFormData((prev) => ({ ...prev, notes: text }))}
            multiline
            numberOfLines={3}
          />
        </Card>

        <View style={styles.buttonContainer}>
          <Button
            title={loading ? '提交中...' : '确认盘点'}
            onPress={handleSubmit}
            disabled={loading}
            loading={loading}
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

export default AdjustTransactionScreen;
