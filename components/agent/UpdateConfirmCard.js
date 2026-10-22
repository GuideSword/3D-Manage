import React, { useMemo, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../../context/ThemeContext';

const ENTITY_LABELS = { orders: '订单', models: '模型', materials: '耗材' };
const FIELD_LABELS = {
  customer_name: '客户名', customer_email: '客户邮箱', customer_phone: '客户电话',
  due_date: '交期', notes: '备注', status: '状态', name: '名称', description: '描述', source: '来源',
  type: '类型', brand: '品牌', diameter: '直径', color: '颜色', density: '密度',
  unit_price: '单价', unit: '单位',
};

export default function UpdateConfirmCard({ proposal, onConfirm, onCancel }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  if (!proposal) return null;

  const confirm = () => {
    const apply = async () => {
      setBusy(true);
      try { await onConfirm?.(proposal); } finally { setBusy(false); }
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`确定修改${ENTITY_LABELS[proposal.entity]} #${proposal.id} 吗？`)) apply();
      return;
    }
    Alert.alert('确认修改', `确定修改${ENTITY_LABELS[proposal.entity]} #${proposal.id} 吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '确认', onPress: apply },
    ]);
  };

  return <View style={styles.card}>
    <Text style={styles.title}>待确认：修改{ENTITY_LABELS[proposal.entity]} #{proposal.id}</Text>
    {Object.entries(proposal.changes || {}).map(([key, value]) => <View key={key} style={styles.row}>
      <Text style={styles.label}>{FIELD_LABELS[key] || key}</Text>
      <Text style={styles.value}>{String(proposal.before?.[key] ?? '空')} → {value === '' ? '空' : String(value)}</Text>
    </View>)}
    <View style={styles.actions}>
      <TouchableOpacity disabled={busy} onPress={onCancel} style={styles.cancel}><Text style={styles.buttonText}>取消</Text></TouchableOpacity>
      {onConfirm ? <TouchableOpacity disabled={busy} onPress={confirm} style={styles.confirm}>
        <Text style={styles.buttonText}>{busy ? '修改中…' : '确认修改'}</Text>
      </TouchableOpacity> : <Text style={styles.readOnly}>当前账号只有查看权限</Text>}
    </View>
  </View>;
}

const createStyles = (colors) => StyleSheet.create({
  card: { marginHorizontal: 8, marginVertical: 6, padding: 14, borderRadius: 16, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.primary },
  title: { color: colors.text, fontWeight: '700', fontSize: 15, marginBottom: 10 },
  row: { marginBottom: 8 },
  label: { color: colors.textSecondary, fontSize: 12 },
  value: { color: colors.text, fontSize: 14 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 8 },
  cancel: { backgroundColor: colors.textTertiary, borderRadius: 8, padding: 9 },
  confirm: { backgroundColor: colors.primary, borderRadius: 8, padding: 9 },
  buttonText: { color: '#fff', fontWeight: '600' },
  readOnly: { color: colors.textSecondary },
});
