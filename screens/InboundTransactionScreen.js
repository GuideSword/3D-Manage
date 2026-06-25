import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  INVENTORY_TXN_TYPES,
  RADIUS,
  SPACING,
  STOCK_STATUS_LABELS,
  STOCK_STATUSES,
  TYPOGRAPHY,
} from '../constants';
import { Button, Card, Input, Picker } from '../components';
import { isAuthRequiredError, materialsAPI, stockAPI } from '../utils/api';

const InboundTransactionScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [materials, setMaterials] = useState([]);
  const [stockLots, setStockLots] = useState([]);
  const [inTransactionType, setInTransactionType] = useState('existing');
  const [formData, setFormData] = useState({
    lotId: '',
    materialId: '',
    lotNo: '',
    location: '',
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

  const materialOptions = useMemo(() => (
    materials.map((material) => ({
      value: material.id,
      label: `${material.type || material.materialType || '未知'} ${material.color || ''} - ${material.brand || ''}`.trim(),
    }))
  ), [materials]);

  const inLotOptions = useMemo(() => (
    stockLots
      .filter((lot) => (lot.state || lot.status) !== STOCK_STATUSES.SCRAPPED)
      .map((lot) => {
        const material = materials.find((item) => item.id === (lot.materialId || lot.material_id));
        const materialName = material
          ? `${material.type || material.materialType || '未知'} ${material.color || ''}`.trim()
          : '未知耗材';
        const status = STOCK_STATUS_LABELS[lot.state || lot.status] || '未知';
        return {
          value: lot.id,
          label: `${lot.lotNo || lot.lot_no || '未知批次'} - ${materialName} (${status}, 库存: ${lot.qty || 0}g)`,
        };
      })
  ), [stockLots, materials]);

  const getMaterialLotsForIn = useCallback((materialId) => (
    stockLots.filter((lot) => (
      (lot.materialId || lot.material_id) === materialId
      && (lot.state || lot.status) !== STOCK_STATUSES.SCRAPPED
    ))
  ), [stockLots]);

  const handleMaterialChange = useCallback((value) => {
    setFormData((prev) => ({ ...prev, materialId: value }));
    const existingLots = getMaterialLotsForIn(value);
    if (existingLots.length > 0) {
      Alert.alert(
        '提示',
        `该耗材已有 ${existingLots.length} 个批次，也可以选择“现有批次入库”。`,
        [{ text: '确定' }]
      );
    }
  }, [getMaterialLotsForIn]);

  const validateForm = () => {
    if (inTransactionType === 'existing') {
      if (!formData.lotId) {
        Alert.alert('验证失败', '请选择批次');
        return false;
      }
    } else {
      if (!formData.materialId) {
        Alert.alert('验证失败', '请选择耗材');
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

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      let targetLotId = formData.lotId;

      if (inTransactionType === 'new') {
        const newLot = await stockAPI.createLot({
          materialId: formData.materialId,
          lotNo: formData.lotNo.trim(),
          location: formData.location.trim() || undefined,
          qty: 0,
          state: STOCK_STATUSES.IN_STOCK,
          notes: formData.notes.trim() || undefined,
        });
        targetLotId = newLot.id;
      }

      await stockAPI.inventoryTransaction({
        lotId: targetLotId,
        type: INVENTORY_TXN_TYPES.IN,
        qty: parseFloat(formData.qty),
        notes: formData.notes.trim() || undefined,
      });

      Alert.alert('成功', '入库操作成功', [
        { text: '确定', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      console.error('入库失败:', error);
      Alert.alert('错误', '入库操作失败，请检查网络连接或稍后重试');
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
        <FormHeader
          icon="enter-outline"
          eyebrow="INBOUND"
          title="入库操作"
          subtitle="向现有批次补充库存，或创建新批次后入库。"
          color={COLORS.success}
        />

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>入库类型</Text>
          <View style={styles.segmentedControl}>
            <SegmentButton
              label="现有批次"
              active={inTransactionType === 'existing'}
              onPress={() => {
                setInTransactionType('existing');
                setFormData((prev) => ({ ...prev, materialId: '', lotNo: '', location: '' }));
              }}
            />
            <SegmentButton
              label="新建批次"
              active={inTransactionType === 'new'}
              onPress={() => {
                setInTransactionType('new');
                setFormData((prev) => ({ ...prev, lotId: '' }));
              }}
            />
          </View>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>批次信息</Text>
          {inTransactionType === 'existing' ? (
            inLotOptions.length === 0 ? (
              <EmptyOptions
                title="暂无可用批次"
                hint="请选择“新建批次”来创建库存批次。"
              />
            ) : (
              <Picker
                label="选择批次 *"
                placeholder="请选择要入库的批次"
                value={formData.lotId}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, lotId: value }))}
                options={inLotOptions}
              />
            )
          ) : (
            <>
              <Picker
                label="选择耗材 *"
                placeholder="请选择耗材"
                value={formData.materialId}
                onValueChange={handleMaterialChange}
                options={materialOptions}
              />
              <Input
                label="批次号 *"
                placeholder="例如 LOT-2026-001"
                value={formData.lotNo}
                onChangeText={(text) => setFormData((prev) => ({ ...prev, lotNo: text }))}
              />
              <Input
                label="位置"
                placeholder="请输入存放位置"
                value={formData.location}
                onChangeText={(text) => setFormData((prev) => ({ ...prev, location: text }))}
              />
            </>
          )}
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>入库信息</Text>
          <Input
            label="入库数量 (g) *"
            placeholder="请输入入库数量"
            value={formData.qty}
            onChangeText={(text) => setFormData((prev) => ({ ...prev, qty: text }))}
            keyboardType="decimal-pad"
          />
          <Input
            label="备注"
            placeholder="请输入备注信息"
            value={formData.notes}
            onChangeText={(text) => setFormData((prev) => ({ ...prev, notes: text }))}
            multiline
            numberOfLines={3}
          />
        </Card>

        <FormButtons
          loading={loading}
          submitTitle="确认入库"
          loadingTitle="提交中..."
          submitVariant="success"
          submitIcon="checkmark-outline"
          onSubmit={handleSubmit}
          onCancel={() => navigation.goBack()}
        />
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

const FormHeader = ({ icon, eyebrow, title, subtitle, color }) => (
  <View style={styles.header}>
    <View style={[styles.headerIcon, { backgroundColor: `${color}18` }]}>
      <Ionicons name={icon} size={24} color={color} />
    </View>
    <View style={styles.headerText}>
      <Text style={[styles.eyebrow, { color }]}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  </View>
);

const SegmentButton = ({ label, active, onPress }) => (
  <TouchableOpacity
    activeOpacity={0.82}
    onPress={onPress}
    style={[styles.segmentButton, active && styles.segmentButtonActive]}
  >
    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
  </TouchableOpacity>
);

const EmptyOptions = ({ title, hint }) => (
  <View style={styles.emptyOptionsContainer}>
    <Text style={styles.emptyOptionsText}>{title}</Text>
    <Text style={styles.emptyOptionsHint}>{hint}</Text>
  </View>
);

const FormButtons = ({
  loading,
  submitTitle,
  loadingTitle,
  submitVariant,
  submitIcon,
  onSubmit,
  onCancel,
}) => (
  <View style={styles.buttonContainer}>
    <Button
      title={loading ? loadingTitle : submitTitle}
      iconLeft={submitIcon}
      onPress={onSubmit}
      disabled={loading}
      loading={loading}
      variant={submitVariant}
      fullWidth
      style={styles.submitButton}
    />
    <Button title="取消" onPress={onCancel} variant="outline" fullWidth />
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
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    ...TYPOGRAPHY.caption,
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
  segmentedControl: {
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.xs,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
  },
  segmentButton: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
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
  buttonContainer: {
    marginTop: SPACING.sm,
  },
  submitButton: {
    marginBottom: SPACING.md,
  },
});

export default InboundTransactionScreen;
