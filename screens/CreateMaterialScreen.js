import React, { useState } from 'react';
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
import { COLORS, ROUTES, MATERIAL_TYPES, UNITS } from '../constants';
import { Card, Button, Input, Picker } from '../components';
import { materialsAPI } from '../utils/api';

// 材质类型选项
const MATERIAL_TYPE_OPTIONS = Object.values(MATERIAL_TYPES).map(type => ({
  value: type,
  label: type,
}));

// 计量单位选项
const UNIT_OPTIONS = Object.entries(UNITS).map(([key, value]) => ({
  value: value,
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

  // 验证表单
  const validateForm = () => {
    if (!formData.type) {
      Alert.alert('验证失败', '请选择材质类型');
      return false;
    }
    // 如果选择了"其它材质"，必须输入自定义材质类型
    if (formData.type === MATERIAL_TYPES.OTHER && !customMaterialType.trim()) {
      Alert.alert('验证失败', '请输入材质类型');
      return false;
    }
    if (!formData.brand.trim()) {
      Alert.alert('验证失败', '请输入品牌');
      return false;
    }
    // 直径验证：如果填写了，必须是有效数字；如果不填写，将使用默认值1.75
    if (formData.diameter && (isNaN(parseFloat(formData.diameter)) || parseFloat(formData.diameter) <= 0)) {
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

  // 提交物料
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
        '物料创建成功！',
        [
          {
            text: '查看物料',
            onPress: () => {
              navigation.replace(ROUTES.MATERIAL_DETAIL, { materialId: newMaterial.id });
            },
          },
          {
            text: '返回列表',
            onPress: () => {
              navigation.goBack();
            },
          },
        ]
      );
    } catch (error) {
      console.error('创建物料失败:', error);
      Alert.alert('错误', '创建物料失败，请检查网络连接或稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
        {/* 基本信息 */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>基本信息</Text>
          
          <Picker
            label="材质类型 *"
            placeholder="请选择材质类型"
            value={formData.type}
            onValueChange={(value) => {
              setFormData({ ...formData, type: value });
              // 如果切换为非"其它材质"，清空自定义输入
              if (value !== MATERIAL_TYPES.OTHER) {
                setCustomMaterialType('');
              }
            }}
            options={MATERIAL_TYPE_OPTIONS}
          />

          {formData.type === MATERIAL_TYPES.OTHER && (
            <Input
              label="请输入材质类型 *"
              placeholder="请输入材质类型"
              value={customMaterialType}
              onChangeText={(text) => setCustomMaterialType(text)}
            />
          )}

          <Input
            label="品牌 *"
            placeholder="请输入品牌名称"
            value={formData.brand}
            onChangeText={(text) => setFormData({ ...formData, brand: text })}
          />

          <Input
            label="直径 (mm)"
            placeholder="请输入直径，默认1.75"
            value={formData.diameter}
            onChangeText={(text) => setFormData({ ...formData, diameter: text })}
            keyboardType="decimal-pad"
          />

          <Input
            label="颜色 *"
            placeholder="请输入颜色"
            value={formData.color}
            onChangeText={(text) => setFormData({ ...formData, color: text })}
          />
        </Card>

        {/* 价格信息 */}
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

        {/* 备注 */}
        <Card style={styles.section}>
          <Input
            label="备注"
            placeholder="物料备注信息"
            value={formData.notes}
            onChangeText={(text) => setFormData({ ...formData, notes: text })}
            multiline
            numberOfLines={3}
          />
        </Card>

        {/* 提交按钮 */}
        <View style={styles.buttonContainer}>
          <Button
            title={loading ? '创建中...' : '创建物料'}
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
  rowInputs: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  halfInput: {
    width: '48%',
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

export default CreateMaterialScreen;

