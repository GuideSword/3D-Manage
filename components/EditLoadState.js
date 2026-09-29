import React from 'react';
import { ActivityIndicator, SafeAreaView, Text, View } from 'react-native';
import Button from './Button';
import { useAppTheme } from '../context/ThemeContext';

export default function EditLoadState({ loading, error, onRetry, onCancel }) {
  const { colors } = useAppTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 16 }}>
        {loading ? <ActivityIndicator size="large" color={colors.primary} /> : null}
        <Text style={{ color: colors.text, textAlign: 'center' }}>{loading ? '加载原记录中...' : error || '无法加载原记录'}</Text>
        {!loading ? <Button title="重新加载" onPress={onRetry} fullWidth /> : null}
        <Button title="返回" onPress={onCancel} variant="outline" fullWidth />
      </View>
    </SafeAreaView>
  );
}
