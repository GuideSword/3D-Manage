import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { API_CONFIG, COLORS, RADIUS, SPACING, TYPOGRAPHY } from '../constants';
import { Badge, Button, Card } from '../components';
import { authAPI, isAuthRequiredError, modelsAPI } from '../utils/api';
import { pickerAssetToFormFile, validateExtension } from '../utils/upload';

const SOURCE_LABELS = {
  original: '原创',
  remix: '二创',
  imported: '导入',
};

const IMAGE_TYPE_LABELS = {
  cover: '封面图',
  real_print: '实物打印图',
  auto_preview: '自动预览图',
  other: '其他图片',
};

const IMAGE_TYPE_OPTIONS = [
  { value: 'cover', label: '封面图' },
  { value: 'real_print', label: '实物图' },
  { value: 'other', label: '其他' },
];

const MODEL_EXTENSIONS = ['stl', 'obj', '3mf', 'step', 'stp', 'zip'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

const buildAssetSource = (fileUrl, token) => {
  if (!fileUrl) {
    return null;
  }
  const apiRoot = API_CONFIG.BASE_URL.replace(/\/api\/?$/, '');
  const uri = fileUrl.startsWith('http')
    ? fileUrl
    : `${fileUrl.startsWith('/api') ? apiRoot : API_CONFIG.BASE_URL}${fileUrl}`;
  return {
    uri,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  };
};

const ModelDetailScreen = ({ route, navigation }) => {
  const { modelId } = route.params || {};
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [downloadingFileId, setDownloadingFileId] = useState(null);
  const [imageType, setImageType] = useState('cover');
  const [authToken, setAuthToken] = useState(null);

  const fetchModelDetail = async () => {
    if (!modelId) {
      Alert.alert('错误', '模型 ID 不存在');
      navigation.goBack();
      return;
    }

    try {
      setLoading(true);
      setAuthToken(await authAPI.getToken());
      const modelData = await modelsAPI.getById(modelId);
      setModel(modelData);
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      console.error('获取模型详情失败:', error);
      Alert.alert('错误', '获取模型详情失败', [
        { text: '确定', onPress: () => navigation.goBack() },
      ]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchModelDetail();
  }, [modelId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchModelDetail();
  };

  const deleteModel = async () => {
    try {
      setDeleting(true);
      await modelsAPI.delete(modelId);
      if (Platform.OS === 'web') {
        window.alert('模型已删除');
        navigation.goBack();
      } else {
        Alert.alert('成功', '模型已删除', [
          { text: '确定', onPress: () => navigation.goBack() },
        ]);
      }
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      Alert.alert('错误', error.message || '删除模型失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleDelete = () => {
    if (Platform.OS === 'web') {
      const confirmed = window.confirm('确定要删除这个模型吗？模型文件和图片也会一起删除。');
      if (confirmed) {
        deleteModel();
      }
      return;
    }

    Alert.alert(
      '确认删除',
      '确定要删除这个模型吗？模型文件和图片也会一起删除。',
      [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: deleteModel },
      ]
    );
  };

  const handleUploadFile = async () => {
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

      setUploadingFile(true);
      await modelsAPI.uploadModelFile(modelId, pickerAssetToFormFile(asset));
      Alert.alert('成功', '模型文件已上传');
      await fetchModelDetail();
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      Alert.alert('错误', error.message || '上传模型文件失败');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleUploadImage = async () => {
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

      setUploadingImage(true);
      await modelsAPI.uploadImage(modelId, pickerAssetToFormFile(asset), imageType);
      Alert.alert('成功', '图片已上传');
      await fetchModelDetail();
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      Alert.alert('错误', error.message || '上传图片失败');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleDownloadFile = async (file) => {
    try {
      setDownloadingFileId(file.id);
      await modelsAPI.downloadFile(file);
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
      Alert.alert('错误', error.message || '下载模型文件失败');
    } finally {
      setDownloadingFileId(null);
    }
  };

  if (loading && !model) {
    return <CenteredState icon="cube-outline" text="加载模型中..." loading />;
  }

  if (!model) {
    return (
      <CenteredState
        icon="cube-outline"
        text="模型不存在"
        actionLabel="返回"
        onAction={() => navigation.goBack()}
      />
    );
  }

  const sourceLabel = SOURCE_LABELS[model.source] || model.source || '未知';
  const images = model.images || [];
  const files = model.files || [];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        )}
      >
        <View style={styles.identity}>
          <View style={styles.identityIcon}>
            <Ionicons name="cube-outline" size={24} color={COLORS.primary} />
          </View>
          <View style={styles.identityText}>
            <Text style={styles.eyebrow}>MODEL ASSET</Text>
            <Text style={styles.title} numberOfLines={1}>{model.name || '未命名模型'}</Text>
          </View>
          <Badge text={sourceLabel} color={COLORS.accent} size="small" />
        </View>

        <Card style={styles.section}>
          <SectionHeader title="模型概览" />
          <Text style={styles.description}>{model.description || '暂无描述'}</Text>
          <View style={styles.summaryGrid}>
            <SummaryTile label="文件" value={String(files.length)} icon="document-outline" />
            <SummaryTile label="图片" value={String(images.length)} icon="image-outline" />
            <SummaryTile
              label="更新时间"
              value={model.updatedAt ? new Date(model.updatedAt).toLocaleDateString('zh-CN') : '未知'}
              icon="time-outline"
            />
          </View>
        </Card>

        <Card style={styles.section}>
          <SectionHeader title="图片" count={images.length} />
          {images.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gallery}>
              {images.map((image) => {
                const source = buildAssetSource(image.fileUrl, authToken);
                return (
                  <View key={image.id} style={styles.imageCard}>
                    {source ? (
                      <Image source={source} style={styles.galleryImage} resizeMode="cover" />
                    ) : (
                      <View style={styles.galleryFallback}>
                        <Ionicons name="image-outline" size={36} color={COLORS.textTertiary} />
                      </View>
                    )}
                    <Text style={styles.imageLabel} numberOfLines={1}>
                      {IMAGE_TYPE_LABELS[image.type] || image.type || '图片'}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            <EmptySection text="暂无图片" />
          )}
        </Card>

        <Card style={styles.section}>
          <SectionHeader title="模型文件" count={files.length} />
          {files.length > 0 ? files.map((file) => (
            <View key={file.id} style={styles.fileItem}>
              <View style={styles.fileIcon}>
                <Ionicons name="document-outline" size={20} color={COLORS.primary} />
              </View>
              <View style={styles.fileInfo}>
                <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                <Text style={styles.fileMeta}>
                  {String(file.type || '').toUpperCase()} · {file.size ? `${Math.round(file.size / 1024)} KB` : '未知大小'}
                </Text>
              </View>
              <Button
                title="下载"
                iconLeft="download-outline"
                size="small"
                variant="outline"
                onPress={() => handleDownloadFile(file)}
                loading={downloadingFileId === file.id}
                disabled={Boolean(downloadingFileId)}
                style={styles.downloadButton}
              />
            </View>
          )) : (
            <EmptySection text="暂无模型文件" />
          )}
        </Card>

        <Card style={styles.section}>
          <SectionHeader title="上传图片" />
          <View style={styles.optionRow}>
            {IMAGE_TYPE_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                activeOpacity={0.82}
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
          <Button
            title={uploadingImage ? '上传图片中...' : '上传图片'}
            iconLeft="image-outline"
            onPress={handleUploadImage}
            disabled={uploadingImage}
            loading={uploadingImage}
            fullWidth
          />
        </Card>

        <Card style={styles.section}>
          <SectionHeader title="文件操作" />
          <View style={styles.actionStack}>
            <Button
              title={uploadingFile ? '上传文件中...' : '上传模型文件'}
              iconLeft="cloud-upload-outline"
              onPress={handleUploadFile}
              disabled={uploadingFile}
              loading={uploadingFile}
              fullWidth
            />
          </View>
        </Card>

        <Card style={styles.dangerSection}>
          <SectionHeader title="危险操作" />
          <Button
            title="删除模型"
            iconLeft="trash-outline"
            onPress={handleDelete}
            variant="danger"
            disabled={deleting}
            loading={deleting}
            fullWidth
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const CenteredState = ({ icon, text, loading = false, actionLabel, onAction }) => (
  <SafeAreaView style={styles.container}>
    <View style={styles.centeredState}>
      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} />
      ) : (
        <Ionicons name={icon} size={54} color={COLORS.textTertiary} />
      )}
      <Text style={styles.centeredText}>{text}</Text>
      {actionLabel ? (
        <Button title={actionLabel} onPress={onAction} style={styles.centeredButton} />
      ) : null}
    </View>
  </SafeAreaView>
);

const SectionHeader = ({ title, count }) => (
  <View style={styles.sectionHeader}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {typeof count === 'number' ? <Text style={styles.sectionCount}>{count}</Text> : null}
  </View>
);

const SummaryTile = ({ label, value, icon }) => (
  <View style={styles.summaryTile}>
    <Ionicons name={icon} size={17} color={COLORS.primary} />
    <Text style={styles.summaryLabel}>{label}</Text>
    <Text style={styles.summaryValue} numberOfLines={1}>{value}</Text>
  </View>
);

const EmptySection = ({ text }) => (
  <View style={styles.emptySection}>
    <Text style={styles.emptySectionText}>{text}</Text>
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
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  centeredText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },
  centeredButton: {
    marginTop: SPACING.lg,
    minWidth: 160,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  identityIcon: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
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
  section: {
    marginHorizontal: 0,
    marginBottom: SPACING.md,
  },
  dangerSection: {
    marginHorizontal: 0,
    marginBottom: SPACING.md,
    borderColor: COLORS.dangerSoft,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    ...TYPOGRAPHY.sectionTitle,
    color: COLORS.text,
  },
  sectionCount: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  description: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.lg,
  },
  summaryTile: {
    flex: 1,
    minWidth: 0,
    padding: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
  },
  summaryLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textTertiary,
    marginTop: SPACING.xs,
  },
  summaryValue: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
    marginTop: 2,
  },
  gallery: {
    gap: SPACING.md,
  },
  imageCard: {
    width: 168,
  },
  galleryImage: {
    width: 168,
    height: 138,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
  },
  galleryFallback: {
    width: 168,
    height: 138,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceMuted,
  },
  imageLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  fileIcon: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primarySoft,
  },
  fileInfo: {
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
  downloadButton: {
    minWidth: 88,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  optionButton: {
    minHeight: 34,
    alignItems: 'center',
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
  actionStack: {
    gap: SPACING.sm,
  },
  emptySection: {
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceMuted,
  },
  emptySectionText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
  },
});

export default ModelDetailScreen;
