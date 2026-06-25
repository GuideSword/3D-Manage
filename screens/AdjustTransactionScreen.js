import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  COLORS,
  INVENTORY_TXN_TYPES,
  RADIUS,
  SPACING,
  STOCK_STATUSES,
  TYPOGRAPHY,
} from '../constants';
import { Button, Card, Input, Picker } from '../components';
import { isAuthRequiredError, materialsAPI, stockAPI } from '../utils/api';

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

  const lotOptions = useMemo(() => (
    stockLots
      .filter((lot) => (lot.state || lot.status) !== STOCK_STATUSES.SCRAPPED)
      .map((lot) => {
        const material = materials.find((item) => item.id === (lot.materialId || lot.material_id));
        const materialName = material
          ? `${material.type || material.materialType || '未知'} ${material.color || ''}`.trim()
          : '未知耗材';
        return {
          value: lot.id,
          label: `${lot.lotNo || lot.lot_no || '未知批次'} - ${materialName} (当前: ${lot.qty || 0}g)`,
        };
      })
  ), [stockLots, materials]);

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
    return <LoadingState text="加载库存数据中..." />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <FormHeader />

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>批次信息</Text>
          {lotOptions.length === 0 ? (
            <EmptyOptions title="暂无可盘点批次" hint="请先创建耗材并完成入库。" />
          ) : (
            <>
              <Picker
                label="选择批次 *"
                placeholder="请选择要盘点的批次"
                value={formData.lotId}
                onValueChange={handleLotChange}
                options={lotOptions}
              />
              {selectedLotInfo ? (
                <View style={styles.infoBox}>
                  <Text style={styles.infoLabel}>当前账面库存</Text>
                  <Text style={styles.infoValue}>{selectedLotInfo.qty || 0}g</Text>
                </View>
              ) : null}
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
            placeholder="请输入盘点原因或备注"
            value={formData.notes}
            onChangeText={(text) => setFormData((prev) => ({ ...prev, notes: text }))}
            multiline
            numberOfLines={3}
          />
        </Card>

        <View style={styles.buttonContainer}>
          <Button
            title={loading ? '提交中...' : '确认盘点'}
            iconLeft="checkmark-outline"
            onPress={handleSubmit}
            disabled={loading}
            loading={loading}
            fullWidth
            style={styles.submitButton}
          />
          <Button title="取消" onPress={() => navigation.goBack()} variant="outline" fullWidth />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const LoadingState = ({ text }) => (
  <SafeAreaView style={styles.container}>
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text style={styles.loadingText}>{text}</Text>
    </View>
  </SafeAreaView>
);

const FormHeader = () => (
  <View style={styles.header}>
    <View style={styles.headerIcon}>
      <Ionicons name="swap-horizontal-outline" size={24} color={COLORS.primary} />
    </View>
    <View style={styles.headerText}>
      <Text style={styles.eyebrow}>STOCK CHECK</Text>
      <Text style={styles.title}>库存盘点</Text>
      <Text style={styles.subtitle}>将批次库存调整为盘点后的实际数量。</Text>
    </View>
  </View>
);

const EmptyOptions = ({ title, hint }) => (
  <View style={styles.emptyOptionsContainer}>
    <Text style={styles.emptyOptionsText}>{title}</Text>
    <Text style={styles.emptyOptionsHint}>{hint}</Text>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xxl,
  },
  loadingText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
  },
  headerText: {
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
  subtitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  section: {
    marginHorizontal: 0,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    ...TYPOGRAPHY.sectionTitle,
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  emptyOptionsContainer: {
    padding: SPACING.xl,
    alignItems: 'center',
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: RADIUS.md,
  },
  emptyOptionsText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  emptyOptionsHint: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  infoBox: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primarySoft,
    marginTop: SPACING.sm,
  },
  infoLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  infoValue: {
    ...TYPOGRAPHY.meta,
    color: COLORS.primaryDark,
  },
  buttonContainer: {
    marginTop: SPACING.sm,
  },
  submitButton: {
    marginBottom: SPACING.md,
  },
});

export default AdjustTransactionScreen;
