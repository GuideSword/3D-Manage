import React, { useState } from 'react';
import { Text } from 'react-native';
import { Button, Card, Input } from '../components';
import MasterDataPage, { useMasterDataStyles } from '../components/MasterDataPage';
import EditLoadState from '../components/EditLoadState';
import { partnerAPI } from '../utils/masterDataApi';
import { useEditRecord } from '../utils/useEditRecord';
import { useMasterDataMutation } from '../utils/useMasterDataMutation';
import masterDataCore from '../utils/masterDataCore.cjs';

export default function EditPartnerScreen({ navigation, route }) {
  const { kind, id } = route.params;
  const label = kind === 'customers' ? '客户' : '供应商';
  const api = partnerAPI(kind), styles = useMasterDataStyles();
  const mutation = useMasterDataMutation(navigation);
  const [form, setForm] = useState(() => masterDataCore.partnerToForm());
  const { record, loadingRecord, loadError, reload } = useEditRecord(id, api, value => {
    setForm(masterDataCore.partnerToForm(value)); mutation.resetAfterLoad();
  });
  const save = async () => {
    try {
      const fields = masterDataCore.formToPartner(form);
      const payload = id ? { version: record.version, changes: fields } : fields;
      const result = await mutation.run(`${kind}.${id ? 'update' : 'create'}`, payload,
        (body, key) => id ? api.update(id, body, key) : api.create(body, key));
      if (result) navigation.goBack();
    } catch (error) { mutation.setError(error.message); }
  };
  if (id && !record) return <EditLoadState loading={loadingRecord} error={loadError} onRetry={reload} onCancel={() => navigation.goBack()} />;
  return <MasterDataPage title={`${id ? '编辑' : '新增'}${label}`}>
    <Card>{masterDataCore.PARTNER_FIELDS.map(field => <Input key={field.key} label={`${field.label}${field.required ? ' *' : ''}`} value={form[field.key]}
      maxLength={field.max} multiline={['address', 'notes'].includes(field.key)} numberOfLines={field.key === 'notes' ? 4 : 2}
      autoCapitalize={field.key === 'email' ? 'none' : 'sentences'} keyboardType={field.key === 'email' ? 'email-address' : 'default'}
      editable={!mutation.pending && !mutation.loading} onChangeText={value => setForm(current => ({ ...current, [field.key]: value }))} />)}</Card>
    {mutation.error ? <Text style={styles.error}>{mutation.error}</Text> : null}
    {mutation.pending && !mutation.loading ? <Text style={styles.text}>上次保存结果未知，请重试原保存确认结果。</Text> : null}
    {mutation.conflict ? <Button title="重新加载最新资料（替换当前输入）" variant="outline" onPress={reload} /> : null}
    <Button title={mutation.pending && !mutation.loading ? '重试原保存' : '保存'} loading={mutation.loading} disabled={mutation.conflict} onPress={save} />
    <Button title="返回" variant="outline" disabled={Boolean(mutation.pending)} onPress={() => navigation.goBack()} />
  </MasterDataPage>;
}
