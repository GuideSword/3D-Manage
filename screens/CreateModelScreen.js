import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { COLORS, ROUTES } from '../constants';
import { Card, Button, Input } from '../components';
import { modelsAPI } from '../utils/api';

const CreateModelScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    length: '', // 长度 (mm)
    width: '', // 宽度 (mm)
    height: '', // 高度 (mm)
    estimatedMaterialGrams: '', // 大概所需耗材克数
    notes: '',
  });

  // 验证表单
  const validateForm = () => {
    if (!formData.name.trim()) {
      Alert.alert('验证失败', '请输入模型名称');
      return false;
    }
    if (!formData.length || parseFloat(formData.length) <= 0) {
      Alert.alert('验证失败', '请输入有效的长度');
      return false;
    }
    if (!formData.width || parseFloat(formData.width) <= 0) {
      Alert.alert('验证失败', '请输入有效的宽度');
      return false;
    }
    if (!formData.height || parseFloat(formData.height) <= 0) {
      Alert.alert('验证失败', '请输入有效的高度');
      return false;
    }
    if (!formData.estimatedMaterialGrams || parseFloat(formData.estimatedMaterialGrams) <= 0) {
      Alert.alert('验证失败', '请输入有效的耗材克数');
      return false;
    }
    return true;
  };

  // 提交模型
  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);

      const modelData = {
        name: formData.name.trim(),
        dimensions: `${formData.length}x${formData.width}x${formData.height}`,
        estimatedMaterialGrams: parseFloat(formData.estimatedMaterialGrams),
        notes: formData.notes.trim() || undefined,
      };

      const newModel = await modelsAPI.create(modelData);

      Alert.alert(
        '成功',
        '模型创建成功！',
        [
          {
            text: '查看模型',
            onPress: () => {
              navigation.replace(ROUTES.MODEL_DETAIL, { modelId: newModel.id });
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
      console.error('创建模型失败:', error);
      Alert.alert('错误', '创建模型失败，请检查网络连接或稍后重试');
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
          
          <Input
            label="模型名称 *"
            placeholder="请输入模型名称"
            value={formData.name}
            onChangeText={(text) => setFormData({ ...formData, name: text })}
          />

          <View style={styles.dimensionsContainer}>
            <Text style={styles.dimensionsLabel}>尺寸 (mm) *</Text>
            <View style={styles.dimensionsRow}>
              <View style={[styles.dimensionInput, styles.dimensionInputFirst]}>
                <Input
                  label="长"
                  placeholder="长度"
                  value={formData.length}
                  onChangeText={(text) => setFormData({ ...formData, length: text })}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.dimensionInput}>
                <Input
                  label="宽"
                  placeholder="宽度"
                  value={formData.width}
                  onChangeText={(text) => setFormData({ ...formData, width: text })}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={[styles.dimensionInput, styles.dimensionInputLast]}>
                <Input
                  label="高"
                  placeholder="高度"
                  value={formData.height}
                  onChangeText={(text) => setFormData({ ...formData, height: text })}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
          </View>

          <Input
            label="大概所需耗材克数 (g) *"
            placeholder="请输入大概所需耗材克数"
            value={formData.estimatedMaterialGrams}
            onChangeText={(text) => setFormData({ ...formData, estimatedMaterialGrams: text })}
            keyboardType="decimal-pad"
          />
        </Card>

        {/* 备注 */}
        <Card style={styles.section}>
          <Input
            label="备注"
            placeholder="模型备注信息"
            value={formData.notes}
            onChangeText={(text) => setFormData({ ...formData, notes: text })}
            multiline
            numberOfLines={3}
          />
        </Card>

        {/* 提交按钮 */}
        <View style={styles.buttonContainer}>
          <Button
            title={loading ? '创建中...' : '创建模型'}
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
  dimensionsContainer: {
    marginBottom: 16,
  },
  dimensionsLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  dimensionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dimensionInput: {
    flex: 1,
    marginHorizontal: 4,
  },
  dimensionInputFirst: {
    marginLeft: 0,
  },
  dimensionInputLast: {
    marginRight: 0,
  },
});

export default CreateModelScreen;

