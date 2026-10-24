import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card } from '../components';
import MasterDataPage, { useMasterDataStyles } from '../components/MasterDataPage';
import EditLoadState from '../components/EditLoadState';
import { partnerAPI } from '../utils/masterDataApi';
import { useMasterDataMutation } from '../utils/useMasterDataMutation';
import { useAuth } from '../context/AuthContext';
import { canWrite } from '../utils/permissions';
import { isAuthRequiredError } from '../utils/api';
import { ROUTES } from '../constants';
import masterDataCore from '../utils/masterDataCore.cjs';

export default function PartnerDetailScreen({ navigation, route }) {
  const { kind, id } = route.params, label = kind === 'customers' ? '客户' : '供应商';
  const api = partnerAPI(kind), styles = useMasterDataStyles(), { user } = useAuth();
  const mutation = useMasterDataMutation(navigation);
  const [record, setRecord] = useState(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [refresh, setRefresh] = useState(0), [confirmDelete, setConfirmDelete] = useState(false);
  useFocusEffect(useCallback(() => {
    let current = true;
    setLoading(true); setLoadError('');
    api.getById(id).then(value => { if (current) { setRecord(value); mutation.resetAfterLoad(); } })
      .catch(error => { if (current && !isAuthRequiredError(error) && !error.staleSession) setLoadError(error.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, id, refresh, mutation.resetAfterLoad]));
  const act = async action => {
    const payload = { id, version: record.version, ...(action === 'active' ? { active: !record.active } : {}) };
    const result = await mutation.run(`${kind}.${action}`, payload, (body, key) => action === 'delete'
      ? api.delete(body.id, body.version, key) : api.setActive(body.id, { version: body.version, active: body.active }, key));
    if (result) {
      setConfirmDelete(false);
      if (action === 'delete') navigation.goBack(); else setRecord(result);
    }
  };
  if (!record) return <EditLoadState loading={loading} error={loadError} onRetry={() => setRefresh(value => value + 1)} onCancel={() => navigation.goBack()} />;
  const locked = Boolean(mutation.pending) || mutation.loading || loading || Boolean(loadError);
  return <MasterDataPage title={`${label}详情`}>
    {loading ? <ActivityIndicator /> : null}
    <Text style={styles.text}>{record.active ? '已启用' : '已停用'}</Text>
    <Card>{masterDataCore.PARTNER_FIELDS.map(field => <View key={field.key} style={styles.field}>
      <Text style={styles.text}>{field.label}</Text><Text selectable style={styles.name}>{record[field.key] || '未填写'}</Text>
    </View>)}</Card>
    {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
    {mutation.error ? <Text style={styles.error}>{mutation.error}</Text> : null}
    {mutation.pending ? <><Text style={styles.text}>上次操作结果未知，请重试确认。</Text>
      <Button title="重试原操作" loading={mutation.loading} onPress={() => act(mutation.pending.operation.endsWith('.delete') ? 'delete' : 'active')} /></> : null}
    {canWrite(user) ? <>
      <Button title={`编辑${label}`} disabled={locked || mutation.conflict} onPress={() => navigation.navigate(ROUTES.EDIT_PARTNER, { kind, id })} />
      <Button title={record.active ? '停用' : '恢复启用'} disabled={locked || mutation.conflict} variant="outline" onPress={() => act('active')} />
      <Button title="删除资料" disabled={locked || mutation.conflict} variant="outline" onPress={() => setConfirmDelete(true)} />
      {confirmDelete ? <Card><Text style={styles.text}>确定删除{record.name}？已有业务引用的资料会被保留，可改用停用。</Text>
        <Button title="确认删除" disabled={locked} onPress={() => act('delete')} />
        <Button title="取消删除" variant="outline" disabled={locked} onPress={() => setConfirmDelete(false)} /></Card> : null}
    </> : null}
    {!mutation.pending ? <Button title={mutation.conflict ? '重新加载最新资料' : '刷新资料'} variant="outline" disabled={loading} onPress={() => setRefresh(value => value + 1)} /> : null}
  </MasterDataPage>;
}
