import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  RefreshControl,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants';
import { Card, Button, Badge } from '../components';
import { modelsAPI } from '../utils/api';
import { useFocusEffect } from '@react-navigation/native';

const { width } = Dimensions.get('window');

const ModelsScreen = ({ navigation }) => {
  const [models, setModels] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'grid'

  // 获取模型列表
  const fetchModels = async () => {
    try {
      setLoading(true);
      const data = await modelsAPI.getAll();
      setModels(data || []);
    } catch (error) {
      console.error('获取模型列表失败:', error);
      setModels([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchModels();
  };

  useEffect(() => {
    fetchModels();
  }, []);

  // 当屏幕获得焦点时刷新数据
  useFocusEffect(
    useCallback(() => {
      fetchModels();
    }, [])
  );

  const ModelCard = ({ model, isGrid = false }) => (
    <TouchableOpacity
      onPress={() => navigation.navigate('ModelDetail', { modelId: model.id })}
      style={isGrid ? styles.gridCardContainer : styles.listCardContainer}
    >
      <Card style={isGrid ? styles.gridCard : styles.listCard}>
        {/* 模型预览占位图 */}
        <View style={styles.previewPlaceholder}>
          <Ionicons name="cube-outline" size={48} color={COLORS.textSecondary} />
        </View>

        <View style={styles.modelInfo}>
          <View style={styles.modelHeader}>
            <Text style={styles.modelName} numberOfLines={1}>
              {model.name}
            </Text>
            <Badge
              text={model.visibility === 'private' ? '私有' : '团队'}
              color={model.visibility === 'private' ? COLORS.warning : COLORS.success}
              size="small"
            />
          </View>

          <View style={styles.modelMeta}>
            {model.dimensions && (
              <>
                <Text style={styles.metaText}>尺寸: {model.dimensions}</Text>
                <Text style={styles.metaText}>•</Text>
              </>
            )}
            {model.estimatedMaterialGrams && (
              <Text style={styles.metaText}>耗材: {model.estimatedMaterialGrams}g</Text>
            )}
          </View>

          {(model.createdAt || model.updatedAt) && (
            <Text style={styles.modelDate}>
              {model.updatedAt ? `更新时间: ${model.updatedAt}` : `创建时间: ${model.createdAt}`}
            </Text>
          )}
        </View>
      </Card>
    </TouchableOpacity>
  );

  const renderModel = ({ item }) => (
    <ModelCard model={item} isGrid={viewMode === 'grid'} />
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>模型管理</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.viewModeButton}
            onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
          >
            <Ionicons
              name={viewMode === 'list' ? 'grid' : 'list'}
              size={24}
              color={COLORS.primary}
            />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton}>
            <Ionicons name="search" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton}>
            <Ionicons name="filter" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.headerButton}
            onPress={() => navigation.navigate('CreateModel')}
          >
            <Ionicons name="add-circle" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      ) : (
        <FlatList
          data={models}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderModel}
          key={viewMode} // 强制重新渲染以切换布局
          numColumns={viewMode === 'grid' ? 2 : 1}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
              tintColor={COLORS.primary}
            />
          }
          contentContainerStyle={[
            styles.listContainer,
            models.length === 0 && styles.emptyListContainer,
          ]}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="cube-outline" size={64} color={COLORS.textSecondary} />
              <Text style={styles.emptyText}>暂无模型</Text>
              <Button
                title="创建第一个模型"
                onPress={() => navigation.navigate('CreateModel')}
                style={styles.uploadButton}
              />
            </View>
          }
        />
      )}

      {/* 浮动添加按钮 */}
      <TouchableOpacity 
        style={styles.fab}
        onPress={() => navigation.navigate('CreateModel')}
      >
        <Ionicons name="add" size={24} color={COLORS.background} />
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.light,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  viewModeButton: {
    padding: 4,
  },
  headerButton: {
    padding: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  listContainer: {
    padding: 16,
  },
  emptyListContainer: {
    flexGrow: 1,
  },
  listCardContainer: {
    marginBottom: 12,
  },
  gridCardContainer: {
    width: (width - 32 - 12) / 2, // 减去padding和间距
    marginBottom: 12,
    marginHorizontal: 6,
  },
  listCard: {
    flexDirection: 'row',
  },
  gridCard: {
    // 网格卡片样式
  },
  previewPlaceholder: {
    width: 80,
    height: 80,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  modelInfo: {
    flex: 1,
  },
  modelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  modelName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
    marginRight: 8,
  },
  modelMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  metaText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginRight: 4,
  },
  modelDate: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  versionIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  versionText: {
    fontSize: 12,
    color: COLORS.primary,
    marginLeft: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 64,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 16,
    marginBottom: 24,
  },
  uploadButton: {
    minWidth: 200,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.dark,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
});

export default ModelsScreen;


