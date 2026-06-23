import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
  TouchableOpacity,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { COLORS, ROUTES } from '../constants';
import { Card, Button, Input } from '../components';
import { modelsAPI, isAuthRequiredError } from '../utils/api';
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
        await modelsAPI.uploadModelFile(
          newModel.id,
          pickerAssetToFormFile(selectedModelFile)
        );
      }

      if (selectedImage) {
        await modelsAPI.uploadImage(
          newModel.id,
          pickerAssetToFormFile(selectedImage),
          imageType
        );
      }

      Alert.alert('成功', '模型创建成功', [
        {
          text: '查看模型',
          onPress: () => navigation.replace(ROUTES.MODEL_DETAIL, { modelId: newModel.id }),
        },
        {
          text: '返回列表',
          onPress: () => navigation.goBack(),
        },
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
      <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
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
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionButton,
                  formData.source === option.value && styles.optionButtonActive,
                ]}
                onPress={() => setFormData({ ...formData, source: option.value })}
              >
                <Text
                  style={[
                    styles.optionText,
                    formData.source === option.value && styles.optionTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>模型文件</Text>
          <Text style={styles.helperText}>支持 STL、OBJ、3MF、STEP、STP、ZIP。上传后系统会尽量生成自动预览图。</Text>
          {selectedModelFile && (
            <View style={styles.fileInfo}>
              <Text style={styles.fileName}>{selectedModelFile.name}</Text>
              {selectedModelFile.size ? (
                <Text style={styles.fileMeta}>{Math.round(selectedModelFile.size / 1024)} KB</Text>
              ) : null}
            </View>
          )}
          <Button
            title={selectedModelFile ? '重新选择模型文件' : '选择模型文件'}
            onPress={pickModelFile}
            variant="outline"
            style={styles.fileButton}
          />
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>模型图片</Text>
          <Text style={styles.helperText}>可以先上传封面图或实物打印图；之后也可以在详情页继续添加。</Text>

          <Text style={styles.fieldLabel}>图片类型</Text>
          <View style={styles.optionRow}>
            {IMAGE_TYPE_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionButton,
                  imageType === option.value && styles.optionButtonActive,
                ]}
                onPress={() => setImageType(option.value)}
              >
                <Text
                  style={[
                    styles.optionText,
                    imageType === option.value && styles.optionTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {selectedImage && (
            <View style={styles.fileInfo}>
              <Text style={styles.fileName}>{selectedImage.name}</Text>
              {selectedImage.size ? (
                <Text style={styles.fileMeta}>{Math.round(selectedImage.size / 1024)} KB</Text>
              ) : null}
            </View>
          )}
          <Button
            title={selectedImage ? '重新选择图片' : '选择图片'}
            onPress={pickImage}
            variant="outline"
            style={styles.fileButton}
          />
        </Card>

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
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  helperText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: 12,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  optionButton: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: COLORS.background,
  },
  optionButtonActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  optionText: {
    fontSize: 14,
    color: COLORS.text,
  },
  optionTextActive: {
    color: COLORS.background,
    fontWeight: '600',
  },
  fileInfo: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  fileMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  fileButton: {
    marginTop: 4,
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

export default CreateModelScreen;
