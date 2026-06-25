import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  API_CONFIG,
  COLORS,
  RADIUS,
  ROUTES,
  SPACING,
  TYPOGRAPHY,
} from '../constants';
import { Badge, Button, Card } from '../components';
import { authAPI, isAuthRequiredError, modelsAPI } from '../utils/api';

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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleGroup}>
          <Text style={styles.eyebrow}>MODEL LIBRARY</Text>
          <Text style={styles.title}>模型</Text>
        </View>
        <View style={styles.headerActions}>
          <IconButton
            icon={viewMode === 'list' ? 'grid-outline' : 'list-outline'}
            active
            onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
          />
          <IconButton
            icon="search"
            active={showSearch}
            onPress={() => setShowSearch((value) => !value)}
          />
          <IconButton
            icon="filter"
            active={sourceFilter !== 'all'}
            onPress={cycleSourceFilter}
          />
          <IconButton
            icon="add"
            active
            onPress={() => navigation.navigate(ROUTES.CREATE_MODEL)}
          />
        </View>
      </View>

      {showSearch ? (
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color={COLORS.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="搜索模型名称、描述或文件名"
            placeholderTextColor={COLORS.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.searchClear}>
              <Ionicons name="close" size={16} color={COLORS.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {sourceFilter !== 'all' ? (
        <View style={styles.filterHint}>
          <View style={styles.filterHintLeft}>
            <Ionicons name="funnel-outline" size={16} color={COLORS.primary} />
            <Text style={styles.filterHintText}>
              当前筛选：{SOURCE_LABELS[sourceFilter] || sourceFilter}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setSourceFilter('all')}>
            <Text style={styles.filterClearText}>清除</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>加载模型中...</Text>
        </View>
      ) : (
        <FlatList
          data={models}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <ModelCard
              model={item}
              isGrid={viewMode === 'grid'}
              token={authToken}
              onPress={() => navigation.navigate(ROUTES.MODEL_DETAIL, { modelId: item.id })}
            />
          )}
          key={viewMode}
          numColumns={viewMode === 'grid' ? 2 : 1}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
              tintColor={COLORS.primary}
            />
          )}
          contentContainerStyle={[
            styles.listContainer,
            models.length === 0 && styles.emptyListContainer,
          ]}
          ListEmptyComponent={(
            <View style={styles.emptyContainer}>
              <Ionicons name="cube-outline" size={54} color={COLORS.textTertiary} />
              <Text style={styles.emptyTitle}>
                {searchQuery ? '没有匹配的模型' : '暂无模型'}
              </Text>
              <Text style={styles.emptyText}>
                上传 STL、OBJ 或 3MF 文件后，这里会成为你的模型资产库。
              </Text>
              <Button
                title="创建第一个模型"
                iconLeft="add"
                onPress={() => navigation.navigate(ROUTES.CREATE_MODEL)}
                style={styles.uploadButton}
              />
            </View>
          )}
        />
      )}

      <TouchableOpacity
        activeOpacity={0.84}
        style={styles.fab}
        onPress={() => navigation.navigate(ROUTES.CREATE_MODEL)}
      >
        <Ionicons name="add" size={24} color={COLORS.surfaceElevated} />
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const IconButton = ({ icon, active = false, onPress }) => (
  <TouchableOpacity
    activeOpacity={0.82}
    style={[styles.headerButton, active && styles.headerButtonActive]}
    onPress={onPress}
  >
    <Ionicons name={icon} size={20} color={active ? COLORS.primary : COLORS.textSecondary} />
  </TouchableOpacity>
);

const ModelCard = ({ model, isGrid, token, onPress }) => {
  const preferredImage = getPreferredImage(model);
  const imageSource = buildImageSource(preferredImage, token);
  const sourceLabel = SOURCE_LABELS[model.source] || model.source || '未知';
  const updatedLabel = model.updatedAt
    ? `更新：${new Date(model.updatedAt).toLocaleDateString('zh-CN')}`
    : model.createdAt
      ? `创建：${new Date(model.createdAt).toLocaleDateString('zh-CN')}`
      : '暂无日期';

  return (
    <TouchableOpacity
      activeOpacity={0.84}
      onPress={onPress}
      style={isGrid ? styles.gridCardContainer : styles.listCardContainer}
    >
      <Card padding="none" style={isGrid ? styles.gridCard : styles.listCard} interactive>
        <View style={isGrid ? styles.gridPreviewBox : styles.listPreviewBox}>
          {imageSource ? (
            <Image source={imageSource} style={styles.previewImage} resizeMode="cover" />
          ) : (
            <View style={styles.previewFallback}>
              <Ionicons name="cube-outline" size={isGrid ? 42 : 34} color={COLORS.textTertiary} />
            </View>
          )}
        </View>

        <View style={isGrid ? styles.gridModelInfo : styles.listModelInfo}>
          <View style={styles.modelHeader}>
            <Text style={styles.modelName} numberOfLines={1}>
              {model.name || '未命名模型'}
            </Text>
            <Badge text={sourceLabel} color={COLORS.accent} size="small" />
          </View>

          {model.description ? (
            <Text style={styles.description} numberOfLines={isGrid ? 2 : 1}>
              {model.description}
            </Text>
          ) : null}

          <View style={styles.modelMeta}>
            <MetaPill icon="document-outline" label={`${(model.files || []).length} 文件`} />
            <MetaPill icon="image-outline" label={`${(model.images || []).length} 图片`} />
          </View>
          <Text style={styles.modelDate} numberOfLines={1}>{updatedLabel}</Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
};

const MetaPill = ({ icon, label }) => (
  <View style={styles.metaPill}>
    <Ionicons name={icon} size={13} color={COLORS.textSecondary} />
    <Text style={styles.metaPillText} numberOfLines={1}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  titleGroup: {
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  headerButtonActive: {
    backgroundColor: COLORS.primarySoft,
    borderColor: COLORS.primarySoft,
  },
  searchContainer: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceElevated,
  },
  searchInput: {
    flex: 1,
    minHeight: 44,
    fontSize: 15,
    color: COLORS.text,
  },
  searchClear: {
    width: 28,
    height: 28,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceMuted,
  },
  filterHint: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primarySoft,
  },
  filterHintLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  filterHintText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.primaryDark,
  },
  filterClearText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.primary,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
  },
  loadingText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
  },
  listContainer: {
    padding: SPACING.lg,
    paddingTop: 0,
    paddingBottom: 88,
  },
  emptyListContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  emptyTitle: {
    ...TYPOGRAPHY.sectionTitle,
    color: COLORS.text,
    marginTop: SPACING.md,
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
  uploadButton: {
    marginTop: SPACING.lg,
  },
  listCardContainer: {
    marginBottom: SPACING.md,
  },
  gridCardContainer: {
    flex: 1,
    maxWidth: '50%',
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.xs,
  },
  listCard: {
    minHeight: 132,
    flexDirection: 'row',
    overflow: 'hidden',
    marginHorizontal: 0,
  },
  gridCard: {
    minHeight: 238,
    overflow: 'hidden',
    marginHorizontal: 0,
  },
  listPreviewBox: {
    width: 118,
    minHeight: 132,
    backgroundColor: COLORS.surfaceMuted,
  },
  gridPreviewBox: {
    width: '100%',
    aspectRatio: 1.22,
    backgroundColor: COLORS.surfaceMuted,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listModelInfo: {
    flex: 1,
    padding: SPACING.md,
  },
  gridModelInfo: {
    padding: SPACING.md,
  },
  modelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  modelName: {
    flex: 1,
    ...TYPOGRAPHY.sectionTitle,
    color: COLORS.text,
  },
  description: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  modelMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 26,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceMuted,
  },
  metaPillText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  modelDate: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textTertiary,
    marginTop: SPACING.md,
  },
  fab: {
    position: 'absolute',
    right: SPACING.xl,
    bottom: SPACING.xl,
    width: 54,
    height: 54,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
});

export default ModelsScreen;
