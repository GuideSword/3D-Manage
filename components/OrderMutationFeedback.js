import React from 'react';
import { Text, View } from 'react-native';
import Button from './Button';
import { useAppTheme } from '../context/ThemeContext';

export default function OrderMutationFeedback({ mutation, onResolved, onReload }) {
  const { colors } = useAppTheme();
  if (!mutation.error && !(mutation.pending && !mutation.loading)) return null;
  return <View style={{ gap: 8, padding: 12 }}>
    {mutation.error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{mutation.error}</Text> : null}
    {mutation.pending && !mutation.loading ? <>
      <Text style={{ color: colors.text }}>上次订单操作结果尚未确认，请重试原操作。</Text>
      <Button title="重试原订单操作" onPress={async () => {
        const command = mutation.pending;
        const result = await mutation.run(command.operation, command.payload, command.send);
        if (result !== null) await onResolved(result, command.operation);
      }} />
    </> : null}
    {mutation.conflict ? <Button title="重新加载最新订单" variant="outline" onPress={onReload} /> : null}
  </View>;
}
