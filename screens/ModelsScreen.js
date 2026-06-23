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
  TextInput,
  Platform,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, API_CONFIG } from '../constants';
import { Card, Button, Badge } from '../components';
import { authAPI, modelsAPI, isAuthRequiredError } from '../utils/api';
import { useFocusEffect } from '@react-navigation/native';

const { width } = Dimensions.get('window');

const SOURCE_LABELS = {
  original: '原创',
  remix: '二创',
  imported: '导入',
};

const getPreferredImage = (model) => {
  const images = model.images || [];
  return (
    images.find((image) => image.type === 'cover')
    || images.find((image) => image.type === 'auto_preview')
    || null
  );
};

const buildImageSource = (image, token) => {
  if (!image?.fileUrl) {
    return null;
  }
  const apiRoot = API_CONFIG.BASE_URL.replace(/\/api\/?$/, '');
  const uri = image.fileUrl.startsWith('http')
    ? image.fileUrl
    : `${image.fileUrl.startsWith('/api') ? apiRoot : API_CONFIG.BASE_URL}${image.fileUrl}`;
  return {
    uri,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  };
};

const ModelsScreen = ({ navigation }) => {
  const [models, setModels] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('list');
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [authToken, setAuthToken] = useState(null);

  const fetchModels = async () => {
    try {
      setLoading(true);
      setAuthToken(await authAPI.getToken());

      const params = {};
      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }
      if (sourceFilter !== 'all') {
        params.source = sourceFilter;
      }

      const data = await modelsAPI.getAll(params);
      setModels(data || []);
    } catch (error) {
      if (isAuthRequiredError(error)) {
        return;
      }
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
  }, [searchQuery, sourceFilter]);

  useFocusEffect(
    useCallback(() => {
      fetchModels();
    }, [searchQuery, sourceFilter])
  );

  const cycleSourceFilter = () => {
    setSourceFilter((current) => {
      if (current === 'all') return 'original';
      if (current === 'original') return 'remix';
      if (current === 'remix') return 'imported';
      return 'all';
    });
  };

  const ModelCard = ({ model, isGrid = false }) => {
    const preferredImage = getPreferredImage(model);
    const imageSource = buildImageSource(preferredImage, authToken);
    const sourceLabel = SOURCE_LABELS[model.source] || model.source || '未知';

    return (
      <TouchableOpacity
        onPress={() => navigation.navigate('ModelDetail', { modelId: model.id })}
        style={isGrid ? styles.gridCardContainer : styles.listCardContainer}
      >
        <Card style={isGrid ? styles.gridCard : styles.listCard}>
          <View style={styles.previewBox}>
            {imageSource ? (
              <Image source={imageSource} style={styles.previewImage} resizeMode="cover" />
            ) : (
              <Ionicons name="cube-outline" size={48} color={COLORS.textSecondary} />
            )}
          </View>

          <View style={styles.modelInfo}>
            <View style={styles.modelHeader}>
              <Text style={styles.modelName} numberOfLines={1}>
                {model.name}
              </Text>
              <Badge text={sourceLabel} color={COLORS.primary} size="small" />
            </View>

            {model.description ? (
              <Text style={styles.description} numberOfLines={2}>
                {model.description}
              </Text>
            ) : null}

            <View style={styles.modelMeta}>
              <Text style={styles.metaText}>文件: {(model.files || []).length}</Text>
              <Text style={styles.metaText}>图片: {(model.images || []).length}</Text>
            </View>

            {(model.createdAt || model.updatedAt) && (
              <Text style={styles.modelDate}>
                {model.updatedAt ? `更新: ${new Date(model.updatedAt).toLocaleString('zh-CN')}` : `创建: ${new Date(model.createdAt).toLocaleString('zh-CN')}`}
              </Text>
            )}
          </View>
        </Card>
      </TouchableOpacity>
    );
  };

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
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setShowSearch(!showSearch)}
          >
            <Ionicons name="search" size={24} color={showSearch ? COLORS.primary : COLORS.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={cycleSourceFilter}
          >
            <Ionicons name="filter" size={24} color={sourceFilter === 'all' ? COLORS.text : COLORS.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => navigation.navigate('CreateModel')}
          >
            <Ionicons name="add-circle" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {showSearch && (
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="搜索模型名称、描述或文件名"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={24} color={COLORS.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {sourceFilter !== 'all' && (
        <View style={styles.filterHint}>
          <Text style={styles.filterHintText}>
            当前筛选：{SOURCE_LABELS[sourceFilter] || sourceFilter}
          </Text>
          <TouchableOpacity onPress={() => setSourceFilter('all')}>
            <Text style={styles.filterClearText}>清除</Text>
          </TouchableOpacity>
        </View>
      )}

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
          key={viewMode}
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
              <Text style={styles.emptyText}>{searchQuery ? '未找到匹配的模型' : '暂无模型'}</Text>
              <Button
                title="创建第一个模型"
                onPress={() => navigation.navigate('CreateModel')}
                style={styles.uploadButton}
              />
            </View>
          }
        />
      )}

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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    backgroundColor: COLORS.surface,
    marginRight: 8,
  },
  filterHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  filterHintText: {
    fontSize: 14,
    color: COLORS.text,
  },
  filterClearText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
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
    width: (width - 44) / 2,
    marginBottom: 12,
    marginHorizontal: 6,
  },
  listCard: {
    flexDirection: 'row',
  },
  gridCard: {},
  previewBox: {
    width: 80,
    height: 80,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: '100%',
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
  description: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
    marginBottom: 8,
  },
  modelMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  metaText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginRight: 12,
  },
  modelDate: {
    fontSize: 12,
    color: COLORS.textSecondary,
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
    ...Platform.select({
      web: {
        boxShadow: '0 2px 4px rgba(28, 28, 30, 0.25)',
      },
      default: {
        shadowColor: COLORS.dark,
        shadowOffset: {
          width: 0,
          height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
      },
    }),
  },
});

export default ModelsScreen;
