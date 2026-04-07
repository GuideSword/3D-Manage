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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, ROUTES } from '../constants';
import { Card, Button, Badge } from '../components';
import { modelsAPI } from '../utils/api';

const ModelDetailScreen = ({ route, navigation }) => {
  const { modelId } = route.params || {};
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 获取模型详情
  const fetchModelDetail = async () => {
    if (!modelId) {
      Alert.alert('错误', '模型ID不存在');
      navigation.goBack();
      return;
    }

    try {
      setLoading(true);
      
      // 先尝试从API获取模型详情
      let modelData = null;
      try {
        modelData = await modelsAPI.getById(modelId);
        // 如果返回的数据包含error字段，说明模型不存在
        if (modelData && modelData.error) {
          modelData = null;
        }
      } catch (err) {
        console.error('获取模型详情失败:', err);
        // 如果API不支持/:id路由，尝试从列表获取
        if (err.status === 404 || err.message?.includes('Route not found') || err.message?.includes('404')) {
          try {
            const allModels = await modelsAPI.getAll();
            modelData = allModels.find(m => m.id === modelId || String(m.id) === String(modelId));
          } catch (listErr) {
            console.error('从列表获取模型失败:', listErr);
            modelData = null;
          }
        }
      }
      
      if (modelData) {
        setModel(modelData);
      } else {
        Alert.alert('错误', '模型不存在', [
          {
            text: '确定',
            onPress: () => navigation.goBack(),
          },
        ]);
        return;
      }
    } catch (error) {
      console.error('获取模型详情失败:', error);
      Alert.alert('错误', '获取模型详情失败，请检查网络连接', [
        {
          text: '确定',
          onPress: () => navigation.goBack(),
        },
      ]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // 删除模型
  const handleDelete = () => {
    Alert.alert(
      '确认删除',
      '确定要删除这个模型吗？此操作不可恢复。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeleting(true);
              await modelsAPI.delete(modelId);
              Alert.alert('成功', '模型已删除', [
                {
                  text: '确定',
                  onPress: () => navigation.goBack(),
                },
              ]);
            } catch (error) {
              Alert.alert('错误', '删除模型失败');
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
    fetchModelDetail();
  }, [modelId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchModelDetail();
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
      >
        {/* 模型预览 */}
        <Card style={styles.section}>
          <View style={styles.previewPlaceholder}>
            <Ionicons name="cube-outline" size={64} color={COLORS.textSecondary} />
            <Text style={styles.previewText}>模型预览</Text>
          </View>
        </Card>

        {/* 基本信息 */}
        <Card style={styles.section}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Text style={styles.modelName}>{model.name || '未命名模型'}</Text>
              {model.visibility && (
                <Badge
                  text={model.visibility === 'private' ? '私有' : '团队'}
                  color={model.visibility === 'private' ? COLORS.warning : COLORS.success}
                  size="small"
                  style={styles.visibilityBadge}
                />
              )}
            </View>
          </View>

          <View style={styles.detailsGrid}>
            {model.dimensions && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>尺寸</Text>
                <Text style={styles.detailValue}>{model.dimensions} mm</Text>
              </View>
            )}
            {model.estimatedMaterialGrams && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>大概所需耗材</Text>
                <Text style={styles.detailValue}>{model.estimatedMaterialGrams} g</Text>
              </View>
            )}
            {model.createdAt && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>创建时间</Text>
                <Text style={styles.detailValue}>
                  {new Date(model.createdAt).toLocaleString('zh-CN')}
                </Text>
              </View>
            )}
            {model.updatedAt && (
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>更新时间</Text>
                <Text style={styles.detailValue}>
                  {new Date(model.updatedAt).toLocaleString('zh-CN')}
                </Text>
              </View>
            )}
          </View>

          {model.notes && (
            <View style={styles.notesSection}>
              <Text style={styles.notesLabel}>备注</Text>
              <Text style={styles.notesText}>{model.notes}</Text>
            </View>
          )}
        </Card>

        {/* 版本信息 */}
        {model.versions && model.versions.length > 0 && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>版本历史</Text>
            {model.versions.map((version, index) => (
              <View key={version.id || index} style={styles.versionItem}>
                <View style={styles.versionHeader}>
                  <Text style={styles.versionName}>
                    版本 {version.version || index + 1}
                  </Text>
                  {version.createdAt && (
                    <Text style={styles.versionDate}>
                      {new Date(version.createdAt).toLocaleString('zh-CN')}
                    </Text>
                  )}
                </View>
                {version.notes && (
                  <Text style={styles.versionNotes}>{version.notes}</Text>
                )}
                {version.fileKey && (
                  <Text style={styles.versionFile}>文件: {version.fileKey}</Text>
                )}
              </View>
            ))}
          </Card>
        )}

        {/* 操作按钮 */}
        <Card style={styles.section}>
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
  previewPlaceholder: {
    height: 200,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewText: {
    marginTop: 8,
    fontSize: 14,
    color: COLORS.textSecondary,
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
  visibilityBadge: {
    alignSelf: 'flex-start',
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  detailItem: {
    width: '50%',
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  notesSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  notesLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  notesText: {
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  versionItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 12,
  },
  versionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  versionName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  versionDate: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  versionNotes: {
    fontSize: 14,
    color: COLORS.text,
    marginBottom: 4,
  },
  versionFile: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },
  deleteButton: {
    marginTop: 0,
  },
});

export default ModelDetailScreen;




