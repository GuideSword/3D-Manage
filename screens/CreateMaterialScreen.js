import React, { useRef, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  Platform,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  MATERIAL_TYPES,
  RADIUS,
  ROUTES,
  SPACING,
  TYPOGRAPHY,
  UNITS,
} from '../constants';
import { Button, Card, Input, Picker } from '../components';
import { useAppTheme } from '../context/ThemeContext';
import { isAuthRequiredError, materialsAPI } from '../utils/api';
import { useEditRecord } from '../utils/useEditRecord';
import { isPositiveNumber } from '../utils/editFormCore.cjs';
import EditLoadState from '../components/EditLoadState';
import { useServerConfig } from '../context/ServerConfigContext';
import { useMasterDataMutation } from '../utils/useMasterDataMutation';
import masterDataCore from '../utils/masterDataCore.cjs';
import catalogCore from '../utils/relationalCatalogCore.cjs';
import { relationalMaterialsAPI } from '../utils/relationalCatalogApi';

const MATERIAL_TYPE_OPTIONS = Object.values(MATERIAL_TYPES).map((type) => ({
  value: type,
  label: type,
}));

const UNIT_OPTIONS = Object.values(UNITS).map((value) => ({
  value,
  label: value,
}));

const CreateMaterialScreen = ({ navigation, route }) => {
  const materialId = route.params?.materialId;
  const isEditing = Boolean(materialId);
  const submitting = useRef(false);
  const { server } = useServerConfig();
  const relational = masterDataCore.supportsMasterData(server);
  const mutation = useMasterDataMutation(navigation);
  const recordAPI = relational ? relationalMaterialsAPI : materialsAPI;
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState('');
  const locked = loading || (relational && (mutation.loading || Boolean(mutation.pending) || mutation.conflict));
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
  const { record, loadingRecord, loadError, reload } = useEditRecord(materialId, recordAPI, (material) => {
    if (relational) { mutation.resetAfterLoad(); setSaveError(''); }
    const type = material.type || material.materialType || '';
    const custom = !MATERIAL_TYPE_OPTIONS.some((option) => option.value === type);
    setCustomMaterialType(custom ? type : '');
    setFormData({ type: custom ? MATERIAL_TYPES.OTHER : type, brand: material.brand || '',
      diameter: material.diameter == null && relational ? '' : String(material.diameter ?? '1.75'), color: material.color || '',
      unitPrice: String(material.unitPrice ?? material.unit_price ?? ''), unit: material.unit || UNITS.KILOGRAM,
      notes: material.notes || '' });
  });

  const relationalForm = () => ({ ...formData, type: formData.type === MATERIAL_TYPES.OTHER ? customMaterialType.trim() : formData.type });
  const validateForm = () => {
    if (relational) {
      try { catalogCore.catalogChanges('materials', relationalForm(), { creating: !isEditing }); return true; }
      catch (error) { setSaveError(error.message); return false; }
    }
    if (!formData.type) {
      setSaveError('请选择材质类型');
      Alert.alert('验证失败', '请选择材质类型');
      return false;
    }
    if (formData.type === MATERIAL_TYPES.OTHER && !customMaterialType.trim()) {
      setSaveError('请输入材质类型');
      Alert.alert('验证失败', '请输入材质类型');
      return false;
    }
    if (!formData.brand.trim()) {
      setSaveError('请输入品牌');
      Alert.alert('验证失败', '请输入品牌');
      return false;
    }
    if (formData.diameter && !isPositiveNumber(formData.diameter)) {
      setSaveError('请输入有效的直径（mm）');
      Alert.alert('验证失败', '请输入有效的直径（mm）');
      return false;
    }
    if (!formData.color.trim()) {
      setSaveError('请输入颜色');
      Alert.alert('验证失败', '请输入颜色');
      return false;
    }
    if (!isPositiveNumber(formData.unitPrice)) {
      setSaveError('请输入有效的单价');
      Alert.alert('验证失败', '请输入有效的单价');
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (submitting.current || (isEditing && !record) || !validateForm()) {
      return;
    }

    try {
      submitting.current = true;
      setSaveError('');
      setLoading(true);
      const materialData = relational ? null : {
        type: formData.type === MATERIAL_TYPES.OTHER ? customMaterialType.trim() : formData.type,
        brand: formData.brand.trim(),
        diameter: Number(formData.diameter) || 1.75,
        color: formData.color.trim(),
        unitPrice: Number(formData.unitPrice),
        unit: formData.unit,
        notes: formData.notes.trim(),
      };

      const payload = relational ? catalogCore.catalogPayload('materials', relationalForm(), record) : materialData;
      const newMaterial = relational ? await mutation.run(isEditing ? 'material.update' : 'material.create', payload,
        (body, key) => isEditing ? relationalMaterialsAPI.update(body.id, { version: body.version, changes: body.changes }, key)
          : relationalMaterialsAPI.create(body, key))
        : isEditing ? await materialsAPI.update(materialId, materialData) : await materialsAPI.create(materialData);
      if (newMaterial === null) return;
      if (isEditing) { navigation.goBack(); return; }

      if (Platform.OS === 'web') {
        navigation.replace(ROUTES.MATERIAL_DETAIL, { materialId: newMaterial.id });
        return;
      }

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
      console.error('保存耗材失败:', error);
      const message = error?.message
        ? `保存耗材失败：${error.message}`
        : '保存耗材失败，请检查网络连接或稍后重试';
      Alert.alert('错误', message);
      setSaveError(message);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  if (isEditing && !record) return <EditLoadState loading={loadingRecord} error={loadError} onRetry={reload} onCancel={() => navigation.goBack()} />;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons name="layers-outline" size={24} color={colors.accent} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>{isEditing ? 'EDIT MATERIAL' : 'NEW MATERIAL'}</Text>
            <Text style={styles.title}>{isEditing ? '编辑耗材' : '新建耗材'}</Text>
            <Text style={styles.subtitle}>录入材质、品牌、颜色和计价单位。</Text>
          </View>
        </View>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>基本信息</Text>
          <Picker
            disabled={locked}
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
            editable={!locked}
              label="自定义材质类型 *"
              placeholder="请输入材质类型"
              value={customMaterialType}
              onChangeText={setCustomMaterialType}
            />
          ) : null}
          <Input
            editable={!locked}
            label="品牌 *"
            placeholder="请输入品牌名称"
            value={formData.brand}
            onChangeText={(text) => setFormData({ ...formData, brand: text })}
          />
          <View style={styles.rowInputs}>
            <View style={styles.halfInput}>
              <Input
            editable={!locked}
                label="直径 (mm)"
                placeholder="默认 1.75"
                value={formData.diameter}
                onChangeText={(text) => setFormData({ ...formData, diameter: text })}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.halfInput}>
              <Input
            editable={!locked}
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
            editable={!locked}
                label="单价 *"
                placeholder="单价"
                value={formData.unitPrice}
                onChangeText={(text) => setFormData({ ...formData, unitPrice: text })}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.halfInput}>
              <Picker
            disabled={locked}
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
            editable={!locked}
            label="备注"
            placeholder="耗材备注信息"
            value={formData.notes}
            onChangeText={(text) => setFormData({ ...formData, notes: text })}
            multiline
            numberOfLines={3}
          />
        </Card>

        <View style={styles.buttonContainer}>
          {(saveError || mutation.error) ? <Text style={{ color: colors.danger }}>{saveError || mutation.error}</Text> : null}
          {relational && mutation.pending && !mutation.loading ? <Text>上次操作结果尚未确认，请重试原操作。</Text> : null}
          {relational && mutation.conflict ? <Button title="重新加载原记录" variant="outline" onPress={reload} /> : null}
          <Button
            title={loading ? '保存中...' : relational && mutation.pending ? '重试原操作' : isEditing ? '保存修改' : '创建耗材'}
            iconLeft="checkmark-outline"
            onPress={handleSubmit}
            disabled={loading || (relational && mutation.conflict)}
            loading={loading}
            fullWidth
            style={styles.submitButton}
          />
          <Button
            title="取消"
            disabled={locked && !mutation.conflict}
            onPress={() => navigation.goBack()}
            variant="outline"
            fullWidth
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
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
