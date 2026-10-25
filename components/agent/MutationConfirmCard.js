import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { canWrite } from '../../utils/permissions';

// Human confirmation boundary for every non-read Agent operation.  A proposal
// is intentionally rendered as data (including before/changes/version) so a
// user can inspect exactly what the signed server payload contains before the
// mutation endpoint is called.
export default function MutationConfirmCard({ proposal, onConfirm, onCancel }) {
  const { colors } = useAppTheme();
  const { user } = useAuth();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  const writable = canWrite(user);
  if (!proposal) return null;

  const entity = entityLabel(proposal.entity);
  const action = actionLabel(proposal.action);
  const errors = proposal.errors || proposal.fieldErrors || proposal.missing_fields || [];
  const errorList = Array.isArray(errors) ? errors : Object.entries(errors).map(([key, value]) => `${key}: ${value}`);
  const isDelete = proposal.action === 'delete';

  const confirm = () => {
    if (!writable || busy || errorList.length) return;
    const run = () => {
      setBusy(true);
      Promise.resolve(onConfirm?.(proposal)).catch(() => {}).finally(() => setBusy(false));
    };
    if (isDelete) {
      Alert.alert('确认删除', `将删除${entity}${proposal.id ? ` #${proposal.id}` : ''}，此操作无法撤销。`, [
        { text: '取消', style: 'cancel' },
        { text: '确认删除', style: 'destructive', onPress: run },
      ]);
      return;
    }
    run();
  };

  return (
    <View style={styles.card} accessibilityLabel="AI 修改提案">
      <View style={styles.header}>
        <Text style={styles.title}>🔐 修改提案 · {action}{entity}</Text>
        <Text style={styles.badge}>{proposal.status || '待确认'}</Text>
      </View>
      {proposal.id != null ? <Meta label="记录" value={String(proposal.id)} styles={styles} /> : null}
      {proposal.expectedVersion != null ? <Meta label="版本" value={String(proposal.expectedVersion)} styles={styles} /> : null}
      {proposal.expiresAt ? <Meta label="有效期" value={formatExpiry(proposal.expiresAt)} styles={styles} /> : null}

      {errorList.length ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorTitle}>请先修正字段</Text>
          {errorList.map((error, index) => <Text style={styles.error} key={`${String(error)}-${index}`}>• {String(error)}</Text>)}
        </View>
      ) : null}

      {proposal.before != null ? <ValueBlock label="修改前" value={proposal.before} styles={styles} /> : null}
      {proposal.changes != null ? <ValueBlock label={proposal.action === 'create' ? '创建内容' : '修改内容'} value={proposal.changes} styles={styles} /> : null}
      {proposal.risk ? <Text style={styles.risk}>风险：{String(proposal.risk)}</Text> : null}

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.button, styles.cancel]} onPress={() => onCancel?.()} disabled={busy}>
          <Text style={styles.cancelText}>取消</Text>
        </TouchableOpacity>
        {writable ? (
          <TouchableOpacity
            style={[styles.button, styles.confirm, (busy || errorList.length) && styles.disabled]}
            onPress={confirm}
            disabled={busy || Boolean(errorList.length)}
          >
            <Text style={styles.confirmText}>{busy ? '处理中…' : isDelete ? '确认删除' : '确认执行'}</Text>
          </TouchableOpacity>
        ) : <Text style={styles.readOnly}>Viewer 仅可查看提案</Text>}
      </View>
    </View>
  );
}

function Meta({ label, value, styles }) {
  return <Text style={styles.meta}><Text style={styles.metaLabel}>{label}：</Text>{value}</Text>;
}

function ValueBlock({ label, value, styles }) {
  return (
    <View style={styles.valueBlock}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text style={styles.code}>{safeStringify(value)}</Text>
      </ScrollView>
    </View>
  );
}

function safeStringify(value) {
  try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
}

function entityLabel(entity) {
  return ({ orders: '订单', models: '模型', materials: '耗材', inventory: '库存' })[entity] || String(entity || '记录');
}

function actionLabel(action) {
  return ({ create: '创建', update: '修改', delete: '删除' })[action] || String(action || '变更');
}

function formatExpiry(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

const createStyles = (colors) => StyleSheet.create({
  card: { backgroundColor: colors.warningSoft, marginHorizontal: 8, marginVertical: 6, padding: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.warning },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  badge: { color: colors.warning, fontSize: 11, fontWeight: '600' },
  meta: { color: colors.textSecondary, fontSize: 12, marginTop: 5 },
  metaLabel: { fontWeight: '600', color: colors.text },
  valueBlock: { marginTop: 9 },
  label: { color: colors.textSecondary, fontSize: 12, marginBottom: 3 },
  code: { color: colors.text, fontFamily: 'monospace', fontSize: 11 },
  risk: { color: colors.danger, fontSize: 12, marginTop: 8 },
  errorBox: { backgroundColor: colors.dangerSoft, borderRadius: 8, padding: 8, marginTop: 8 },
  errorTitle: { color: colors.danger, fontSize: 12, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  button: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 7 },
  cancel: { backgroundColor: colors.textTertiary },
  confirm: { backgroundColor: colors.warning },
  disabled: { opacity: 0.55 },
  cancelText: { color: colors.onPrimary, fontWeight: '600' },
  confirmText: { color: colors.onWarning || colors.text, fontWeight: '700' },
  readOnly: { color: colors.textSecondary, fontSize: 12 },
});

