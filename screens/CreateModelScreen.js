import React, { useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { COLORS, RADIUS, ROUTES, SPACING, TYPOGRAPHY } from '../constants';
import { Button, Card, Input } from '../components';
import { isAuthRequiredError, modelsAPI } from '../utils/api';
import { pickerAssetToFormFile, validateExtension } from '../utils/upload';

const SOURCE_OPTIONS = [
  { value: 'original', label: '原创' },
  { value: 'remix', label: '二创' },
  { value: 'imported', label: '导入' },
];

const IMAGE_TYPE_OPTIONS = [
  { value: 'cover', label: '封面图' },
  { value: 'real_print', label: '实物打印图' },
  { value: 'other', label: '其他图片' },
];

const MODEL_EXTENSIONS = ['stl', 'obj', '3mf', 'step', 'stp', 'zip'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

const CreateModelScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(false);
  const [selectedModelFile, setSelectedModelFile] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageType, setImageType] = useState('cover');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    source: 'original',
  });

  const pickModelFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      if (!validateExtension(asset, MODEL_EXTENSIONS)) {
        Alert.alert('文件格式不支持', '请选择 STL、OBJ、3MF、STEP、STP 或 ZIP 模型文件');
        return;
      }
      setSelectedModelFile(asset);
    } catch (error) {
      Alert.alert('错误', '选择模型文件失败');
    }
  };

  const pickImage = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      if (!validateExtension(asset, IMAGE_EXTENSIONS)) {
        Alert.alert('图片格式不支持', '请选择 JPG、PNG 或 WEBP 图片');
        return;
      }
      setSelectedImage(asset);
    } catch (error) {
      Alert.alert('错误', '选择图片失败');
    }
  };

  const validateForm = () => {
    if (!formData.name.trim()) {
      Alert.alert('验证失败', '请输入模型名称');
      return false;
    }
    if (!formData.description.trim()) {
      Alert.alert('验证失败', '请输入模型描述');
      return false;
    }
    if (!formData.source) {
      Alert.alert('验证失败', '请选择模型来源');
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
      const newModel = await modelsAPI.create({
        name: formData.name.trim(),
        description: formData.description.trim(),
        source: formData.source,
      });

      if (selectedModelFile) {
        await modelsAPI.uploadModelFile(newModel.id, pickerAssetToFormFile(selectedModelFile));
      }

      if (selectedImage) {
        await modelsAPI.uploadImage(newModel.id, pickerAssetToFormFile(selectedImage), imageType);
      }

      Alert.alert('成功', '模型创建成功', [
        {
          text: '查看模型',
          onPress: () => navigation.replace(ROUTES.MODEL_DETAIL, { modelId: newModel.id }),
        },
        { text: '返回列表', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      console.error('创建模型失败:', error);
      Alert.alert('错误', error.message || '创建模型失败，请检查网络连接或稍后重试');
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
            <Ionicons name="cube-outline" size={24} color={COLORS.primary} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>NEW MODEL</Text>
            <Text style={styles.title}>新建模型</Text>
            <Text style={styles.subtitle}>录入模型信息，并可同时上传模型文件和图片。</Text>
          </View>
        </View>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>基本信息</Text>
          <Input
            label="模型名称 *"
            placeholder="请输入模型名称"
            value={formData.name}
            onChangeText={(text) => setFormData({ ...formData, name: text })}
          />
          <Input
            label="模型描述 *"
            placeholder="请输入模型用途、特点或打印说明"
            value={formData.description}
            onChangeText={(text) => setFormData({ ...formData, description: text })}
            multiline
            numberOfLines={4}
          />
          <Text style={styles.fieldLabel}>来源 *</Text>
          <View style={styles.optionRow}>
            {SOURCE_OPTIONS.map((option) => (
              <OptionButton
                key={option.value}
                label={option.label}
                active={formData.source === option.value}
                onPress={() => setFormData({ ...formData, source: option.value })}
              />
            ))}
          </View>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>模型文件</Text>
          <Text style={styles.helperText}>
            支持 STL、OBJ、3MF、STEP、STP、ZIP。上传后系统会尽量生成自动预览图。
          </Text>
          {selectedModelFile ? <SelectedFile asset={selectedModelFile} /> : null}
          <Button
            title={selectedModelFile ? '重新选择模型文件' : '选择模型文件'}
            iconLeft="document-attach-outline"
            onPress={pickModelFile}
            variant="outline"
            fullWidth
          />
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>模型图片</Text>
          <Text style={styles.helperText}>
            可以先上传封面图或实物打印图，之后也可以在详情页继续添加。
          </Text>
          <Text style={styles.fieldLabel}>图片类型</Text>
          <View style={styles.optionRow}>
            {IMAGE_TYPE_OPTIONS.map((option) => (
              <OptionButton
                key={option.value}
                label={option.label}
                active={imageType === option.value}
                onPress={() => setImageType(option.value)}
              />
            ))}
          </View>
          {selectedImage ? <SelectedFile asset={selectedImage} /> : null}
          <Button
            title={selectedImage ? '重新选择图片' : '选择图片'}
            iconLeft="image-outline"
            onPress={pickImage}
            variant="outline"
            fullWidth
          />
        </Card>

        <View style={styles.buttonContainer}>
          <Button
            title={loading ? '创建中...' : '创建模型'}
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

const OptionButton = ({ label, active, onPress }) => (
  <TouchableOpacity
    activeOpacity={0.82}
    style={[styles.optionButton, active && styles.optionButtonActive]}
    onPress={onPress}
  >
    <Text style={[styles.optionText, active && styles.optionTextActive]}>{label}</Text>
  </TouchableOpacity>
);

const SelectedFile = ({ asset }) => (
  <View style={styles.fileInfo}>
    <Ionicons name="document-text-outline" size={18} color={COLORS.primary} />
    <View style={styles.fileTextGroup}>
      <Text style={styles.fileName} numberOfLines={1}>{asset.name}</Text>
      {asset.size ? <Text style={styles.fileMeta}>{Math.round(asset.size / 1024)} KB</Text> : null}
    </View>
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
  fieldLabel: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  helperText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  optionButton: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceMuted,
  },
  optionButtonActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primarySoft,
  },
  optionText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  optionTextActive: {
    color: COLORS.primary,
  },
  fileInfo: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
    marginBottom: SPACING.md,
  },
  fileTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
  },
  fileMeta: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  buttonContainer: {
    marginTop: SPACING.sm,
  },
  submitButton: {
    marginBottom: SPACING.md,
  },
});

export default CreateModelScreen;
