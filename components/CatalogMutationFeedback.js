import React from 'react';
import { Text, View } from 'react-native';
import Button from './Button';
import { useAppTheme } from '../context/ThemeContext';

export default function CatalogMutationFeedback({ mutation, onSuccess, onReload }) {
  const { colors } = useAppTheme();
  if (!mutation.error && !(mutation.pending && !mutation.loading)) return null;
  return <View style={{ padding: 12, gap: 8 }}>
    {mutation.error ? <Text style={{ color: colors.danger }}>{mutation.error}</Text> : null}
    {mutation.pending ? <>
      <Text style={{ color: colors.text }}>上次删除结果尚未确认，请重试原操作。</Text>
      <Button title="重试原删除" loading={mutation.loading} disabled={mutation.loading} onPress={async () => {
        const command = mutation.pending;
        const result = await mutation.run(command.operation, command.payload, command.send);
        if (result !== null) onSuccess();
      }} />
    </> : mutation.conflict ? <Button title="重新加载原记录" onPress={onReload} /> : null}
  </View>;
}
