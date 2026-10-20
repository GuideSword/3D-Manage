import React from 'react';
import { Text, View } from 'react-native';
import Button from './Button';
import { useAppTheme } from '../context/ThemeContext';

export default function RelationalFileFeedback({ mutation, onSaved, onReload, allowCancel = true }) {
  const { colors } = useAppTheme();
  if (!mutation.error && !mutation.pending) return null;
  return <View style={{ gap: 8, paddingVertical: 12 }}>
    {mutation.error ? <Text style={{ color: colors.danger }} accessibilityRole="alert">{mutation.error}</Text> : null}
    {mutation.pending ? <Text style={{ color: colors.textSecondary }}>
      {mutation.busy ? mutation.phase === 'uploading' ? '正在上传文件…' : '正在保存文件关联…'
        : mutation.uploaded ? '文件已上传。请继续确认登记结果，避免重复上传。' : '请确认这次文件操作的结果后，再进行其他操作。'}
    </Text> : null}
    {mutation.pending && !mutation.busy ? <>
      {mutation.phase === 'conflict' ? <Button title="重新加载并核对记录" variant="outline" onPress={onReload} />
        : <Button title="重试原文件操作" onPress={async () => { const result = await mutation.retry(); if (result) onSaved(result); }} />}
      {allowCancel && !mutation.uncertain ? <Button title="取消本次文件操作" variant="outline" onPress={mutation.cancel} /> : null}
    </> : null}
  </View>;
}
