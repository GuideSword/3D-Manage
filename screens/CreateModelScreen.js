import React, { useRef, useState } from 'react';
import {
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { RADIUS, ROUTES, SPACING, TYPOGRAPHY } from '../constants';
import { Button, Card, Input } from '../components';
import { useAppTheme } from '../context/ThemeContext';
import { isAuthRequiredError, modelsAPI } from '../utils/api';
import { pickerAssetToFormFile, validateExtension } from '../utils/upload';
import { trackPickedAsset } from '../utils/sessionStorage';
import { useEditRecord } from '../utils/useEditRecord';
import EditLoadState from '../components/EditLoadState';
import { useServerConfig } from '../context/ServerConfigContext';
import { useMasterDataMutation } from '../utils/useMasterDataMutation';
import masterDataCore from '../utils/masterDataCore.cjs';
import catalogCore from '../utils/relationalCatalogCore.cjs';
import { relationalModelsAPI } from '../utils/relationalCatalogApi';

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

const CreateModelScreen = ({ navigation, route }) => {
  const modelId = route.params?.modelId;
  const isEditing = Boolean(modelId);
  const submitting = useRef(false);
  const { server } = useServerConfig();
  const relational = masterDataCore.supportsMasterData(server);
  const mutation = useMasterDataMutation(navigation);
  const recordAPI = relational ? relationalModelsAPI : modelsAPI;
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState('');
  const locked = loading || (relational && (mutation.loading || Boolean(mutation.pending) || mutation.conflict));
  const [selectedModelFile, setSelectedModelFile] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageType, setImageType] = useState('cover');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    source: 'original',
  });
  const { record, loadingRecord, loadError, reload } = useEditRecord(modelId, recordAPI, (model) => {
    if (relational) { mutation.resetAfterLoad(); setSaveError(''); }
    setFormData({ name: model.name || '', description: model.description || '', source: model.source || 'original' });
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
      await trackPickedAsset(asset);
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
      await trackPickedAsset(asset);
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
    if (relational) {
      try { catalogCore.catalogChanges('models', formData, { creating: !isEditing }); return true; }
      catch (error) { setSaveError(error.message); return false; }
    }
    if (!formData.name.trim()) {
      setSaveError('请输入模型名称');
      Alert.alert('验证失败', '请输入模型名称');
      return false;
    }
    if (!formData.description.trim()) {
      setSaveError('请输入模型描述');
      Alert.alert('验证失败', '请输入模型描述');
      return false;
    }
    if (!formData.source) {
      setSaveError('请选择模型来源');
      Alert.alert('验证失败', '请选择模型来源');
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
      if (relational && (selectedModelFile || selectedImage)) {
        throw new Error('当前服务器暂不支持附件上传，请稍后重试');
      }
      const payload = relational ? catalogCore.catalogPayload('models', formData, record) : {
        name: formData.name.trim(), description: formData.description.trim(), source: formData.source,
      };
      const newModel = relational ? await mutation.run(isEditing ? 'model.update' : 'model.create', payload,
        (body, key) => isEditing ? relationalModelsAPI.update(body.id, { version: body.version, changes: body.changes }, key)
          : relationalModelsAPI.create(body, key))
        : isEditing ? await modelsAPI.update(modelId, payload) : await modelsAPI.create(payload);
      if (newModel === null) return;
      if (isEditing) { navigation.goBack(); return; }

      if (selectedModelFile) {
        await modelsAPI.uploadModelFile(newModel.id, pickerAssetToFormFile(selectedModelFile));
      }

      if (selectedImage) {
        await modelsAPI.uploadImage(newModel.id, pickerAssetToFormFile(selectedImage), imageType);
      }

      if (Platform.OS === 'web') {
        navigation.replace(ROUTES.MODEL_DETAIL, { modelId: newModel.id });
        return;
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
      console.error('保存模型失败:', error);
      setSaveError(error.message || '保存模型失败，请重试');
      Alert.alert('错误', error.message || '保存模型失败，请检查网络连接或稍后重试');
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
            <Ionicons name="cube-outline" size={24} color={colors.primary} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>{isEditing ? 'EDIT MODEL' : 'NEW MODEL'}</Text>
            <Text style={styles.title}>{isEditing ? '编辑模型' : '新建模型'}</Text>
            <Text style={styles.subtitle}>{isEditing ? '修改基础资料，文件和图片可在详情页管理。' : '录入模型信息，并可同时上传模型文件和图片。'}</Text>
          </View>
        </View>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>基本信息</Text>
          <Input
            editable={!locked}
            label="模型名称 *"
            placeholder="请输入模型名称"
            value={formData.name}
            onChangeText={(text) => setFormData({ ...formData, name: text })}
          />
          <Input
            editable={!locked}
            label={relational ? '模型描述' : '模型描述 *'}
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
                onPress={() => { if (!locked) setFormData({ ...formData, source: option.value }); }}
              />
            ))}
          </View>
        </Card>

        {!isEditing ? <Card style={styles.section}>
          <Text style={styles.sectionTitle}>模型文件</Text>
          <Text style={styles.helperText}>
            支持 STL、OBJ、3MF、STEP、STP、ZIP。上传后系统会尽量生成自动预览图。
          </Text>
          {selectedModelFile ? <SelectedFile asset={selectedModelFile} /> : null}
          <Button
            title={selectedModelFile ? '重新选择模型文件' : '选择模型文件'}
            iconLeft="document-attach-outline"
            disabled={locked}
            onPress={pickModelFile}
            variant="outline"
            fullWidth
          />
        </Card> : null}

        {!isEditing ? <Card style={styles.section}>
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
                onPress={() => { if (!locked) setImageType(option.value); }}
              />
            ))}
          </View>
          {selectedImage ? <SelectedFile asset={selectedImage} /> : null}
          <Button
            title={selectedImage ? '重新选择图片' : '选择图片'}
            iconLeft="image-outline"
            disabled={locked}
            onPress={pickImage}
            variant="outline"
            fullWidth
          />
        </Card> : null}

        <View style={styles.buttonContainer}>
          {(saveError || mutation.error) ? <Text style={{ color: colors.danger }}>{saveError || mutation.error}</Text> : null}
          {relational && mutation.pending && !mutation.loading ? <Text>上次操作结果尚未确认，请重试原操作。</Text> : null}
          {relational && mutation.conflict ? <Button title="重新加载原记录" variant="outline" onPress={reload} /> : null}
          <Button
            title={loading ? '保存中...' : relational && mutation.pending ? '重试原操作' : isEditing ? '保存修改' : '创建模型'}
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

const OptionButton = ({ label, active, onPress }) => {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  return (
  <TouchableOpacity
    activeOpacity={0.82}
    style={[styles.optionButton, active && styles.optionButtonActive]}
    onPress={onPress}
  >
    <Text style={[styles.optionText, active && styles.optionTextActive]}>{label}</Text>
  </TouchableOpacity>
  );
};

const SelectedFile = ({ asset }) => {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  return (
  <View style={styles.fileInfo}>
    <Ionicons name="document-text-outline" size={18} color={colors.primary} />
    <View style={styles.fileTextGroup}>
      <Text style={styles.fileName} numberOfLines={1}>{asset.name}</Text>
      {asset.size ? <Text style={styles.fileMeta}>{Math.round(asset.size / 1024)} KB</Text> : null}
    </View>
  </View>
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
