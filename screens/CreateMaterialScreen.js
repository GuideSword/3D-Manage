import React, { useState } from 'react';
import {
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
  MATERIAL_TYPES,
  RADIUS,
  ROUTES,
  SPACING,
  TYPOGRAPHY,
  UNITS,
} from '../constants';
import { Button, Card, Input, Picker } from '../components';
import { isAuthRequiredError, materialsAPI } from '../utils/api';

const MATERIAL_TYPE_OPTIONS = Object.values(MATERIAL_TYPES).map((type) => ({
  value: type,
  label: type,
}));

const UNIT_OPTIONS = Object.values(UNITS).map((value) => ({
  value,
  label: value,
}));

const CreateMaterialScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(false);
  const [customMaterialType, setCustomMaterialType] = useState('');
  const [formData, setFormData] = useState({
    type: '',
    brand: '',
    diameter: '1.75',
    color: '',
    unitPrice: '25',
    unit: UNITS.KILOGRAM,
    notes: '',
  });

  const validateForm = () => {
    if (!formData.type) {
      Alert.alert('验证失败', '请选择材质类型');
      return false;
    }
    if (formData.type === MATERIAL_TYPES.OTHER && !customMaterialType.trim()) {
      Alert.alert('验证失败', '请输入材质类型');
      return false;
    }
    if (!formData.brand.trim()) {
      Alert.alert('验证失败', '请输入品牌');
      return false;
    }
    if (formData.diameter && (Number.isNaN(parseFloat(formData.diameter)) || parseFloat(formData.diameter) <= 0)) {
      Alert.alert('验证失败', '请输入有效的直径（mm）');
      return false;
    }
    if (!formData.color.trim()) {
      Alert.alert('验证失败', '请输入颜色');
      return false;
    }
    if (!formData.unitPrice || parseFloat(formData.unitPrice) <= 0) {
      Alert.alert('验证失败', '请输入有效的单价');
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
      const materialData = {
        type: formData.type === MATERIAL_TYPES.OTHER ? customMaterialType.trim() : formData.type,
        brand: formData.brand.trim(),
        diameter: parseFloat(formData.diameter) || 1.75,
        color: formData.color.trim(),
        unitPrice: parseFloat(formData.unitPrice),
        unit: formData.unit,
        notes: formData.notes.trim() || undefined,
      };

      const newMaterial = await materialsAPI.create(materialData);

      Alert.alert(
        '成功',
        '耗材创建成功',
        [
          {
            text: '查看耗材',
            onPress: () => {
              navigation.replace(ROUTES.MATERIAL_DETAIL, { materialId: newMaterial.id });
            },
          },
          { text: '返回列表', onPress: () => navigation.goBack() },
        ]
      );
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      console.error('创建耗材失败:', error);
      Alert.alert('错误', '创建耗材失败，请检查网络连接或稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons name="layers-outline" size={24} color={COLORS.accent} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>NEW MATERIAL</Text>
            <Text style={styles.title}>新建耗材</Text>
            <Text style={styles.subtitle}>录入材质、品牌、颜色和计价单位。</Text>
          </View>
        </View>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>基本信息</Text>
          <Picker
            label="材质类型 *"
            placeholder="请选择材质类型"
            value={formData.type}
            onValueChange={(value) => {
              setFormData({ ...formData, type: value });
              if (value !== MATERIAL_TYPES.OTHER) {
                setCustomMaterialType('');
              }
            }}
            options={MATERIAL_TYPE_OPTIONS}
          />
          {formData.type === MATERIAL_TYPES.OTHER ? (
            <Input
              label="自定义材质类型 *"
              placeholder="请输入材质类型"
              value={customMaterialType}
              onChangeText={setCustomMaterialType}
            />
          ) : null}
          <Input
            label="品牌 *"
            placeholder="请输入品牌名称"
            value={formData.brand}
            onChangeText={(text) => setFormData({ ...formData, brand: text })}
          />
          <View style={styles.rowInputs}>
            <View style={styles.halfInput}>
              <Input
                label="直径 (mm)"
                placeholder="默认 1.75"
                value={formData.diameter}
                onChangeText={(text) => setFormData({ ...formData, diameter: text })}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.halfInput}>
              <Input
                label="颜色 *"
                placeholder="请输入颜色"
                value={formData.color}
                onChangeText={(text) => setFormData({ ...formData, color: text })}
              />
            </View>
          </View>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>价格信息</Text>
          <View style={styles.rowInputs}>
            <View style={styles.halfInput}>
              <Input
                label="单价 *"
                placeholder="单价"
                value={formData.unitPrice}
                onChangeText={(text) => setFormData({ ...formData, unitPrice: text })}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.halfInput}>
              <Picker
                label="计量单位 *"
                placeholder="请选择单位"
                value={formData.unit}
                onValueChange={(value) => setFormData({ ...formData, unit: value })}
                options={UNIT_OPTIONS}
              />
            </View>
          </View>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>备注</Text>
          <Input
            label="备注"
            placeholder="耗材备注信息"
            value={formData.notes}
            onChangeText={(text) => setFormData({ ...formData, notes: text })}
            multiline
            numberOfLines={3}
          />
        </Card>

        <View style={styles.buttonContainer}>
          <Button
            title={loading ? '创建中...' : '创建耗材'}
            iconLeft="checkmark-outline"
            onPress={handleSubmit}
            disabled={loading}
            loading={loading}
            fullWidth
            style={styles.submitButton}
          />
          <Button
            title="取消"
            onPress={() => navigation.goBack()}
            variant="outline"
            fullWidth
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
  content: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
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
    backgroundColor: COLORS.accentSoft,
  },
  headerText: {
    flex: 1,
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
  rowInputs: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  halfInput: {
    flex: 1,
    minWidth: 0,
  },
  buttonContainer: {
    marginTop: SPACING.sm,
  },
  submitButton: {
    marginBottom: SPACING.md,
  },
});

export default CreateMaterialScreen;
