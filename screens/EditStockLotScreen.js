import React, { useMemo, useRef, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text } from 'react-native';
import { Button, Card, Input } from '../components';
import EditLoadState from '../components/EditLoadState';
import { useAppTheme } from '../context/ThemeContext';
import { isAuthRequiredError, stockAPI } from '../utils/api';
import { useInventoryCommand } from '../utils/useInventoryCommand';
import { useEditRecord } from '../utils/useEditRecord';
import { SPACING } from '../constants';

const lotAPI = { getById: (id) => stockAPI.getLotById(id) };

export default function EditStockLotScreen({ route, navigation }) {
  const lotId = route.params?.lotId;
  const { colors } = useAppTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: SPACING.lg, gap: SPACING.lg, width: '100%', maxWidth: 720, alignSelf: 'center' },
    title: { fontSize: 22, fontWeight: '700', color: colors.text },
    text: { color: colors.textSecondary, lineHeight: 22 },
    error: { color: colors.danger, lineHeight: 22 },
  }), [colors]);
  const [form, setForm] = useState({ lotNo: '', serialNo: '', location: '', notes: '' });
  const [loading, setLoading] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [pendingPayload, setPendingPayload] = useState(null);
  const submitting = useRef(false);
  const submitCommand = useInventoryCommand();
  const { record, loadingRecord, loadError, reload } = useEditRecord(lotId, lotAPI, (lot) => {
    setForm({ lotNo: lot.lotNo || lot.lot_no || '', serialNo: lot.serialNo || lot.serial_no || '',
      location: lot.location || '', notes: lot.notes || '' });
    setConflict(false);
    setSaveError('');
  });

  const save = async () => {
    if (submitting.current || !record || conflict) return;
    if (!pendingPayload && !form.lotNo.trim()) { setSaveError('请输入批次号'); return; }
    const payload = pendingPayload || { id: lotId, changes: {
      lotNo: form.lotNo.trim(), serialNo: form.serialNo.trim(), location: form.location.trim(),
      notes: form.notes.trim(), version: record.version,
    } };
    submitting.current = true;
    setLoading(true);
    setSaveError('');
    setPendingPayload(payload);
    try {
      const result = await submitCommand('lot.update', payload,
        (body, key) => stockAPI.updateLot(body.id, body.changes, key));
      if (result === null) return;
      setPendingPayload(null);
      navigation.goBack();
    } catch (error) {
      if (isAuthRequiredError(error)) return;
      const definitive = error.status >= 400 && error.status < 500;
      if (definitive) setPendingPayload(null);
      if (error.status === 409) {
        setConflict(true);
        setSaveError('批次已被其他操作修改，请核对当前输入后重新加载最新资料。');
      } else {
        setSaveError(error.message || '保存失败，请重试');
      }
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  if (!record) return <EditLoadState loading={loadingRecord} error={loadError} onRetry={reload} onCancel={() => navigation.goBack()} />;
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>编辑库存批次</Text>
        <Card>
          <Text style={styles.text}>当前库存：{record.qty || 0}g · {record.active === false ? '已停用' : '已启用'}</Text>
          <Text style={styles.text}>数量更正请使用入库、出库或盘点，系统会保留库存流水。</Text>
        </Card>
        <Card>
          {[
            ['lotNo', '批次号 *'], ['serialNo', '序列号'], ['location', '库位'], ['notes', '备注'],
          ].map(([field, label]) => <Input key={field} label={label} value={form[field]}
            editable={!loading && !pendingPayload} multiline={field === 'notes'}
            onChangeText={(value) => setForm((current) => ({ ...current, [field]: value }))} />)}
        </Card>
        {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
        {pendingPayload && !loading ? <Text style={styles.text}>上次保存结果未知，请重试原请求确认结果。</Text> : null}
        {conflict ? <Button title="重新加载最新资料" onPress={reload} variant="outline" fullWidth /> : null}
        <Button title={pendingPayload && !loading ? '重试原保存' : '保存修改'} onPress={save}
          loading={loading} disabled={conflict} iconLeft="checkmark-outline" fullWidth />
        <Button title="取消" onPress={() => {
          if (pendingPayload) {
            setSaveError('请先重试确认上次保存结果，再离开此页。');
            return;
          }
          navigation.goBack();
        }} disabled={loading} variant="outline" fullWidth />
      </ScrollView>
    </SafeAreaView>
  );
}
