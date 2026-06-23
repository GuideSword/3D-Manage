import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Image,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { COLORS, API_CONFIG } from '../constants';
import { Card, Button, Badge } from '../components';
import { authAPI, modelsAPI, isAuthRequiredError } from '../utils/api';
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
  { value: 'real_print', label: '实物打印图' },
  { value: 'other', label: '其他图片' },
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
        {
          text: '删除',
          style: 'destructive',
          onPress: deleteModel,
        },
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

  if (loading && !model) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!model) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContainer}>
          <Ionicons name="cube-outline" size={64} color={COLORS.textSecondary} />
          <Text style={styles.emptyText}>模型不存在</Text>
          <Button title="返回" onPress={() => navigation.goBack()} style={styles.backButton} />
        </View>
      </SafeAreaView>
    );
  }

  const sourceLabel = SOURCE_LABELS[model.source] || model.source || '未知';
  const images = model.images || [];
  const files = model.files || [];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
      >
        <Card style={styles.section}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Text style={styles.modelName}>{model.name || '未命名模型'}</Text>
              <Badge
                text={sourceLabel}
                color={COLORS.primary}
                size="small"
                style={styles.sourceBadge}
              />
            </View>
          </View>

          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>描述</Text>
            <Text style={styles.detailValue}>{model.description || '暂无描述'}</Text>
          </View>

          <View style={styles.detailsGrid}>
            <View style={styles.detailItemHalf}>
              <Text style={styles.detailLabel}>文件数</Text>
              <Text style={styles.detailValue}>{files.length}</Text>
            </View>
            <View style={styles.detailItemHalf}>
              <Text style={styles.detailLabel}>图片数</Text>
              <Text style={styles.detailValue}>{images.length}</Text>
            </View>
            {model.createdAt && (
              <View style={styles.detailItemHalf}>
                <Text style={styles.detailLabel}>创建时间</Text>
                <Text style={styles.detailValue}>
                  {new Date(model.createdAt).toLocaleString('zh-CN')}
                </Text>
              </View>
            )}
            {model.updatedAt && (
              <View style={styles.detailItemHalf}>
                <Text style={styles.detailLabel}>更新时间</Text>
                <Text style={styles.detailValue}>
                  {new Date(model.updatedAt).toLocaleString('zh-CN')}
                </Text>
              </View>
            )}
          </View>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>图片</Text>
          {images.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {images.map((image) => {
                const source = buildAssetSource(image.fileUrl, authToken);
                return (
                  <View key={image.id} style={styles.imageCard}>
                    {source ? (
                      <Image source={source} style={styles.galleryImage} resizeMode="cover" />
                    ) : (
                      <View style={styles.galleryPlaceholder}>
                        <Ionicons name="image-outline" size={36} color={COLORS.textSecondary} />
                      </View>
                    )}
                    <Text style={styles.imageLabel} numberOfLines={1}>
                      {IMAGE_TYPE_LABELS[image.type] || image.type}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            <Text style={styles.emptySectionText}>暂无图片</Text>
          )}
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>模型文件</Text>
          {files.length > 0 ? (
            files.map((file) => (
              <View key={file.id} style={styles.fileItem}>
                <View style={styles.fileIcon}>
                  <Ionicons name="document-outline" size={22} color={COLORS.primary} />
                </View>
                <View style={styles.fileInfo}>
                  <Text style={styles.fileName}>{file.name}</Text>
                  <Text style={styles.fileMeta}>
                    {String(file.type || '').toUpperCase()} · {file.size ? `${Math.round(file.size / 1024)} KB` : '未知大小'}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptySectionText}>暂无模型文件</Text>
          )}
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>添加图片</Text>
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
          <Button
            title={uploadingImage ? '上传图片中...' : '上传图片'}
            onPress={handleUploadImage}
            style={styles.actionButton}
            disabled={uploadingImage}
            loading={uploadingImage}
          />
        </Card>

        <Card style={styles.section}>
          <Button
            title={uploadingFile ? '上传文件中...' : '上传模型文件'}
            onPress={handleUploadFile}
            style={styles.actionButton}
            disabled={uploadingFile}
            loading={uploadingFile}
          />
          <Button
            title="删除模型"
            onPress={handleDelete}
            variant="danger"
            style={styles.deleteButton}
            disabled={deleting}
            loading={deleting}
          />
        </Card>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  backButton: {
    marginTop: 24,
    width: 200,
  },
  section: {
    margin: 16,
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  headerLeft: {
    flex: 1,
  },
  modelName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 8,
  },
  sourceBadge: {
    alignSelf: 'flex-start',
  },
  detailItem: {
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 24,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  detailItemHalf: {
    width: '50%',
    marginBottom: 16,
    paddingRight: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  imageCard: {
    width: 140,
    marginRight: 12,
  },
  galleryImage: {
    width: 140,
    height: 120,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  galleryPlaceholder: {
    width: 140,
    height: 120,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageLabel: {
    marginTop: 6,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  emptySectionText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  fileIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  fileMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
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
  actionButton: {
    marginBottom: 12,
  },
  deleteButton: {
    marginTop: 0,
  },
});

export default ModelDetailScreen;
