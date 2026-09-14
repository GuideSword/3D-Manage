import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  ROUTES,
  SPACING,
  TYPOGRAPHY,
} from '../constants';
import {
  Card,
  CyberChip,
  CyberEmptyState,
  CyberIconButton,
  CyberPageHeader,
  ProtectedImage,
  CyberSearchField,
  CyberSectionHeading,
  cyberTheme,
} from '../components';
import { useAppTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { authAPI, isAuthRequiredError, modelsAPI } from '../utils/api';
import { canWrite } from '../utils/permissions';

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

const ModelsScreen = ({ navigation }) => {
  const { user } = useAuth();
  const { isDark } = useAppTheme();
  const t = React.useMemo(() => cyberTheme(isDark), [isDark]);
  const styles = React.useMemo(() => createStyles(t), [t]);
  const [models, setModels] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('grid');
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

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.container}>
      <View style={styles.page}>
      <CyberPageHeader
        eyebrow="MODEL LIBRARY"
        title="模型图鉴"
        subtitle="把灵感和打印资产都收藏在这里。"
        onAssistant={() => navigation.navigate(ROUTES.AGENT)}
        actions={canWrite(user) ? (
          <CyberIconButton
            icon="add"
            label="新建模型"
            active
            onPress={() => navigation.navigate(ROUTES.CREATE_MODEL)}
          />
        ) : null}
      />
      <CyberSearchField
        placeholder="搜索模型名称、描述或文件名"
        value={searchQuery}
        onChangeText={setSearchQuery}
      />
      <View style={styles.modelTools}>
        <ScrollView
          horizontal
          style={styles.sourceScroll}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sourceChips}
        >
          {[['all', '全部'], ...Object.entries(SOURCE_LABELS)].map(([source, label]) => (
            <CyberChip
              key={source}
              label={label}
              active={sourceFilter === source}
              onPress={() => setSourceFilter(source)}
            />
          ))}
        </ScrollView>
        <CyberIconButton
          icon={viewMode === 'list' ? 'grid-outline' : 'list-outline'}
          label={viewMode === 'list' ? '切换为网格视图' : '切换为列表视图'}
          active
          onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
        />
      </View>
      <CyberSectionHeading title="模型资产" hint={`共 ${models.length} 个模型`} />

      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={t.primary} />
          <Text style={styles.loadingText}>加载模型中...</Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
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
              colors={[t.primary]}
              tintColor={t.primary}
            />
          )}
          contentContainerStyle={[
            styles.listContainer,
            models.length === 0 && styles.emptyListContainer,
          ]}
          ListEmptyComponent={(
            <CyberEmptyState
              title={searchQuery ? '图鉴里没有这一款' : '模型图鉴还是空的'}
              description="上传 STL、OBJ 或 3MF 文件后，小鲤会替你整齐收好。"
              actionLabel={canWrite(user) ? '创建第一个模型' : undefined}
              onAction={canWrite(user) ? () => navigation.navigate(ROUTES.CREATE_MODEL) : undefined}
            />
          )}
        />
      )}

      </View>
    </SafeAreaView>
  );
};

const ModelCard = ({ model, isGrid, token, onPress }) => {
  const { isDark } = useAppTheme();
  const t = React.useMemo(() => cyberTheme(isDark), [isDark]);
  const styles = React.useMemo(() => createStyles(t), [t]);
  const preferredImage = getPreferredImage(model);
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
          <ProtectedImage
            fileUrl={preferredImage?.fileUrl}
            token={token}
            style={styles.previewImage}
            resizeMode="cover"
            fallback={(
            <View style={styles.previewFallback}>
              <Ionicons name="cube-outline" size={isGrid ? 42 : 34} color={t.primary} />
            </View>
            )}
          />
          <View style={styles.sourceBadge}>
            <Text style={styles.sourceBadgeText}>{sourceLabel}</Text>
          </View>
        </View>

        <View style={isGrid ? styles.gridModelInfo : styles.listModelInfo}>
          <View style={styles.modelHeader}>
            <Text style={styles.modelName} numberOfLines={1}>
              {model.name || '未命名模型'}
            </Text>
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

const MetaPill = ({ icon, label }) => {
  const { isDark } = useAppTheme();
  const t = React.useMemo(() => cyberTheme(isDark), [isDark]);
  const styles = React.useMemo(() => createStyles(t), [t]);
  return (
    <View style={styles.metaPill}>
      <Ionicons name={icon} size={13} color={t.muted} />
      <Text style={styles.metaPillText} numberOfLines={1}>{label}</Text>
    </View>
  );
};

const createStyles = (t) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.background,
  },
  page: {
    flex: 1,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
  },
  modelTools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  sourceScroll: { flex: 1 },
  sourceChips: { gap: 7, alignItems: 'center' },
  list: { flex: 1 },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
  },
  loadingText: {
    ...TYPOGRAPHY.meta,
    color: t.muted,
  },
  listContainer: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 22,
  },
  emptyListContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  listCardContainer: {
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  gridCardContainer: {
    flex: 1,
    maxWidth: '50%',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  listCard: {
    minHeight: 132,
    flexDirection: 'row',
    overflow: 'hidden',
    marginHorizontal: 0,
    marginVertical: 0,
    borderRadius: 20,
    backgroundColor: t.glass,
    borderColor: t.border,
    shadowColor: t.glow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 2,
  },
  gridCard: {
    minHeight: 238,
    overflow: 'hidden',
    marginHorizontal: 0,
    marginVertical: 0,
    borderRadius: 20,
    backgroundColor: t.glass,
    borderColor: t.border,
    shadowColor: t.glow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 2,
  },
  listPreviewBox: {
    width: 118,
    minHeight: 132,
    backgroundColor: t.primarySoft,
    overflow: 'hidden',
  },
  gridPreviewBox: {
    width: '100%',
    aspectRatio: 1.22,
    backgroundColor: t.primarySoft,
    overflow: 'hidden',
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
  sourceBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minHeight: 22,
    paddingHorizontal: 8,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.glass,
    borderWidth: 1,
    borderColor: t.border,
  },
  sourceBadgeText: {
    color: t.primary,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '900',
  },
  listModelInfo: {
    flex: 1,
    padding: 12,
  },
  gridModelInfo: {
    padding: 12,
  },
  modelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  modelName: {
    flex: 1,
    ...TYPOGRAPHY.sectionTitle,
    color: t.text,
  },
  description: {
    ...TYPOGRAPHY.meta,
    color: t.muted,
    marginTop: 4,
  },
  modelMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 26,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: t.surfaceMuted,
  },
  metaPillText: {
    ...TYPOGRAPHY.caption,
    color: t.muted,
  },
  modelDate: {
    ...TYPOGRAPHY.caption,
    color: t.muted,
    marginTop: 8,
  },
});

export default ModelsScreen;
