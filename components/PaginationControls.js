import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import Button from './Button';
import { useAppTheme } from '../context/ThemeContext';

export default function PaginationControls({ page }) {
  const { colors } = useAppTheme();
  if (!page) return null;
  return <View style={{ padding: 12, gap: 8 }}>
    {page.total !== null ? <Text style={{ color: colors.textSecondary }}>已加载 {page.items.length} / {page.total} 条</Text> : null}
    {page.error ? <>
      <Text style={{ color: colors.danger }}>{page.error}</Text>
      <Button title={page.total === null || /刷新/.test(page.error) ? '重新加载列表' : '重试加载更多'} variant="outline"
        onPress={page.total === null || /刷新/.test(page.error) ? page.refresh : page.loadMore} disabled={page.loading} />
    </> : page.loading ? <ActivityIndicator color={colors.primary} />
      : page.hasMore ? <Button title="加载更多" onPress={page.loadMore} variant="outline" /> : null}
  </View>;
}
